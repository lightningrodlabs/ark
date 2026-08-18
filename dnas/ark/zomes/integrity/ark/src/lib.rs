use hdi::prelude::*;

pub mod anchors;
pub use anchors::*;
pub mod document;
pub use document::*;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Document(Document),
}

#[derive(Serialize, Deserialize)]
#[hdk_link_types]
pub enum LinkTypes {
    AllDocuments,
}

#[hdk_extern]
pub fn genesis_self_check(_data: GenesisSelfCheckData) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

pub fn validate_agent_joining(
    _agent_pub_key: AgentPubKey,
    _membrane_proof: &Option<MembraneProof>,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

#[hdk_extern]
pub fn validate(op: Op) -> ExternResult<ValidateCallbackResult> {
    match op.flattened::<EntryTypes, LinkTypes>()? {
        FlatOp::CreateEntry(store_entry) => match store_entry {
            OpEntry::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::Document(d) => validate_create_document(action.into(), d),
            },
            OpEntry::UpdateEntry { app_entry, action, .. } => match app_entry {
                EntryTypes::Document(d) => validate_create_document(action.into(), d),
            },
            _ => Ok(ValidateCallbackResult::Valid),
        },
        _ => Ok(ValidateCallbackResult::Valid),
    }
}
