use ark_integrity::*;
use hdk::prelude::*;

use crate::resolve::all_tips;
use crate::resolve::decode_entry;
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
/// The caller (the UI) has already merged; this function does not merge.
#[hdk_extern]
pub fn update_folder_tree(input: UpdateFolderTreeInput) -> ExternResult<ActionHash> {
    let tree = FolderTree { folders: input.folders };
    let mut tips: Vec<ActionHash> = Vec::new();
    for root in tree_roots()? {
        for record in all_tips(root)? {
            tips.push(record.action_address().clone());
        }
    }

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
