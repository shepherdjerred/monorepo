//! Scout Desktop's authenticated Explore REST contract.
//!
//! The wire contract is `data/src/scout-client/desktop-api.contract.json` and
//! its golden bodies live in `data/src/scout-client/desktop-fixtures/`. The
//! backend validates the same files with Zod; the tests here hold these strict
//! serde types to them, so either side drifting fails its own suite.
//!
//! These are the envelopes the pairing flow and the Explore client share.
//! Transcript messages and `runs/stream` frames are typed in the
//! `scout-explore-client` crate, together with the turn reducer that reads
//! them.
//!
//! Every body is strict in both directions. A route never gains a field: a
//! change ships as a new route and a contract version bump. An enum never
//! gains a member for a build that predates it either; the server down-shapes
//! to the version a request declares.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Request header carrying the client's desktop contract version.
pub const DESKTOP_CONTRACT_HEADER: &str = "X-Scout-Desktop-Contract";
/// Desktop contract version this build speaks.
pub const DESKTOP_CONTRACT_VERSION: u32 = 2;
/// Path of the route that starts an Explore turn.
pub const EXPLORE_RUNS_START_PATH: &str = "/api/scout-client/v1/explore/runs/start";
/// Path of the route that stops a running turn.
pub const EXPLORE_RUNS_STOP_PATH: &str = "/api/scout-client/v1/explore/runs/stop";
/// Path of the route that lists the owner's running turns.
pub const EXPLORE_RUNS_ACTIVE_PATH: &str = "/api/scout-client/v1/explore/runs/active";
/// Path of the route that reads a finished turn's outcome.
pub const EXPLORE_RUNS_OUTCOME_PATH: &str = "/api/scout-client/v1/explore/runs/outcome";
/// Path of the `text/event-stream` route that observes a running turn.
pub const EXPLORE_RUNS_STREAM_PATH: &str = "/api/scout-client/v1/explore/runs/stream";
/// Path of the pairing route that asks for `ingest` and `explore`.
pub const PAIRINGS_V2_PATH: &str = "/api/scout-client/v1/pairings/v2";
/// Path of the Explore status route.
pub const EXPLORE_STATUS_PATH: &str = "/api/scout-client/v1/explore/status";
/// Path of the conversation list route.
pub const EXPLORE_CONVERSATIONS_LIST_PATH: &str = "/api/scout-client/v1/explore/conversations/list";
/// Path of the conversation transcript route.
pub const EXPLORE_CONVERSATIONS_GET_PATH: &str = "/api/scout-client/v1/explore/conversations/get";

/// What a device credential may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceScope {
    /// Upload captured games.
    Ingest,
    /// Read and ask Explore as the device's owner.
    Explore,
}

/// A typed refusal from a desktop route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopApiErrorCode {
    /// The body does not match the route.
    InvalidRequest,
    /// The turn cannot start as asked, such as answering a missing question.
    InvalidTurn,
    /// No active device credential.
    Unauthorized,
    /// The owner's Discord grant expired; they must sign in on the web again.
    ReauthorizeRequired,
    /// The device was paired without the route's scope; pair again.
    ScopeRequired,
    /// The owner shares no server that may use Explore.
    ExploreForbidden,
    /// The conversation or run does not exist or belongs to someone else.
    NotFound,
    /// The conversation already has an answer running.
    ConversationBusy,
    /// This build's contract is older than the server accepts.
    ContractUnsupported,
    /// Too many requests from this device.
    RateLimited,
    /// The owner's Explore quota, shared with every surface, is spent or
    /// already running a turn; `Retry-After` says when to try again.
    QuotaExceeded,
    /// This device already holds as many open streams as it may.
    StreamLimit,
    /// Scout could not verify access or start the turn right now; retry.
    Unavailable,
    /// Explore in Scout Desktop is turned off for this owner.
    FeatureDisabled,
}

/// Body of every desktop refusal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopApiError {
    /// Stable refusal code.
    pub error: DesktopApiErrorCode,
    /// Human-readable explanation, safe to show.
    pub message: String,
}

/// Response from `pairings/v2`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingV2Response {
    /// Public pairing identifier.
    pub pairing_id: Uuid,
    /// One-time polling secret.
    pub pairing_secret: String,
    /// Browser approval URL.
    pub approval_url: String,
    /// RFC3339 expiry.
    pub expires_at: DateTime<Utc>,
    /// Scopes the approver is asked to grant.
    pub scopes: Vec<DeviceScope>,
    /// Code the approval page shows beside this request.
    pub match_code: String,
}

/// Body of a route that takes no input.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyRequest {}

/// Monthly provider spending visible to the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExploreSpending {
    /// `YYYY-MM`.
    pub month: String,
    /// Spent by everyone this month.
    pub global_used_micros: u64,
    /// Spent by the owner this month.
    pub user_used_micros: u64,
    /// Left for everyone this month.
    pub global_remaining_micros: u64,
    /// Left for the owner this month.
    pub user_remaining_micros: u64,
    /// When the month rolls over.
    pub resets_at: DateTime<Utc>,
}

/// Who a quota window counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaScope {
    /// The owner alone.
    User,
    /// Every Explore user.
    Global,
}

/// Length of a quota window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaWindow {
    /// One minute.
    Minute,
    /// One hour.
    Hour,
    /// One day.
    Day,
    /// One week.
    Week,
}

/// One Explore turn quota window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExploreQuota {
    /// Who the window counts.
    pub scope: QuotaScope,
    /// Window length.
    pub window: QuotaWindow,
    /// Turns used.
    pub used: u32,
    /// Turns allowed.
    pub limit: u32,
    /// Turns left.
    pub remaining: u32,
    /// When the window resets.
    pub resets_at: DateTime<Utc>,
}

/// Response from `explore/status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExploreStatusResponse {
    /// Whether the owner may choose a model.
    pub model_picker_enabled: bool,
    /// Monthly spending.
    pub spending: ExploreSpending,
    /// Turn quota windows.
    pub quota: Vec<ExploreQuota>,
}

/// Where a conversation was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationOrigin {
    /// Before origins were recorded.
    Legacy,
    /// Scout on the web.
    Web,
    /// `/scout ask` in Discord.
    Discord,
    /// Discord voice.
    Voice,
    /// Scout Desktop. A version-1 request is told `web` instead.
    Desktop,
}

/// One conversation in the owner's list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationSummary {
    /// Conversation id.
    pub id: Uuid,
    /// Title.
    pub title: String,
    /// Surface it was started on.
    pub origin: ConversationOrigin,
    /// Public share token, when shared.
    pub share_token: Option<String>,
    /// The leaf a share link is pinned to.
    pub shared_leaf_id: Option<Uuid>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

/// Response from `explore/conversations/list`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationListResponse {
    /// Most recently updated first.
    pub conversations: Vec<ConversationSummary>,
}

/// Request to `explore/conversations/get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationGetRequest {
    /// Conversation to read.
    pub conversation_id: Uuid,
}

/// The conversation header of a transcript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationDetail {
    /// Conversation id.
    pub id: Uuid,
    /// Title.
    pub title: String,
    /// Model the owner last chose, if any.
    pub preferred_model: Option<String>,
    /// Surface it was started on.
    pub origin: ConversationOrigin,
    /// Public share token, when shared.
    pub share_token: Option<String>,
    /// The leaf a share link is pinned to.
    pub shared_leaf_id: Option<Uuid>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

/// Where a turn attaches in the conversation tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AttachPoint {
    /// Continue the branch on screen.
    Leaf,
    /// Fork the opening question.
    Root,
    /// Attach under one message: an edit names the edited question's parent,
    /// a regenerate names the question to answer again.
    Message {
        /// The message to attach under.
        message_id: Uuid,
    },
}

/// A model the owner may pick when the server enables the picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExploreModel {
    /// The default model.
    #[serde(rename = "gpt-6-luna")]
    Luna,
    /// The larger model.
    #[serde(rename = "gpt-6.1-sol")]
    Sol,
}

/// Request to `explore/runs/start`: the web's `explore.start` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunStartRequest {
    /// The conversation to continue, or none to start a new one.
    pub conversation_id: Option<Uuid>,
    /// The question, or none to answer an existing question again.
    pub question: Option<String>,
    /// Where the turn attaches.
    pub attach: AttachPoint,
    /// A model choice; omitted unless the owner picked one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ExploreModel>,
    /// Uploaded images for a new question; omitted when there are none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_ids: Option<Vec<Uuid>>,
}

/// A turn the server is answering: the answer to `runs/start`, and each entry
/// of `runs/active`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveRun {
    /// Run id, used to stop or observe it.
    pub run_id: Uuid,
    /// The conversation it answers in.
    pub conversation_id: Uuid,
    /// The question it answers.
    pub question_message_id: Uuid,
    /// The leaf on screen when it began.
    pub leaf_id_at_start: Option<Uuid>,
    /// Answers to this question that existed when it began.
    pub version_count_at_start: u32,
    /// When it began.
    pub started_at: DateTime<Utc>,
}

/// Request naming one run: `runs/stop`, `runs/outcome` and `runs/stream`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRequest {
    /// The run.
    pub run_id: Uuid,
}

/// Response from `runs/stop`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStopResponse {
    /// Always true; a run that cannot be stopped is a `not_found` refusal.
    pub ok: bool,
}

/// Response from `runs/active`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunActiveResponse {
    /// The owner's runs on every surface, oldest first.
    pub runs: Vec<ActiveRun>,
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    /// It answered.
    Succeeded,
    /// It failed.
    Failed,
    /// The owner stopped it.
    Stopped,
    /// An error interrupted it mid-answer.
    Interrupted,
}

/// Response from `runs/outcome`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunOutcomeResponse {
    /// How the run ended, or none while it runs or once forgotten.
    pub outcome: Option<RunOutcome>,
}

/// How a route answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteResponseKind {
    /// One JSON body.
    Json,
    /// A `text/event-stream` of [`StreamEvent`] frames.
    EventStream,
}

/// One route in the shared contract.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopRoute {
    /// HTTP method.
    pub method: String,
    /// Absolute path.
    pub path: String,
    /// Scope the device must hold, or none for pairing.
    pub scope: Option<DeviceScope>,
    /// How the route answers.
    pub response: RouteResponseKind,
}

/// The shared contract file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopApiContract {
    /// Newest contract version the server speaks.
    pub contract_version: u32,
    /// Oldest contract version the server accepts.
    pub minimum_contract_version: u32,
    /// Version header name.
    pub header: String,
    /// Every scope.
    pub scopes: Vec<DeviceScope>,
    /// Scopes a `pairings/v2` request asks for.
    pub pairing_scopes: Vec<DeviceScope>,
    /// Routes by name.
    pub routes: BTreeMap<String, DesktopRoute>,
    /// Every `runs/stream` event type.
    pub stream_events: Vec<String>,
    /// Refusal codes and their HTTP status.
    pub errors: BTreeMap<DesktopApiErrorCode, u16>,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use serde_json::Value;

    use super::{
        ActiveRun, ConversationListResponse, DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION,
        DesktopApiContract, DesktopApiError, DeviceScope, EXPLORE_CONVERSATIONS_GET_PATH,
        EXPLORE_CONVERSATIONS_LIST_PATH, EXPLORE_RUNS_ACTIVE_PATH, EXPLORE_RUNS_OUTCOME_PATH,
        EXPLORE_RUNS_START_PATH, EXPLORE_RUNS_STOP_PATH, EXPLORE_RUNS_STREAM_PATH,
        EXPLORE_STATUS_PATH, EmptyRequest, ExploreStatusResponse, PAIRINGS_V2_PATH,
        PairingV2Response, RouteResponseKind, RunActiveResponse, RunOutcomeResponse, RunRequest,
        RunStartRequest, RunStopResponse,
    };
    use crate::protocol::CreatePairingRequest;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const CONTRACT: &str =
        include_str!("../../../../data/src/scout-client/desktop-api.contract.json");
    const ERRORS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/errors.json");
    const PAIRINGS_V2: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/pairings-v2.json");
    const STATUS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-status.json");
    const LIST: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-list.json"
    );
    const GET: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get.json"
    );
    const RUNS_START: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-start.json");
    const RUNS_STOP: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-stop.json");
    const RUNS_ACTIVE: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-active.json");
    const RUNS_OUTCOME: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-runs-outcome.json"
    );
    const RUNS_STREAM: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-stream.json");

    /// Parse strictly, then prove serialising and parsing again is lossless.
    fn round_trip<T>(value: &Value) -> TestResult
    where
        T: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
    {
        let typed: T = serde_json::from_value(value.clone())?;
        let again: T = serde_json::from_value(serde_json::to_value(&typed)?)?;
        assert_eq!(typed, again);
        Ok(())
    }

    fn check_route<Request, Response>(fixture: &str, route: &str) -> TestResult
    where
        Request: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
        Response: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
    {
        let fixture: Value = serde_json::from_str(fixture)?;
        assert_eq!(fixture["route"], route);
        round_trip::<Request>(&fixture["request"])?;
        round_trip::<Response>(&fixture["response"])?;
        let invalid = fixture["invalidRequests"]
            .as_array()
            .ok_or("invalid requests")?;
        assert_ne!(invalid.len(), 0);
        for case in invalid {
            let reason = case["reason"].as_str().unwrap_or("?");
            assert!(
                serde_json::from_value::<Request>(case["body"].clone()).is_err(),
                "{route} must refuse {reason}"
            );
        }
        Ok(())
    }

    #[test]
    fn the_contract_parses_and_matches_this_build() -> TestResult {
        let contract: DesktopApiContract = serde_json::from_str(CONTRACT)?;
        assert_eq!(contract.header, DESKTOP_CONTRACT_HEADER);
        assert!(contract.minimum_contract_version <= DESKTOP_CONTRACT_VERSION);
        assert!(DESKTOP_CONTRACT_VERSION <= contract.contract_version);
        assert_eq!(
            contract.pairing_scopes,
            vec![DeviceScope::Ingest, DeviceScope::Explore]
        );
        let paths: BTreeMap<&str, &str> = contract
            .routes
            .iter()
            .map(|(name, route)| (name.as_str(), route.path.as_str()))
            .collect();
        assert_eq!(
            paths,
            BTreeMap::from([
                ("explore_conversations_get", EXPLORE_CONVERSATIONS_GET_PATH),
                (
                    "explore_conversations_list",
                    EXPLORE_CONVERSATIONS_LIST_PATH
                ),
                ("explore_runs_active", EXPLORE_RUNS_ACTIVE_PATH),
                ("explore_runs_outcome", EXPLORE_RUNS_OUTCOME_PATH),
                ("explore_runs_start", EXPLORE_RUNS_START_PATH),
                ("explore_runs_stop", EXPLORE_RUNS_STOP_PATH),
                ("explore_runs_stream", EXPLORE_RUNS_STREAM_PATH),
                ("explore_status", EXPLORE_STATUS_PATH),
                ("pairings_v2", PAIRINGS_V2_PATH),
            ])
        );
        assert!(contract.routes.values().all(|route| route.method == "POST"));
        let streaming: Vec<&str> = contract
            .routes
            .iter()
            .filter(|(_, route)| route.response == RouteResponseKind::EventStream)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(streaming, vec!["explore_runs_stream"]);
        Ok(())
    }

    #[test]
    fn every_route_has_a_golden_fixture() -> TestResult {
        let contract: DesktopApiContract = serde_json::from_str(CONTRACT)?;
        let mut named = Vec::new();
        for fixture in [
            PAIRINGS_V2,
            STATUS,
            LIST,
            GET,
            RUNS_START,
            RUNS_STOP,
            RUNS_ACTIVE,
            RUNS_OUTCOME,
            RUNS_STREAM,
        ] {
            let fixture: Value = serde_json::from_str(fixture)?;
            named.push(fixture["route"].as_str().ok_or("route name")?.to_owned());
        }
        named.sort();
        assert_eq!(named, contract.routes.keys().cloned().collect::<Vec<_>>());
        Ok(())
    }

    #[test]
    fn runs_start_fixture_parses_strictly() -> TestResult {
        check_route::<RunStartRequest, ActiveRun>(RUNS_START, "explore_runs_start")
    }

    #[test]
    fn a_start_request_omits_unset_options() -> TestResult {
        let fixture: Value = serde_json::from_str(RUNS_START)?;
        let request: RunStartRequest = serde_json::from_value(fixture["request"].clone())?;
        assert_eq!(serde_json::to_value(&request)?, fixture["request"]);
        Ok(())
    }

    #[test]
    fn runs_stop_fixture_parses_strictly() -> TestResult {
        check_route::<RunRequest, RunStopResponse>(RUNS_STOP, "explore_runs_stop")
    }

    #[test]
    fn runs_active_fixture_parses_strictly() -> TestResult {
        check_route::<EmptyRequest, RunActiveResponse>(RUNS_ACTIVE, "explore_runs_active")
    }

    #[test]
    fn runs_outcome_fixture_parses_strictly() -> TestResult {
        check_route::<RunRequest, RunOutcomeResponse>(RUNS_OUTCOME, "explore_runs_outcome")
    }

    #[test]
    fn every_error_fixture_parses_with_its_contract_status() -> TestResult {
        let contract: DesktopApiContract = serde_json::from_str(CONTRACT)?;
        let fixtures: Value = serde_json::from_str(ERRORS)?;
        let fixtures = fixtures["errors"].as_array().ok_or("error fixtures")?;
        let mut seen = Vec::new();
        for fixture in fixtures {
            let body: DesktopApiError = serde_json::from_value(fixture["body"].clone())?;
            assert_eq!(serde_json::to_value(&body)?, fixture["body"]);
            assert_eq!(
                contract.errors.get(&body.error).copied(),
                fixture["status"]
                    .as_u64()
                    .and_then(|s| u16::try_from(s).ok())
            );
            seen.push(body.error);
        }
        seen.sort();
        assert_eq!(seen, contract.errors.keys().copied().collect::<Vec<_>>());
        Ok(())
    }

    #[test]
    fn an_error_body_refuses_an_unknown_key() {
        let body = serde_json::json!({
            "error": "not_found",
            "message": "Conversation not found.",
            "detail": "extra",
        });
        assert!(serde_json::from_value::<DesktopApiError>(body).is_err());
    }

    #[test]
    fn pairing_v2_fixture_parses_strictly() -> TestResult {
        check_route::<CreatePairingRequest, PairingV2Response>(PAIRINGS_V2, "pairings_v2")
    }

    #[test]
    fn explore_status_fixture_parses_strictly() -> TestResult {
        check_route::<EmptyRequest, ExploreStatusResponse>(STATUS, "explore_status")
    }

    #[test]
    fn conversation_list_fixture_parses_strictly() -> TestResult {
        check_route::<EmptyRequest, ConversationListResponse>(LIST, "explore_conversations_list")
    }
}
