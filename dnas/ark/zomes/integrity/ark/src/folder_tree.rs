use hdi::prelude::*;
use std::collections::BTreeSet;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub order: u32,
    /// Tombstone. Folders are never removed from the vec, because the UI merges
    /// heads by union on `id` and absence would let a stale head resurrect a
    /// deleted folder.
    pub deleted: bool,
}

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct FolderTree {
    pub folders: Vec<Folder>,
}

pub fn validate_create_folder_tree(
    _action: Action,
    tree: FolderTree,
) -> ExternResult<ValidateCallbackResult> {
    let mut seen = BTreeSet::new();
    for folder in &tree.folders {
        if folder.id.is_empty() {
            return Ok(ValidateCallbackResult::Invalid(
                "Folder id must not be empty".to_string(),
            ));
        }
        if !seen.insert(folder.id.clone()) {
            return Ok(ValidateCallbackResult::Invalid(format!(
                "Duplicate folder id {}",
                folder.id
            )));
        }
    }
    Ok(ValidateCallbackResult::Valid)
}
