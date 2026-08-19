use hdk::prelude::*;

use crate::pick::pick_head;

/// Decode an app entry from a record, distinguishing "not there" from "there but
/// unreadable". `.ok().flatten()` collapses those two into None, which in an
/// archive means a corrupt document silently disappears from `get_all_documents`
/// — exactly the reachability the `AllDocuments` anchor exists to guarantee.
pub fn decode_entry<T: TryFrom<SerializedBytes, Error = SerializedBytesError>>(
    record: &Record,
    what: &str,
) -> ExternResult<Option<T>> {
    record.entry().to_app_option::<T>().map_err(|e| {
        wasm_error!(WasmErrorInner::Guest(format!(
            "{what} at {} failed to deserialize: {e:?}",
            record.action_address()
        )))
    })
}

/// Walk the update graph from `original` and return the winning tip record.
/// Returns None only if `original` itself cannot be fetched.
pub fn latest_of(original: ActionHash) -> ExternResult<Option<Record>> {
    let mut current = original;
    loop {
        let Some(Details::Record(details)) = get_details(current.clone(), GetOptions::local())?
        else {
            return Ok(None);
        };
        let candidates: Vec<(Vec<u8>, i64)> = details
            .updates
            .iter()
            .map(|u| {
                (
                    u.hashed.hash.get_raw_39().to_vec(),
                    u.hashed.content.timestamp().as_micros(),
                )
            })
            .collect();
        match pick_head(&candidates) {
            None => return Ok(Some(details.record)),
            Some(raw) => {
                let next = details
                    .updates
                    .iter()
                    .find(|u| u.hashed.hash.get_raw_39().to_vec() == raw)
                    .map(|u| u.hashed.hash.clone())
                    .ok_or(wasm_error!(WasmErrorInner::Guest(
                        "Selected head is not among the updates".to_string()
                    )))?;
                current = next;
            }
        }
    }
}

/// Every leaf of the update graph.
///
/// A document wants a single winner, which is what `latest_of` gives. The folder
/// tree wants them ALL: concurrent edits fork the chain, and the UI unions every
/// fork so no folder is lost. Collapsing to one winner here would silently
/// discard the losing branch's folders — the exact failure the union merge and
/// the `deleted` tombstone exist to prevent.
pub fn all_tips(original: ActionHash) -> ExternResult<Vec<Record>> {
    let mut tips = Vec::new();
    let mut frontier = vec![original];
    let mut seen: Vec<ActionHash> = Vec::new();
    while let Some(current) = frontier.pop() {
        if seen.contains(&current) {
            continue;
        }
        seen.push(current.clone());
        let Some(Details::Record(details)) = get_details(current.clone(), GetOptions::local())?
        else {
            continue;
        };
        if details.updates.is_empty() {
            tips.push(details.record);
        } else {
            for update in details.updates {
                frontier.push(update.hashed.hash.clone());
            }
        }
    }
    Ok(tips)
}

/// Every version from the create action down the winning path, oldest first.
pub fn version_chain(original: ActionHash) -> ExternResult<Vec<Record>> {
    let mut chain = Vec::new();
    let mut current = original;
    loop {
        let Some(Details::Record(details)) = get_details(current.clone(), GetOptions::local())?
        else {
            return Ok(chain);
        };
        chain.push(details.record.clone());
        let mut sorted: Vec<_> = details.updates.iter().collect();
        sorted.sort_by(|a, b| {
            a.hashed
                .content
                .timestamp()
                .cmp(&b.hashed.content.timestamp())
                .then_with(|| a.hashed.hash.get_raw_39().cmp(b.hashed.hash.get_raw_39()))
        });
        // Losing branches are still versions and must be shown, so append them
        // before descending into the winner.
        for update in sorted.iter().take(sorted.len().saturating_sub(1)) {
            if let Some(record) = get(update.hashed.hash.clone(), GetOptions::local())? {
                chain.push(record);
            }
        }
        match sorted.last() {
            None => return Ok(chain),
            Some(winner) => current = winner.hashed.hash.clone(),
        }
    }
}
