pub mod attachment;
pub mod document;
pub mod folder;
pub mod resolve;
pub mod signals;
pub mod trash;
pub mod types;

use hdk::prelude::*;

#[hdk_extern]
pub fn init(_: ()) -> ExternResult<InitCallbackResult> {
    let mut functions = HashSet::new();
    functions.insert((zome_info()?.name, FunctionName("recv_remote_signal".into())));
    create_cap_grant(CapGrantEntry::new(
        String::from("Receiving remote signals"),
        ().into(),
        GrantedFunctions::Listed(functions),
    ))?;
    Ok(InitCallbackResult::Pass)
}

#[hdk_extern]
pub fn whoami(_: ()) -> ExternResult<AgentPubKey> {
    Ok(agent_info()?.agent_initial_pubkey)
}
