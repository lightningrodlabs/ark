pub const ALL_DOCUMENTS: &str = "docs";
pub const ALL_TREES: &str = "tree";
pub const TRASH: &str = "trash";

pub fn folder_anchor(folder_id: &str) -> String {
    format!("folder:{folder_id}")
}
