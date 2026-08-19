use ark_integrity::*;
use hdk::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

use crate::resolve::{all_tips, decode_entry};
use crate::types::*;

/// Create actions of every tree root ever committed. Normally one; two agents
/// initialising at the same moment produce two, and both are merged by the UI.
fn tree_roots() -> ExternResult<Vec<ActionHash>> {
    let links = get_links(
        LinkQuery::try_new(Path::from(ALL_TREES).path_entry_hash()?, LinkTypes::AllTrees)?,
        GetStrategy::Local,
    )?;
    links
        .into_iter()
        .map(|link| {
            ActionHash::try_from(link.target).map_err(|e| wasm_error!(WasmErrorInner::from(e)))
        })
        .collect()
}

/// EVERY tip of EVERY root, never a single winner. The UI unions them.
#[hdk_extern]
pub fn get_folder_tree(_: ()) -> ExternResult<Vec<TreeHead>> {
    let mut heads = Vec::new();
    for root in tree_roots()? {
        for record in all_tips(root)? {
            let Some(tree) = decode_entry::<FolderTree>(&record, "FolderTree")? else {
                continue;
            };
            heads.push(TreeHead {
                action: record.action_address().clone(),
                timestamp: record.action().timestamp(),
                folders: tree.folders,
            });
        }
    }
    Ok(heads)
}

/// Writes the merged folder list onto every current tip, so all tips carry
/// identical content and the fork stops mattering. Updating only the newest tip
/// would leave the loser's tip live forever, growing the head count with every
/// concurrent edit.
///
/// The caller (the UI) has already merged every head it could see; the only
/// merging this function itself does is carrying forward ids the caller didn't
/// send, so a write built from a stale read can't erase another agent's folder.
/// Reconciling forked heads is still entirely the UI's job.
#[hdk_extern]
pub fn update_folder_tree(input: UpdateFolderTreeInput) -> ExternResult<ActionHash> {
    let mut tip_records: Vec<Record> = Vec::new();
    for root in tree_roots()? {
        for record in all_tips(root)? {
            tip_records.push(record);
        }
    }

    // Oldest tip first, ties by action hash, so a newer tip's version of a folder
    // replaces an older one below. Tip order out of `all_tips` is a DFS pop order
    // and carries no guarantee, so without this sort two peers scanning the same
    // tips could carry forward different content for the same id and durably
    // commit both — the opposite of converging.
    tip_records.sort_by(|a, b| {
        a.action()
            .timestamp()
            .cmp(&b.action().timestamp())
            .then_with(|| {
                a.action_address()
                    .get_raw_39()
                    .cmp(b.action_address().get_raw_39())
            })
    });

    // Carry forward any folder id the caller did not send. The caller (the UI)
    // has already merged every head it could see, but another agent may have
    // added a folder between that read and this write, and a full-list write
    // would erase it — the spec promises a concurrent add never loses a folder,
    // and without this it does. Ids the caller DID send always win, so renames,
    // re-parenting and `deleted` tombstones all still take effect.
    //
    // This is the ONLY merging the zome does. Reconciling forked heads is still
    // the UI's job, because only it can apply the newest-action-wins rule.
    let mut folders = input.folders;
    let caller_ids: BTreeSet<String> = folders.iter().map(|f| f.id.clone()).collect();
    let mut carried: BTreeMap<String, Folder> = BTreeMap::new();
    for record in &tip_records {
        if let Some(tree) = decode_entry::<FolderTree>(record, "FolderTree")? {
            for folder in tree.folders {
                // An id the caller sent is never overridden. Among tips, the
                // newest wins — the same rule the UI applies across heads.
                if !caller_ids.contains(&folder.id) {
                    carried.insert(folder.id.clone(), folder);
                }
            }
        }
    }
    folders.extend(carried.into_values());

    let tree = FolderTree { folders };
    let mut tips: Vec<ActionHash> = tip_records
        .iter()
        .map(|r| r.action_address().clone())
        .collect();

    if tips.is_empty() {
        let action_hash = create_entry(EntryTypes::FolderTree(tree))?;
        create_link(
            Path::from(ALL_TREES).path_entry_hash()?,
            action_hash.clone(),
            LinkTypes::AllTrees,
            (),
        )?;
        return Ok(action_hash);
    }

    // Deterministic order so the returned hash is the same regardless of the
    // order get_links happened to yield.
    tips.sort();
    let mut last = None;
    for tip in tips {
        last = Some(update_entry(tip, EntryTypes::FolderTree(tree.clone()))?);
    }
    last.ok_or(wasm_error!(WasmErrorInner::Guest(
        "No tree tip to update".to_string()
    )))
}

/// Link a document's original create action into a folder. The tag carries the
/// document's `date` metadata so a folder listing can be ordered without
/// fetching entries.
pub fn file_document(folder_id: &str, original: ActionHash, date: &str) -> ExternResult<()> {
    create_link(
        Path::from(folder_anchor(folder_id)).path_entry_hash()?,
        original,
        LinkTypes::FolderToDocument,
        LinkTag::new(date.as_bytes().to_vec()),
    )?;
    Ok(())
}

/// Remove every link filing `original` under `folder_id`. Concurrent filings can
/// produce more than one, so all are removed.
pub fn unfile_document(folder_id: &str, original: &ActionHash) -> ExternResult<()> {
    let links = get_links(
        LinkQuery::try_new(
            Path::from(folder_anchor(folder_id)).path_entry_hash()?,
            LinkTypes::FolderToDocument,
        )?,
        GetStrategy::Local,
    )?;
    for link in links {
        if ActionHash::try_from(link.target.clone()).ok().as_ref() == Some(original) {
            delete_link(link.create_link_hash, GetOptions::local())?;
        }
    }
    Ok(())
}

#[hdk_extern]
pub fn move_document(input: MoveDocumentInput) -> ExternResult<()> {
    if let Some(from) = &input.from {
        unfile_document(from, &input.original)?;
    }
    if let Some(to) = &input.to {
        let date = crate::document::document_summary(input.original.clone())?
            .and_then(|s| s.meta.get("date").cloned())
            .unwrap_or_default();
        file_document(to, input.original, &date)?;
    }
    Ok(())
}

#[hdk_extern]
pub fn get_filings(folder_ids: Vec<String>) -> ExternResult<Vec<FolderFiling>> {
    let mut out = Vec::new();
    for folder_id in folder_ids {
        let links = get_links(
            LinkQuery::try_new(
                Path::from(folder_anchor(&folder_id)).path_entry_hash()?,
                LinkTypes::FolderToDocument,
            )?,
            GetStrategy::Local,
        )?;
        let mut documents: Vec<ActionHash> = links
            .into_iter()
            .filter_map(|link| ActionHash::try_from(link.target).ok())
            .collect();
        documents.sort();
        documents.dedup();
        out.push(FolderFiling { folder_id, documents });
    }
    Ok(out)
}
