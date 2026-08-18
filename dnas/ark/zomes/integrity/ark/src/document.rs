use hdi::prelude::*;
use std::collections::BTreeMap;

pub const MAX_BODY_BYTES: usize = 1024 * 1024;
pub const MAX_META_BYTES: usize = 8 * 1024;

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Document {
    pub body: String,
    pub meta: BTreeMap<String, String>,
}

pub fn validate_create_document(
    _action: TypedAction<EntryCreationData>,
    document: Document,
) -> ExternResult<ValidateCallbackResult> {
    if document.body.len() > MAX_BODY_BYTES {
        return Ok(ValidateCallbackResult::Invalid(format!(
            "Document body is {} bytes, over the {} byte limit",
            document.body.len(),
            MAX_BODY_BYTES
        )));
    }
    if document.meta.keys().any(|k| k.is_empty()) {
        return Ok(ValidateCallbackResult::Invalid(
            "Document metadata keys must not be empty".to_string(),
        ));
    }
    let meta_bytes: usize = document
        .meta
        .iter()
        .map(|(k, v)| k.len() + v.len())
        .sum();
    if meta_bytes > MAX_META_BYTES {
        return Ok(ValidateCallbackResult::Invalid(format!(
            "Document metadata is {meta_bytes} bytes, over the {MAX_META_BYTES} byte limit"
        )));
    }
    Ok(ValidateCallbackResult::Valid)
}
