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
