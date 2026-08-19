pub mod pick;

#[cfg(target_arch = "wasm32")]
pub mod document;
#[cfg(target_arch = "wasm32")]
pub mod resolve;
#[cfg(target_arch = "wasm32")]
pub mod types;

#[cfg(target_arch = "wasm32")]
use hdk::prelude::*;

#[cfg(target_arch = "wasm32")]
#[hdk_extern]
pub fn init(_: ()) -> ExternResult<InitCallbackResult> {
    Ok(InitCallbackResult::Pass)
}

#[cfg(target_arch = "wasm32")]
#[hdk_extern]
pub fn whoami(_: ()) -> ExternResult<AgentPubKey> {
    Ok(agent_info()?.agent_initial_pubkey)
}
