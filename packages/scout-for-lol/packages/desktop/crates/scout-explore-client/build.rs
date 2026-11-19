//! Generates the Rust side of `desktop-api.contract.json`.
//!
//! The route table, the refusal statuses and the stream event names come from
//! the language-neutral contract, so a route or refusal the server adds or
//! removes fails this build instead of drifting silently. Refusal codes are
//! matched against `scout_client_core::desktop_api::DesktopApiErrorCode` by
//! name: a code the enum lacks, or a variant the contract no longer lists,
//! does not compile.

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    error::Error,
    fs,
    io::{self, ErrorKind},
    path::PathBuf,
};

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopContract {
    contract_version: u32,
    minimum_contract_version: u32,
    header: String,
    scopes: Vec<String>,
    pairing_scopes: Vec<String>,
    routes: BTreeMap<String, ContractRoute>,
    stream_events: Vec<String>,
    voice_turn: VoiceTurnContract,
    native_visualization_kinds: Vec<String>,
    errors: BTreeMap<String, u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VoiceTurnContract {
    triggers: Vec<String>,
    audio: VoiceAudio,
    speech: VoiceSpeech,
    events: Vec<String>,
    errors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VoiceAudio {
    media_type: String,
    sample_rate_hz: u32,
    channels: u16,
    bits_per_sample: u16,
    min_duration_ms: u32,
    max_duration_ms: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VoiceSpeech {
    encoding: String,
    sample_rate_hz: u32,
    channels: u16,
    max_chunk_bytes: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ContractRoute {
    method: String,
    path: String,
    scope: Option<String>,
    response: String,
}

const PATH_PREFIX: &str = "/api/scout-client/v1/";

fn invalid_contract(message: impl Into<String>) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, message.into())
}

/// `explore_runs_start` to `ExploreRunsStart`, refusing anything that is not
/// lowercase snake case.
fn pascal_case(name: &str) -> Result<String, io::Error> {
    let valid = !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && !name.split('_').any(str::is_empty);
    if !valid {
        return Err(invalid_contract(format!(
            "{name:?} must be lowercase snake_case"
        )));
    }
    let mut pascal = String::with_capacity(name.len());
    for word in name.split('_') {
        let mut characters = word.chars();
        if let Some(first) = characters.next() {
            pascal.extend(first.to_uppercase());
            pascal.extend(characters);
        }
    }
    Ok(pascal)
}

fn validate(contract: &DesktopContract) -> Result<(), io::Error> {
    if contract.minimum_contract_version == 0
        || contract.minimum_contract_version > contract.contract_version
    {
        return Err(invalid_contract(
            "minimumContractVersion must be positive and at most contractVersion",
        ));
    }
    if contract.header.is_empty()
        || !contract
            .header
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(invalid_contract("header must be a plain HTTP header name"));
    }
    let scopes: BTreeSet<&str> = contract.scopes.iter().map(String::as_str).collect();
    if scopes.len() != contract.scopes.len()
        || contract
            .pairing_scopes
            .iter()
            .any(|scope| !scopes.contains(scope.as_str()))
    {
        return Err(invalid_contract(
            "scopes must be unique and pairingScopes a subset of them",
        ));
    }
    let mut streaming = 0;
    for (name, route) in &contract.routes {
        pascal_case(name)?;
        if route.method != "POST" {
            return Err(invalid_contract(format!("route {name} must be POST")));
        }
        if !route.path.starts_with(PATH_PREFIX)
            || !route.path.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'/' | b'_' | b'-')
            })
        {
            return Err(invalid_contract(format!(
                "route {name} must live under {PATH_PREFIX} with a plain path"
            )));
        }
        if let Some(scope) = &route.scope
            && !scopes.contains(scope.as_str())
        {
            return Err(invalid_contract(format!(
                "route {name} names unknown scope {scope:?}"
            )));
        }
        match route.response.as_str() {
            "json" | "png" => {}
            "event-stream" => streaming += 1,
            other => {
                return Err(invalid_contract(format!(
                    "route {name} has unknown response kind {other:?}"
                )));
            }
        }
    }
    if streaming == 0 {
        return Err(invalid_contract("some route must be an event stream"));
    }
    validate_voice_turn(&contract.voice_turn)?;
    if contract.stream_events.is_empty()
        || contract.stream_events.iter().collect::<BTreeSet<_>>().len()
            != contract.stream_events.len()
    {
        return Err(invalid_contract(
            "streamEvents must be unique and non-empty",
        ));
    }
    for event in &contract.stream_events {
        pascal_case(event)?;
    }
    validate_native_kinds(&contract.native_visualization_kinds)?;
    for (code, status) in &contract.errors {
        pascal_case(code)?;
        if !(400..=599).contains(status) {
            return Err(invalid_contract(format!(
                "refusal {code} must have a 4xx or 5xx status"
            )));
        }
    }
    Ok(())
}

/// Names that are unique, non-empty and lowercase snake case.
fn validate_names(what: &str, names: &[String]) -> Result<(), io::Error> {
    if names.is_empty() || names.iter().collect::<BTreeSet<_>>().len() != names.len() {
        return Err(invalid_contract(format!(
            "{what} must be unique and non-empty"
        )));
    }
    for name in names {
        pascal_case(name)?;
    }
    Ok(())
}

fn validate_voice_turn(voice: &VoiceTurnContract) -> Result<(), io::Error> {
    validate_names("voiceTurn.triggers", &voice.triggers)?;
    validate_names("voiceTurn.events", &voice.events)?;
    validate_names("voiceTurn.errors", &voice.errors)?;
    let audio = &voice.audio;
    if audio.media_type != "audio/wav"
        || audio.channels != 1
        || audio.bits_per_sample != 16
        || audio.sample_rate_hz == 0
        || audio.min_duration_ms == 0
        || audio.min_duration_ms >= audio.max_duration_ms
    {
        return Err(invalid_contract(
            "voiceTurn.audio must be mono 16-bit WAV with a positive duration range",
        ));
    }
    let speech = &voice.speech;
    if speech.encoding != "pcm_s16le"
        || speech.channels != 1
        || speech.sample_rate_hz == 0
        || speech.max_chunk_bytes == 0
        || !speech.max_chunk_bytes.is_multiple_of(2)
    {
        return Err(invalid_contract(
            "voiceTurn.speech must be mono pcm_s16le in whole-sample chunks",
        ));
    }
    Ok(())
}

fn validate_native_kinds(kinds: &[String]) -> Result<(), io::Error> {
    let unique: BTreeSet<&str> = kinds.iter().map(String::as_str).collect();
    if unique.is_empty()
        || unique.len() != kinds.len()
        || unique.iter().any(|kind| {
            kind.is_empty()
                || !kind
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte == b'_')
        })
    {
        return Err(invalid_contract(
            "nativeVisualizationKinds must be unique, non-empty SCREAMING_SNAKE_CASE",
        ));
    }
    Ok(())
}

/// The body of a `const fn` that is true for `variants` alone.
fn matches_any(variants: &[String]) -> String {
    if variants.is_empty() {
        "false".to_owned()
    } else {
        format!("matches!(self, {})", variants.join(" | "))
    }
}

/// Each string as a Rust string literal, comma-separated.
fn literals(values: &[String]) -> String {
    values
        .iter()
        .map(|value| format!("{value:?}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `refusal_status`'s match arms: each refusal code and its HTTP status.
fn refusal_arms(errors: &BTreeMap<String, u16>) -> Result<String, io::Error> {
    let statuses = errors
        .iter()
        .map(|(code, status)| {
            pascal_case(code).map(|variant| {
                (
                    format!("DesktopApiErrorCode::{variant}"),
                    status.to_string(),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(grouped_arms("        ", statuses))
}

/// Match arms with one arm per distinct value, so equal values share an arm.
fn grouped_arms(indent: &str, pairs: Vec<(String, String)>) -> String {
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (pattern, value) in pairs {
        groups.entry(value).or_default().push(pattern);
    }
    groups
        .into_iter()
        .map(|(value, patterns)| format!("{indent}{} => {value},", patterns.join(" | ")))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `coach/voice/turns`' constants: its vocabulary, upload and speech.
fn render_voice(voice: &VoiceTurnContract) -> String {
    format!(
        r"/// Every `coach/voice/turns` event type, in contract order.
pub const VOICE_TURN_EVENT_TYPES: &[&str] = &[{events}];
/// Every `coach/voice/turns` in-stream refusal code, in contract order.
pub const VOICE_TURN_ERROR_CODES: &[&str] = &[{errors}];
/// What may start a voice turn's recording.
pub const VOICE_TURN_TRIGGERS: &[&str] = &[{triggers}];
/// A voice turn's upload: its media type.
pub const VOICE_MEDIA_TYPE: &str = {media_type:?};
/// A voice turn's upload: samples per second.
pub const VOICE_SAMPLE_RATE_HZ: u32 = {rate};
/// The shortest utterance the server reads as speech.
pub const VOICE_MIN_DURATION_MS: u32 = {min};
/// The longest utterance the desktop records.
pub const VOICE_MAX_DURATION_MS: u32 = {max};
/// The spoken answer's sample encoding.
pub const SPEECH_ENCODING: &str = {encoding:?};
/// The spoken answer's samples per second.
pub const SPEECH_SAMPLE_RATE_HZ: u32 = {speech_rate};
/// The largest PCM chunk one `audio` event carries.
pub const SPEECH_MAX_CHUNK_BYTES: u32 = {chunk};
",
        events = literals(&voice.events),
        errors = literals(&voice.errors),
        triggers = literals(&voice.triggers),
        media_type = voice.audio.media_type,
        rate = voice.audio.sample_rate_hz,
        min = voice.audio.min_duration_ms,
        max = voice.audio.max_duration_ms,
        encoding = voice.speech.encoding,
        speech_rate = voice.speech.sample_rate_hz,
        chunk = voice.speech.max_chunk_bytes,
    )
}

fn render(contract: &DesktopContract) -> Result<String, io::Error> {
    let mut variants = Vec::new();
    let mut names = Vec::new();
    let mut paths = Vec::new();
    let mut scopes = Vec::new();
    let mut streaming = Vec::new();
    let mut images = Vec::new();
    for (name, route) in &contract.routes {
        let variant = pascal_case(name)?;
        variants.push(format!(
            "    /// `{} {}`.\n    {variant},",
            route.method, route.path
        ));
        names.push(format!("            Self::{variant} => {name:?},"));
        paths.push(format!("            Self::{variant} => {:?},", route.path));
        let scope = match route.scope.as_deref() {
            None => "None".to_owned(),
            Some(scope) => format!("Some(DeviceScope::{})", pascal_case(scope)?),
        };
        scopes.push((format!("Self::{variant}"), scope));
        if route.response == "event-stream" {
            streaming.push(format!("Self::{variant}"));
        }
        if route.response == "png" {
            images.push(format!("Self::{variant}"));
        }
    }
    let all = contract
        .routes
        .keys()
        .map(|name| pascal_case(name).map(|variant| format!("Self::{variant}")))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let events = literals(&contract.stream_events);
    let statuses = refusal_arms(&contract.errors)?;
    let scopes = grouped_arms("            ", scopes);
    let streaming = streaming.join(" | ");
    let images = matches_any(&images);
    let native_kinds = literals(&contract.native_visualization_kinds);
    Ok(format!(
        r"// Generated from desktop-api.contract.json by build.rs. Do not edit.

/// Desktop contract version this build declares on every request.
pub const CONTRACT_VERSION: u32 = {version};
/// Oldest contract version the server still accepts.
pub const MINIMUM_CONTRACT_VERSION: u32 = {minimum};
/// Request and response header carrying the contract version.
pub const CONTRACT_HEADER: &str = {header:?};

/// One route of the desktop REST surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Route {{
{variants}
}}

impl Route {{
    /// Every route, in contract order.
    pub const ALL: [Self; {count}] = [{all}];

    /// The route's name in the contract.
    #[must_use]
    pub const fn name(self) -> &'static str {{
        match self {{
{names}
        }}
    }}

    /// Absolute request path.
    #[must_use]
    pub const fn path(self) -> &'static str {{
        match self {{
{paths}
        }}
    }}

    /// Scope the device credential must hold, or none for pairing.
    #[must_use]
    pub const fn scope(self) -> Option<DeviceScope> {{
        match self {{
{scopes}
        }}
    }}

    /// Whether the route answers with `text/event-stream`.
    #[must_use]
    pub const fn streams(self) -> bool {{
        matches!(self, {streaming})
    }}

    /// Whether the route answers with one `image/png` body.
    #[must_use]
    pub const fn answers_png(self) -> bool {{
        {images}
    }}
}}

/// Every `runs/stream` event type, in contract order.
pub const STREAM_EVENT_TYPES: &[&str] = &[{events}];

{voice}
/// Chart kinds drawn as native rows, not as the server's PNG.
pub const NATIVE_VISUALIZATION_KINDS: &[&str] = &[{native_kinds}];

/// The HTTP status the contract gives a refusal.
#[must_use]
pub const fn refusal_status(code: DesktopApiErrorCode) -> u16 {{
    match code {{
{statuses}
    }}
}}
",
        version = contract.contract_version,
        minimum = contract.minimum_contract_version,
        header = contract.header,
        variants = variants.join("\n"),
        count = contract.routes.len(),
        names = names.join("\n"),
        paths = paths.join("\n"),
        voice = render_voice(&contract.voice_turn),
    ))
}

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR")
            .ok_or_else(|| invalid_contract("CARGO_MANIFEST_DIR is not set"))?,
    );
    let contract_path =
        manifest_dir.join("../../../data/src/scout-client/desktop-api.contract.json");
    println!("cargo:rerun-if-changed={}", contract_path.display());
    let contract: DesktopContract = serde_json::from_str(&fs::read_to_string(&contract_path)?)?;
    validate(&contract)?;
    let output_dir = PathBuf::from(
        env::var_os("OUT_DIR").ok_or_else(|| invalid_contract("OUT_DIR is not set"))?,
    );
    fs::write(output_dir.join("desktop_contract.rs"), render(&contract)?)?;
    Ok(())
}
