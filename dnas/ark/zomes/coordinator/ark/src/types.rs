use ark_integrity::Folder;
use hdk::prelude::*;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CreateDocumentInput {
    pub body: String,
    pub meta: BTreeMap<String, String>,
    pub folder_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetAllInput {
    pub offset: usize,
    pub limit: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetAllOutput {
    /// Every document the AllDocuments anchor knows about, resolvable or not.
    pub total: usize,
    /// Those in this page that resolved locally. May be shorter than the page.
    pub documents: Vec<DocumentSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DocumentSummary {
    pub original: ActionHash,
    pub latest: ActionHash,
    pub author: AgentPubKey,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub body: String,
    pub meta: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AmendDocumentInput {
    pub original: ActionHash,
    pub body: String,
    pub meta: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DocumentVersion {
    pub action: ActionHash,
    pub author: AgentPubKey,
    pub timestamp: Timestamp,
    pub body: String,
    pub meta: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateFolderTreeInput {
    pub folders: Vec<Folder>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TreeHead {
    pub action: ActionHash,
    pub timestamp: Timestamp,
    pub folders: Vec<Folder>,
}

/// `get_folder_tree`'s full return: every resolvable head, alongside the
/// number of root LINKS `tree_roots()` found. Root links and the `FolderTree`
/// entries they point at gossip independently, so `heads` coming back short
/// is ambiguous by itself — this pairs it with `root_count` so the caller can
/// tell "the tree exists and has not arrived yet" (`root_count > heads.len()`)
/// from "genuinely no folders" (`root_count == 0`), the same way
/// `GetAllOutput.total` disambiguates a short document page from the end of
/// the corpus.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TreeSnapshot {
    pub root_count: usize,
    pub heads: Vec<TreeHead>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MoveDocumentInput {
    pub original: ActionHash,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FolderFiling {
    pub folder_id: String,
    pub documents: Vec<ActionHash>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AttachInput {
    pub original: ActionHash,
    pub file_hash: EntryHash,
}
