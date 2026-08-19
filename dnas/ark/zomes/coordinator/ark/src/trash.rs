use ark_integrity::*;
use hdk::prelude::*;

fn trash_links() -> ExternResult<Vec<Link>> {
    get_links(
        LinkQuery::try_new(
            Path::from(TRASH).path_entry_hash()?,
            LinkTypes::TrashedDocuments,
        )?,
        GetStrategy::Local,
    )
}

#[hdk_extern]
pub fn trash_document(original: ActionHash) -> ExternResult<()> {
    create_link(
        Path::from(TRASH).path_entry_hash()?,
        original,
        LinkTypes::TrashedDocuments,
        (),
    )?;
    Ok(())
}

/// Removes every trash link for this document. Two agents trashing the same
/// document produce two links; one restore must clear all of them.
#[hdk_extern]
pub fn restore_document(original: ActionHash) -> ExternResult<()> {
    for link in trash_links()? {
        if ActionHash::try_from(link.target.clone()).ok().as_ref() == Some(&original) {
            delete_link(link.create_link_hash, GetOptions::local())?;
        }
    }
    Ok(())
}

#[hdk_extern]
pub fn get_trashed(_: ()) -> ExternResult<Vec<ActionHash>> {
    let mut out: Vec<ActionHash> = trash_links()?
        .into_iter()
        .filter_map(|link| ActionHash::try_from(link.target).ok())
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}
