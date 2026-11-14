//! Scout Desktop's authenticated Explore REST contract.
//!
//! The wire contract is `data/src/scout-client/desktop-api.contract.json` and
//! its golden bodies live in `data/src/scout-client/desktop-fixtures/`. The
//! backend validates the same files with Zod; the tests here hold these strict
//! serde types to them, so either side drifting fails its own suite.
//!
//! Every body is strict in both directions. A route never gains a field: a
//! change ships as a new route and a contract version bump.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Request header carrying the client's desktop contract version.
pub const DESKTOP_CONTRACT_HEADER: &str = "X-Scout-Desktop-Contract";
/// Desktop contract version this build speaks.
pub const DESKTOP_CONTRACT_VERSION: u32 = 1;
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
    /// No active device credential.
    Unauthorized,
    /// The owner's Discord grant expired; they must sign in on the web again.
    ReauthorizeRequired,
    /// The device was paired without the route's scope; pair again.
    ScopeRequired,
    /// The owner shares no server that may use Explore.
    ExploreForbidden,
    /// The conversation does not exist or belongs to someone else.
    NotFound,
    /// This build's contract is older than the server accepts.
    ContractUnsupported,
    /// Too many reads from this device.
    RateLimited,
    /// Scout could not verify access right now; retry.
    Unavailable,
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

/// Response from `explore/conversations/get`.
///
/// Messages stay JSON here; the Explore client crate owns their typed model
/// together with the turn reducer that consumes them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationGetResponse {
    /// Conversation header.
    pub conversation: ConversationDetail,
    /// Messages on the current branch, oldest first.
    pub messages: Vec<Value>,
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
        ConversationGetRequest, ConversationGetResponse, ConversationListResponse,
        DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION, DesktopApiContract, DesktopApiError,
        DeviceScope, EXPLORE_CONVERSATIONS_GET_PATH, EXPLORE_CONVERSATIONS_LIST_PATH,
        EXPLORE_STATUS_PATH, EmptyRequest, ExploreStatusResponse, PAIRINGS_V2_PATH,
        PairingV2Response,
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
                ("explore_status", EXPLORE_STATUS_PATH),
                ("pairings_v2", PAIRINGS_V2_PATH),
            ])
        );
        assert!(contract.routes.values().all(|route| route.method == "POST"));
        Ok(())
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

    #[test]
    fn conversation_get_fixture_parses_strictly() -> TestResult {
        check_route::<ConversationGetRequest, ConversationGetResponse>(
            GET,
            "explore_conversations_get",
        )
    }
}
