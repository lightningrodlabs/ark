use ark_integrity::*;
use hdk::prelude::*;

use crate::types::*;

/// Every document, version or not, is addressed by its original create action.
pub fn document_summary(original: ActionHash) -> ExternResult<Option<DocumentSummary>> {
    let Some(original_record) = get(original.clone(), GetOptions::local())? else {
        return Ok(None);
    };
    // Until Task 3 adds amendments there is exactly one version.
    let Some(document) = original_record.entry().to_app_option::<Document>().ok().flatten() else {
        return Ok(None);
    };
    Ok(Some(DocumentSummary {
        original: original.clone(),
        latest: original,
        author: original_record.action().author().clone(),
        created_at: original_record.action().timestamp(),
        updated_at: original_record.action().timestamp(),
        body: document.body,
        meta: document.meta,
    }))
}

#[hdk_extern]
pub fn create_document(input: CreateDocumentInput) -> ExternResult<ActionHash> {
    let action_hash = create_entry(EntryTypes::Document(Document {
        body: input.body,
        meta: input.meta,
    }))?;
    create_link(
        Path::from(ALL_DOCUMENTS).path_entry_hash()?,
        action_hash.clone(),
        LinkTypes::AllDocuments,
        (),
    )?;
    Ok(action_hash)
}

#[hdk_extern]
pub fn get_document(original: ActionHash) -> ExternResult<Option<DocumentSummary>> {
    document_summary(original)
}

/// All document original-action hashes, oldest link first, so paging is stable.
pub fn all_document_hashes() -> ExternResult<Vec<ActionHash>> {
    let mut links = get_links(
        LinkQuery::try_new(Path::from(ALL_DOCUMENTS).path_entry_hash()?, LinkTypes::AllDocuments)?,
        GetStrategy::Local,
    )?;
    links.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then(a.create_link_hash.cmp(&b.create_link_hash)));
    links
        .into_iter()
        .map(|link| {
            ActionHash::try_from(link.target)
                .map_err(|e| wasm_error!(WasmErrorInner::from(e)))
        })
        .collect()
}

#[hdk_extern]
pub fn get_all_documents(input: GetAllInput) -> ExternResult<Vec<DocumentSummary>> {
    let hashes = all_document_hashes()?;
    let mut out = Vec::new();
    for hash in hashes.into_iter().skip(input.offset).take(input.limit) {
        if let Some(summary) = document_summary(hash)? {
            out.push(summary);
        }
    }
    Ok(out)
}
