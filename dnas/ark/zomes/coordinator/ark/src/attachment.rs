use ark_integrity::*;
use hdk::prelude::*;

use crate::types::AttachInput;

fn attachment_links(original: &ActionHash) -> ExternResult<Vec<Link>> {
    get_links(
        LinkQuery::try_new(original.clone(), LinkTypes::DocumentToFile)?,
        GetStrategy::Local,
    )
}

#[hdk_extern]
pub fn attach_file(input: AttachInput) -> ExternResult<()> {
    create_link(
        input.original,
        input.file_hash,
        LinkTypes::DocumentToFile,
        (),
    )?;
    Ok(())
}

#[hdk_extern]
pub fn detach_file(input: AttachInput) -> ExternResult<()> {
    for link in attachment_links(&input.original)? {
        if EntryHash::try_from(link.target.clone()).ok().as_ref() == Some(&input.file_hash) {
            delete_link(link.create_link_hash, GetOptions::local())?;
        }
    }
    Ok(())
}

#[hdk_extern]
pub fn get_attachments(original: ActionHash) -> ExternResult<Vec<EntryHash>> {
    let mut out: Vec<EntryHash> = attachment_links(&original)?
        .into_iter()
        .filter_map(|link| EntryHash::try_from(link.target).ok())
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}
