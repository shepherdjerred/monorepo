//! Generates the Rust side of the shared Scout Client wire contract.

use std::{
    collections::BTreeSet,
    env,
    error::Error,
    fs,
    io::{self, ErrorKind},
    path::PathBuf,
};

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProtocolContract {
    protocol_version: u16,
    observation_schema_version: u16,
    max_batch_bytes: usize,
    max_batch_observations: usize,
    payload: PayloadLimits,
    envelope_string_max_bytes: EnvelopeStringLimits,
    observation_kinds: Vec<String>,
    quarantine_reasons: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PayloadLimits {
    max_depth: usize,
    max_array_items: usize,
    max_object_keys: usize,
    max_string_bytes: usize,
    max_key_bytes: usize,
    unsafe_keys: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopeStringLimits {
    app_version: usize,
    league_patch: usize,
    platform_id: usize,
    local_puuid: usize,
    lobby_id: usize,
    game_id: usize,
}

fn invalid_contract(message: impl Into<String>) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, message.into())
}

fn require_positive(name: &str, value: usize) -> Result<(), io::Error> {
    if value == 0 {
        return Err(invalid_contract(format!("{name} must be positive")));
    }
    Ok(())
}

fn rust_variant(kind: &str) -> Result<String, io::Error> {
    if kind.is_empty()
        || !kind
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        || kind.split('_').any(str::is_empty)
    {
        return Err(invalid_contract(format!(
            "observation kind {kind:?} must be lowercase snake_case"
        )));
    }

    let mut variant = String::new();
    for word in kind.split('_') {
        let mut characters = word.chars();
        let first = characters
            .next()
            .ok_or_else(|| invalid_contract("observation kind contains an empty word"))?;
        variant.extend(first.to_uppercase());
        variant.extend(characters);
    }
    Ok(variant)
}

fn quoted_slice(values: &[String]) -> String {
    values
        .iter()
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn rust_usize(value: usize) -> String {
    let digits = value.to_string();
    let mut literal = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            literal.push('_');
        }
        literal.push(digit);
    }
    literal
}

fn validate_contract(contract: &ProtocolContract) -> Result<(), io::Error> {
    require_positive("protocolVersion", usize::from(contract.protocol_version))?;
    require_positive(
        "observationSchemaVersion",
        usize::from(contract.observation_schema_version),
    )?;
    for (name, value) in [
        ("maxBatchBytes", contract.max_batch_bytes),
        ("maxBatchObservations", contract.max_batch_observations),
        ("payload.maxDepth", contract.payload.max_depth),
        ("payload.maxArrayItems", contract.payload.max_array_items),
        ("payload.maxObjectKeys", contract.payload.max_object_keys),
        ("payload.maxStringBytes", contract.payload.max_string_bytes),
        ("payload.maxKeyBytes", contract.payload.max_key_bytes),
        (
            "envelopeStringMaxBytes.appVersion",
            contract.envelope_string_max_bytes.app_version,
        ),
        (
            "envelopeStringMaxBytes.leaguePatch",
            contract.envelope_string_max_bytes.league_patch,
        ),
        (
            "envelopeStringMaxBytes.platformId",
            contract.envelope_string_max_bytes.platform_id,
        ),
        (
            "envelopeStringMaxBytes.localPuuid",
            contract.envelope_string_max_bytes.local_puuid,
        ),
        (
            "envelopeStringMaxBytes.lobbyId",
            contract.envelope_string_max_bytes.lobby_id,
        ),
        (
            "envelopeStringMaxBytes.gameId",
            contract.envelope_string_max_bytes.game_id,
        ),
    ] {
        require_positive(name, value)?;
    }
    if contract.max_batch_bytes <= 19 {
        return Err(invalid_contract(
            "maxBatchBytes must exceed envelope overhead",
        ));
    }
    if contract.payload.unsafe_keys.is_empty() {
        return Err(invalid_contract("payload.unsafeKeys must not be empty"));
    }
    if contract.observation_kinds.is_empty() {
        return Err(invalid_contract("observationKinds must not be empty"));
    }
    if contract.quarantine_reasons.is_empty() {
        return Err(invalid_contract("quarantineReasons must not be empty"));
    }
    Ok(())
}

fn enum_variants(values: &[String], label: &str) -> Result<String, io::Error> {
    let mut seen_kinds = BTreeSet::new();
    let mut variants = Vec::with_capacity(values.len());
    for kind in values {
        if !seen_kinds.insert(kind) {
            return Err(invalid_contract(format!("{label} {kind:?} is duplicated")));
        }
        variants.push(format!(
            "    /// The `{kind}` {label}.\n    #[serde(rename = {kind:?})]\n    {}",
            rust_variant(kind)?,
        ));
    }
    Ok(variants.join(",\n"))
}

fn render_contract(contract: &ProtocolContract) -> Result<String, io::Error> {
    Ok(format!(
        r"// Generated from protocol.contract.json by build.rs. Do not edit.
/// Current wire protocol version.
pub const PROTOCOL_VERSION: u16 = {};
/// Current observation envelope schema version.
pub const OBSERVATION_SCHEMA_VERSION: u16 = {};
/// Maximum JSON request body accepted by the Scout ingress route.
pub const MAX_OBSERVATION_BATCH_BYTES: usize = {};
/// Maximum observations accepted in one ordered batch.
pub const MAX_OBSERVATION_BATCH_ITEMS: usize = {};
const MAX_JSON_DEPTH: usize = {};
const MAX_ARRAY_ITEMS: usize = {};
const MAX_OBJECT_KEYS: usize = {};
const MAX_STRING_BYTES: usize = {};
const MAX_KEY_BYTES: usize = {};
const UNSAFE_KEYS: &[&str] = &[{}];
const APP_VERSION_MAX_BYTES: usize = {};
const LEAGUE_PATCH_MAX_BYTES: usize = {};
const PLATFORM_ID_MAX_BYTES: usize = {};
const LOCAL_PUUID_MAX_BYTES: usize = {};
const LOBBY_ID_MAX_BYTES: usize = {};
const GAME_ID_MAX_BYTES: usize = {};

/// A curated, gameplay-only observation family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObservationKind {{
{}
}}

/// Why an otherwise well-formed observation was quarantined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObservationQuarantineReason {{
{}
}}
",
        contract.protocol_version,
        contract.observation_schema_version,
        rust_usize(contract.max_batch_bytes),
        rust_usize(contract.max_batch_observations),
        rust_usize(contract.payload.max_depth),
        rust_usize(contract.payload.max_array_items),
        rust_usize(contract.payload.max_object_keys),
        rust_usize(contract.payload.max_string_bytes),
        rust_usize(contract.payload.max_key_bytes),
        quoted_slice(&contract.payload.unsafe_keys),
        rust_usize(contract.envelope_string_max_bytes.app_version),
        rust_usize(contract.envelope_string_max_bytes.league_patch),
        rust_usize(contract.envelope_string_max_bytes.platform_id),
        rust_usize(contract.envelope_string_max_bytes.local_puuid),
        rust_usize(contract.envelope_string_max_bytes.lobby_id),
        rust_usize(contract.envelope_string_max_bytes.game_id),
        enum_variants(&contract.observation_kinds, "observation family")?,
        enum_variants(&contract.quarantine_reasons, "quarantine reason")?,
    ))
}

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .ok_or_else(|| invalid_contract("CARGO_MANIFEST_DIR is not set"))?;
    let contract_path =
        PathBuf::from(manifest_dir).join("../../../data/src/scout-client/protocol.contract.json");
    println!("cargo:rerun-if-changed={}", contract_path.display());

    let contract_json = fs::read_to_string(&contract_path)?;
    let contract: ProtocolContract = serde_json::from_str(&contract_json)?;
    validate_contract(&contract)?;

    let output_dir =
        env::var_os("OUT_DIR").ok_or_else(|| invalid_contract("OUT_DIR is not set"))?;
    fs::write(
        PathBuf::from(output_dir).join("protocol_contract.rs"),
        render_contract(&contract)?,
    )?;
    Ok(())
}
