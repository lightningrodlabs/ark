use ark_integrity::*;
use hdk::prelude::*;

use crate::resolve::{decode_entry, latest_of, version_chain};
use crate::types::*;

/// Every document, version or not, is addressed by its original create action.
/// `latest`, `author`, `updated_at`, `body` and `meta` report the resolved head
/// of the update chain; `original` and `created_at` stay pinned to the create
/// action so links (which always target the original) keep working.
pub fn document_summary(original: ActionHash) -> ExternResult<Option<DocumentSummary>> {
    let Some(original_record) = get(original.clone(), GetOptions::local())? else {
        return Ok(None);
    };
    let Some(latest_record) = latest_of(original.clone())? else {
        return Ok(None);
    };
    let Some(document) = decode_entry::<Document>(&latest_record, "Document")? else {
        return Ok(None);
    };
    Ok(Some(DocumentSummary {
        original,
        latest: latest_record.action_address().clone(),
        author: latest_record.action().author().clone(),
        created_at: original_record.action().timestamp(),
        updated_at: latest_record.action().timestamp(),
        body: document.body,
        meta: document.meta,
    }))
}

#[hdk_extern]
pub fn create_document(input: CreateDocumentInput) -> ExternResult<ActionHash> {
    let document = Document { body: input.body, meta: input.meta };
    let action_hash = create_entry(EntryTypes::Document(document.clone()))?;
    create_link(
        Path::from(ALL_DOCUMENTS).path_entry_hash()?,
        action_hash.clone(),
        LinkTypes::AllDocuments,
        (),
    )?;
    if let Some(folder_id) = &input.folder_id {
        let date = document.meta.get("date").cloned().unwrap_or_default();
        crate::folder::file_document(folder_id, action_hash.clone(), &date)?;
    }
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

#[hdk_extern]
pub fn amend_document(input: AmendDocumentInput) -> ExternResult<ActionHash> {
    // Amend the current tip, not the original, so the chain stays linear when
    // there is no concurrency.
    let tip = latest_of(input.original.clone())?
        .map(|r| r.action_address().clone())
        .unwrap_or(input.original);
    update_entry(
        tip,
        EntryTypes::Document(Document { body: input.body, meta: input.meta }),
    )
}

#[hdk_extern]
pub fn get_document_versions(original: ActionHash) -> ExternResult<Vec<DocumentVersion>> {
    let mut out = Vec::new();
    for record in version_chain(original)? {
        if let Some(document) = decode_entry::<Document>(&record, "Document version")? {
            out.push(DocumentVersion {
                action: record.action_address().clone(),
                author: record.action().author().clone(),
                timestamp: record.action().timestamp(),
                body: document.body,
                meta: document.meta,
            });
        }
    }
    Ok(out)
}
