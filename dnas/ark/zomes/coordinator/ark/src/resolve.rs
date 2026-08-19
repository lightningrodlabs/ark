use hdk::prelude::*;

use ark_pick::pick_head;

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

/// The winning version: `pick_head` applied across ALL tips of the update graph.
///
/// Deliberately NOT a greedy walk that picks a winner at each fork and descends.
/// Greedy resolution abandons the losing sibling's entire subtree, so an agent who
/// amends twice offline can have both edits vanish the moment another agent's
/// single later amendment wins the first fork. Determinism is unchanged: every
/// peer sees the same graph and therefore the same tip set.
pub fn latest_of(original: ActionHash) -> ExternResult<Option<Record>> {
    let tips = all_tips(original.clone())?;
    if tips.is_empty() {
        return Ok(get(original, GetOptions::local())?);
    }
    let candidates: Vec<(Vec<u8>, i64)> = tips
        .iter()
        .map(|r| {
            (
                r.action_address().get_raw_39().to_vec(),
                r.action().timestamp().as_micros(),
            )
        })
        .collect();
    let Some(raw) = pick_head(&candidates) else {
        return Ok(None);
    };
    Ok(tips
        .into_iter()
        .find(|r| r.action_address().get_raw_39().to_vec() == raw))
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

/// EVERY version in the update graph, oldest first — not just the winning path.
/// Ordering matches `pick_head`'s rule (timestamp, then hash bytes) so the last
/// element is always the same record `latest_of` returns.
pub fn version_chain(original: ActionHash) -> ExternResult<Vec<Record>> {
    let mut records: Vec<Record> = Vec::new();
    let mut frontier = vec![original];
    let mut seen: Vec<ActionHash> = Vec::new();
    while let Some(current) = frontier.pop() {
        if seen.contains(&current) {
            continue;
        }
        seen.push(current.clone());
        let Some(Details::Record(details)) = get_details(current, GetOptions::local())? else {
            continue;
        };
        records.push(details.record);
        for update in details.updates {
            frontier.push(update.hashed.hash.clone());
        }
    }
    records.sort_by(|a, b| {
        a.action()
            .timestamp()
            .cmp(&b.action().timestamp())
            .then_with(|| {
                a.action_address()
                    .get_raw_39()
                    .cmp(b.action_address().get_raw_39())
            })
    });
    Ok(records)
}
