use hdk::prelude::*;

/// One payload for every peer notification. Each variant carries only the
/// hashes the receiver needs to patch its store and search index — never the
/// document body, which the receiver fetches itself.
#[derive(Serialize, Deserialize, SerializedBytes, Debug, Clone)]
#[serde(tag = "type")]
pub enum ArkSignal {
    DocumentCreated { original: ActionHash },
    DocumentAmended { original: ActionHash, new_version: ActionHash },
    DocumentTrashed { original: ActionHash },
    DocumentRestored { original: ActionHash },
    DocumentMoved { original: ActionHash, from: Option<String>, to: Option<String> },
    TreeUpdated { action: ActionHash },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NotifyInput {
    pub peers: Vec<AgentPubKey>,
    pub signal: ArkSignal,
}

#[hdk_extern]
pub fn notify_peers(input: NotifyInput) -> ExternResult<()> {
    let encoded = ExternIO::encode(input.signal)
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;
    send_remote_signal(encoded, input.peers)
}

#[hdk_extern]
pub fn recv_remote_signal(signal: ExternIO) -> ExternResult<()> {
    let payload: ArkSignal = signal
        .decode()
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;
    emit_signal(payload)
}
