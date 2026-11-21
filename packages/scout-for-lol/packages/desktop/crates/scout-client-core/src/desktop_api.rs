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

use crate::coach_context::{GameContext, LiveContext};

/// Request header carrying the client's desktop contract version.
pub const DESKTOP_CONTRACT_HEADER: &str = "X-Scout-Desktop-Contract";
/// Desktop contract version this build speaks.
pub const DESKTOP_CONTRACT_VERSION: u32 = 10;
/// Path of the route that starts an Explore turn.
pub const EXPLORE_RUNS_START_PATH: &str = "/api/scout-client/v1/explore/runs/start";
/// Path of the route that starts a turn Scout asks for itself.
pub const EXPLORE_RUNS_START_APP_PATH: &str = "/api/scout-client/v1/explore/runs/start-app";
/// Path of the beta-only route that asks for a proactive coach turn.
pub const COACH_TRIGGERS_PATH: &str = "/api/scout-client/v1/coach/triggers";
/// Path of the route that stops a running turn.
pub const EXPLORE_RUNS_STOP_PATH: &str = "/api/scout-client/v1/explore/runs/stop";
/// Path of the route that lists the owner's running turns.
pub const EXPLORE_RUNS_ACTIVE_PATH: &str = "/api/scout-client/v1/explore/runs/active";
/// Path of the route that reads a finished turn's outcome.
pub const EXPLORE_RUNS_OUTCOME_PATH: &str = "/api/scout-client/v1/explore/runs/outcome";
/// Path of the `text/event-stream` route that observes a running turn.
pub const EXPLORE_RUNS_STREAM_PATH: &str = "/api/scout-client/v1/explore/runs/stream";
/// Path of the route that reads the post-game review the server produced.
pub const COACH_REVIEWS_GET_PATH: &str = "/api/scout-client/v1/coach/reviews/get";
/// Path of the pairing route that asks for `ingest` and `explore`.
pub const PAIRINGS_V2_PATH: &str = "/api/scout-client/v1/pairings/v2";
/// Path of the route a paired device asks its owner to add scopes through.
pub const DEVICE_SCOPE_REQUESTS_PATH: &str = "/api/scout-client/v1/devices/current/scope-requests";
/// Path of the Explore status route.
pub const EXPLORE_STATUS_PATH: &str = "/api/scout-client/v1/explore/status";
/// Path of the conversation list route.
pub const EXPLORE_CONVERSATIONS_LIST_PATH: &str = "/api/scout-client/v1/explore/conversations/list";
/// Path of the conversation transcript route.
pub const EXPLORE_CONVERSATIONS_GET_PATH: &str = "/api/scout-client/v1/explore/conversations/get";
/// Path of the route that names the game asset version.
pub const EXPLORE_ASSETS_PATH: &str = "/api/scout-client/v1/explore/assets";
/// Path of the `image/png` route that draws one answer's chart.
pub const EXPLORE_VISUALIZATION_PATH: &str = "/api/scout-client/v1/explore/visualization";
/// Path of the `text/event-stream` route that answers one spoken question.
pub const COACH_VOICE_TURNS_PATH: &str = "/api/scout-client/v1/coach/voice/turns";
/// The content type of a `png` route's answer.
pub const PNG_CONTENT_TYPE: &str = "image/png";

/// What a device credential may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceScope {
    /// Upload captured games.
    Ingest,
    /// Read and ask Explore as the device's owner.
    Explore,
}

/// How the chat window gets its `explore` scope onto this computer.
///
/// A device that is already paired holds a valid token and only lacks a scope,
/// so it asks its owner to add the scope to that same device: its id, its
/// token and the outbox keyed by them stay exactly as they are. Only a
/// computer that is not paired at all starts a fresh pairing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatApprovalRoute {
    /// `devices/current/scope-requests`, authenticated by the existing token.
    ScopeUpgrade,
    /// `pairings/v2`, which issues a new device.
    FreshPairing,
}

impl ChatApprovalRoute {
    /// The route for a computer that is, or is not, paired.
    #[must_use]
    pub const fn for_paired(paired: bool) -> Self {
        if paired {
            Self::ScopeUpgrade
        } else {
            Self::FreshPairing
        }
    }
}

/// A typed refusal from a desktop route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopApiErrorCode {
    /// The body does not match the route.
    InvalidRequest,
    /// The turn cannot start as asked, such as answering a missing question.
    InvalidTurn,
    /// The turn's game context breaks the coach contract.
    InvalidGameContext,
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
    /// The device already holds every scope a scope request asked for.
    ScopeAlreadyGranted,
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

/// Body of `devices/current/scope-requests`: the scopes this device lacks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScopeRequest {
    /// Scopes the owner is asked to add to this device.
    pub scopes: Vec<DeviceScope>,
}

/// Response from `devices/current/scope-requests`.
///
/// There is no secret: the device authenticates with the token it already
/// holds, and approval changes that same device in place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopeRequestResponse {
    /// Public request identifier.
    pub request_id: Uuid,
    /// Browser approval URL.
    pub approval_url: String,
    /// RFC3339 expiry.
    pub expires_at: DateTime<Utc>,
    /// Scopes the owner is asked to add.
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

impl ExploreModel {
    /// The model's id on the wire, as the picker and `runs/start` name it.
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Luna => "gpt-6-luna",
            Self::Sol => "gpt-6.1-sol",
        }
    }
}

/// Request to `explore/runs/start`: the web's `explore.start` request, and
/// the game the player is in when they typed the question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// The game context of a question the player typed; omitted otherwise.
    /// The server refuses one on a turn without a question.
    #[serde(
        default,
        deserialize_with = "crate::coach_context::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub game_context: Option<GameContext>,
}

/// Why Scout started a turn without the player asking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppInitiation {
    /// A pick or ban changed in champion select. Carries `champ_select` only.
    AppChampSelect,
    /// The game began. Carries `pregame` only.
    AppPregame,
}

/// Request to `explore/runs/start-app`: a turn the app asks for. It has no
/// question (the server words it) and no `live` section, which the server
/// refuses on any turn the player did not start. Parsing holds the same line:
/// a body naming another section, a bad game key or a context that breaks the
/// coach contract is refused here as the server refuses it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "RawAppTurnRequest"
)]
pub struct AppTurnRequest {
    /// The conversation to continue, or none to start a new one.
    pub conversation_id: Option<Uuid>,
    /// Why the turn starts.
    pub initiation: AppInitiation,
    /// This champion select or game, which the server's per-game limit
    /// counts by: 1 to 64 letters, digits, `_` or `-`.
    pub game_key: String,
    /// The one section the initiation carries.
    pub game_context: GameContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAppTurnRequest {
    conversation_id: Option<Uuid>,
    initiation: AppInitiation,
    game_key: String,
    game_context: GameContext,
}

impl TryFrom<RawAppTurnRequest> for AppTurnRequest {
    type Error = String;

    fn try_from(raw: RawAppTurnRequest) -> Result<Self, String> {
        check_game_key(&raw.game_key)?;
        raw.game_context
            .validate()
            .map_err(|error| error.to_string())?;
        let context = &raw.game_context;
        let carries = |champ_select: bool, pregame: bool| {
            context.champ_select.is_some() == champ_select
                && context.pregame.is_some() == pregame
                && context.live.is_none()
                && context.postgame.is_none()
        };
        let allowed = match raw.initiation {
            AppInitiation::AppChampSelect => carries(true, false),
            AppInitiation::AppPregame => carries(false, true),
        };
        if !allowed {
            return Err(
                "an app-started turn carries only the section its initiation names, never live state"
                    .to_owned(),
            );
        }
        Ok(Self {
            conversation_id: raw.conversation_id,
            initiation: raw.initiation,
            game_key: raw.game_key,
            game_context: raw.game_context,
        })
    }
}

/// A game key: 1 to 64 letters, digits, `_` or `-`.
fn check_game_key(key: &str) -> Result<(), String> {
    let ok = (1..=64).contains(&key.len())
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if ok {
        Ok(())
    } else {
        Err("gameKey is 1 to 64 letters, digits, _ or -".to_owned())
    }
}

/// Which damage type an enemy team's completed damage items lean on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DamageProfile {
    /// Mostly physical damage items.
    Physical,
    /// Mostly magic damage items.
    Magic,
    /// Neither dominates.
    Mixed,
}

/// What a proactive detector saw between two consecutive live snapshots,
/// with the scoreboard values that show it. Nothing here is free text: every
/// name is one the snapshot's scoreboard carries, and the server checks it
/// against the snapshot the request sends with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CoachTrigger {
    /// An enemy completed a legendary item.
    EnemyItemSpike {
        /// The enemy's champion.
        champion: String,
        /// The item completed.
        item_id: u32,
        /// Its scoreboard name.
        item_name: String,
        /// Completed items the enemy now holds, this one included.
        completed_items: u8,
    },
    /// An enemy crossed the fed threshold on kills against deaths.
    EnemyFed {
        /// The enemy's champion.
        champion: String,
        /// Kills.
        kills: u32,
        /// Deaths.
        deaths: u32,
        /// Assists.
        assists: u32,
    },
    /// The enemy team's dominant damage type changed.
    DamageProfileShift {
        /// The profile before.
        from: DamageProfile,
        /// The profile now.
        to: DamageProfile,
        /// Completed physical damage items across the enemy team.
        physical_items: u8,
        /// Completed magic damage items across the enemy team.
        magic_items: u8,
    },
    /// The enemy team holds several completed healing items and the player
    /// holds no anti-heal item.
    HealingThreat {
        /// Completed healing items across the enemy team.
        healing_items: u8,
    },
    /// The player died several times without a kill or assist.
    DeathStreak {
        /// The player's deaths this game.
        deaths: u32,
        /// Deaths since the player's last takedown.
        deaths_without_takedown: u8,
    },
}

impl CoachTrigger {
    /// Every trigger kind, by its wire name, in contract order.
    pub const KINDS: [&'static str; 5] = [
        "enemy_item_spike",
        "enemy_fed",
        "damage_profile_shift",
        "healing_threat",
        "death_streak",
    ];

    /// The event this trigger reports within its kind, as the server's
    /// dedupe receipts identify it (`triggerWindowKey` in the backend's
    /// `coach/proactive-triggers.ts`; the golden fixture's `windowKeys` hold
    /// both to the same rule). A second trigger with the same kind and key is
    /// one the server answers `duplicate`.
    #[must_use]
    pub fn window_key(&self) -> String {
        match self {
            Self::EnemyItemSpike {
                champion, item_id, ..
            } => format!("{champion}:{item_id}"),
            Self::EnemyFed { champion, .. } => champion.clone(),
            Self::DamageProfileShift { to, .. } => match to {
                DamageProfile::Physical => "physical",
                DamageProfile::Magic => "magic",
                DamageProfile::Mixed => "mixed",
            }
            .to_owned(),
            Self::HealingThreat { .. } => "enemy_team".to_owned(),
            Self::DeathStreak { deaths, .. } => deaths.to_string(),
        }
    }

    /// This trigger's wire name.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::EnemyItemSpike { .. } => Self::KINDS[0],
            Self::EnemyFed { .. } => Self::KINDS[1],
            Self::DamageProfileShift { .. } => Self::KINDS[2],
            Self::HealingThreat { .. } => Self::KINDS[3],
            Self::DeathStreak { .. } => Self::KINDS[4],
        }
    }
}

/// Request to `coach/triggers`: a proactive coach turn the beta build asks
/// for. It has no question (the server words it) and carries the live
/// snapshot the detector fired on. The server refuses it in production.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "RawCoachTriggerRequest"
)]
pub struct CoachTriggerRequest {
    /// The conversation to continue, or none to start a new one.
    pub conversation_id: Option<Uuid>,
    /// This game, which the server's per-game cap and dedupe count by.
    pub game_key: String,
    /// What the detector saw.
    pub trigger: CoachTrigger,
    /// The live snapshot it saw it in.
    pub snapshot: LiveContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCoachTriggerRequest {
    conversation_id: Option<Uuid>,
    game_key: String,
    trigger: CoachTrigger,
    snapshot: LiveContext,
}

impl TryFrom<RawCoachTriggerRequest> for CoachTriggerRequest {
    type Error = String;

    fn try_from(raw: RawCoachTriggerRequest) -> Result<Self, String> {
        check_game_key(&raw.game_key)?;
        raw.snapshot.validate().map_err(|error| error.to_string())?;
        Ok(Self {
            conversation_id: raw.conversation_id,
            game_key: raw.game_key,
            trigger: raw.trigger,
            snapshot: raw.snapshot,
        })
    }
}

/// Response from `coach/triggers`. Spacing and the per-game cap answer the
/// `rate_limited` refusal instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum CoachTriggerResponse {
    /// A new turn, observed like any run.
    Started {
        /// The run.
        run: ActiveRun,
    },
    /// The server already admitted this event for this game; nothing started.
    Duplicate,
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

/// Request to `coach/reviews/get`: the finished game, by Riot match ID. The
/// server starts a review itself once the game's recording and resolved match
/// both exist; the client only reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "RawCoachReviewRequest"
)]
pub struct CoachReviewRequest {
    /// The Riot match ID, such as `NA1_5123456789`.
    pub match_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCoachReviewRequest {
    match_id: String,
}

impl TryFrom<RawCoachReviewRequest> for CoachReviewRequest {
    type Error = String;

    fn try_from(raw: RawCoachReviewRequest) -> Result<Self, String> {
        let (platform, game) = raw
            .match_id
            .split_once('_')
            .ok_or_else(|| "matchId is a platform, `_` and a game id".to_owned())?;
        let platform_ok = (2..=6).contains(&platform.len())
            && platform
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
        let game_ok =
            (1..=20).contains(&game.len()) && game.bytes().all(|byte| byte.is_ascii_digit());
        if platform_ok && game_ok {
            Ok(Self {
                match_id: raw.match_id,
            })
        } else {
            Err("matchId is a platform, `_` and a game id".to_owned())
        }
    }
}

/// Where a post-game review stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachReviewStatus {
    /// The turn is running.
    Pending,
    /// The turn finished; the review is in the conversation.
    Ready,
    /// Explore's quota or spend limit refused it; no review will exist.
    Declined,
    /// The turn ended without an answer.
    Failed,
}

/// Response from `coach/reviews/get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoachReviewResponse {
    /// The game reviewed.
    pub match_id: String,
    /// Where the review stands.
    pub status: CoachReviewStatus,
    /// The conversation holding the review; none once declined.
    pub conversation_id: Option<Uuid>,
    /// When the server started the review.
    pub created_at: DateTime<Utc>,
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

/// Response from `explore/assets`: the Data Dragon version the server's own
/// asset bundle was built from, which card art is fetched at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetsResponse {
    /// A Data Dragon version such as `16.22.1`.
    pub data_dragon_version: String,
}

/// Request to `explore/visualization`: the persisted answer whose chart to
/// draw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualizationRequest {
    /// The conversation it is in.
    pub conversation_id: Uuid,
    /// The answer.
    pub message_id: Uuid,
}

/// The one content type a `png` route answers with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PngContentType {
    /// `image/png`.
    #[serde(rename = "image/png")]
    Png,
}

/// What a `png` route's golden fixture records: its body is image bytes, so
/// the content type is all a client relies on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PngResponse {
    /// Always `image/png`.
    pub content_type: PngContentType,
}

/// One model the picker offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelOption {
    /// The id `runs/start` takes.
    pub id: ExploreModel,
    /// What the picker shows.
    pub label: String,
}

/// Response from `explore/models`: the web picker's models.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelsResponse {
    /// Whether the server lets the owner choose. With it off `models` is
    /// empty and the server picks.
    pub picker_enabled: bool,
    /// The model the server uses when none is chosen.
    pub default_model: ExploreModel,
    /// The models the owner may choose between.
    pub models: Vec<ModelOption>,
}

/// Request to `explore/conversations/set-leaf`: show the branch through one
/// message, which is how the version switcher moves between versions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetLeafRequest {
    /// The conversation.
    pub conversation_id: Uuid,
    /// The message whose branch to show; the server follows it to its leaf.
    pub message_id: Uuid,
}

/// Response from `set-leaf`, `revoke-share` and `attachments/discard`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OkResponse {
    /// Always true; a thing that is not the owner's is a `not_found` refusal.
    pub ok: bool,
}

/// Response from `explore/conversations/share`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareResponse {
    /// The unguessable token of the share link.
    pub share_token: String,
}

/// Request to `explore/attachments/discard`: remove an image not yet sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachmentDiscardRequest {
    /// The uploaded image.
    pub id: Uuid,
}

/// How a route answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteResponseKind {
    /// One JSON body.
    Json,
    /// A `text/event-stream` of [`StreamEvent`] frames.
    EventStream,
    /// One `image/png` body.
    Png,
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

/// The utterance a voice turn uploads: one PCM WAV of this shape and length.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceTurnAudioContract {
    /// The upload's media type.
    pub media_type: String,
    /// Samples per second.
    pub sample_rate_hz: u32,
    /// Interleaved channels.
    pub channels: u16,
    /// Bits per sample.
    pub bits_per_sample: u16,
    /// The shortest utterance the server reads as speech.
    pub min_duration_ms: u32,
    /// The longest utterance the desktop records.
    pub max_duration_ms: u32,
}

/// The spoken answer's PCM chunks.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceTurnSpeechContract {
    /// The sample encoding.
    pub encoding: String,
    /// Samples per second.
    pub sample_rate_hz: u32,
    /// Interleaved channels.
    pub channels: u16,
    /// The largest chunk one `audio` event carries.
    pub max_chunk_bytes: u32,
}

/// `coach/voice/turns`' own vocabulary, separate from `runs/stream`'s.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceTurnContract {
    /// What may start a recording.
    pub triggers: Vec<String>,
    /// The upload.
    pub audio: VoiceTurnAudioContract,
    /// The answer's speech.
    pub speech: VoiceTurnSpeechContract,
    /// Every voice event type, in order.
    pub events: Vec<String>,
    /// Every in-stream refusal code.
    pub errors: Vec<String>,
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
    /// `coach/voice/turns`' upload, speech, events and refusals.
    pub voice_turn: VoiceTurnContract,
    /// Chart kinds drawn as native rows rather than as the server's PNG.
    pub native_visualization_kinds: Vec<String>,
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
        ActiveRun, AppInitiation, AppTurnRequest, AssetsResponse, AttachmentDiscardRequest,
        COACH_REVIEWS_GET_PATH, COACH_TRIGGERS_PATH, COACH_VOICE_TURNS_PATH, CoachReviewRequest,
        CoachReviewResponse, CoachTrigger, CoachTriggerRequest, CoachTriggerResponse,
        ConversationGetRequest, ConversationListResponse, DESKTOP_CONTRACT_HEADER,
        DESKTOP_CONTRACT_VERSION, DEVICE_SCOPE_REQUESTS_PATH, DesktopApiContract, DesktopApiError,
        DeviceScope, EXPLORE_ASSETS_PATH, EXPLORE_CONVERSATIONS_GET_PATH,
        EXPLORE_CONVERSATIONS_LIST_PATH, EXPLORE_RUNS_ACTIVE_PATH, EXPLORE_RUNS_OUTCOME_PATH,
        EXPLORE_RUNS_START_APP_PATH, EXPLORE_RUNS_START_PATH, EXPLORE_RUNS_STOP_PATH,
        EXPLORE_RUNS_STREAM_PATH, EXPLORE_STATUS_PATH, EXPLORE_VISUALIZATION_PATH, EmptyRequest,
        ExploreStatusResponse, ModelsResponse, OkResponse, PAIRINGS_V2_PATH, PNG_CONTENT_TYPE,
        PairingV2Response, PngResponse, RouteResponseKind, RunActiveResponse, RunOutcomeResponse,
        RunRequest, RunStartRequest, RunStopResponse, ScopeRequest, ScopeRequestResponse,
        SetLeafRequest, ShareResponse, VisualizationRequest,
    };
    use crate::protocol::CreatePairingRequest;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const CONTRACT: &str =
        include_str!("../../../../data/src/scout-client/desktop-api.contract.json");
    const ERRORS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/errors.json");
    const PAIRINGS_V2: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/pairings-v2.json");
    const SCOPE_REQUESTS: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/device-scope-requests.json"
    );
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
    const ASSETS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-assets.json");
    const VISUALIZATION: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-visualization.json"
    );
    const MODELS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-models.json");
    const SET_LEAF: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-set-leaf.json"
    );
    const SHARE: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-share.json"
    );
    const REVOKE_SHARE: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-revoke-share.json"
    );
    const ATTACHMENTS_UPLOAD: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-attachments-upload.json"
    );
    const ATTACHMENTS_DISCARD: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-attachments-discard.json"
    );
    const RUNS_START_APP: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-runs-start-app.json"
    );
    const VOICE_TURNS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/coach-voice-turns.json");
    const COACH_REVIEWS_GET: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/coach-reviews-get.json");
    const COACH_TRIGGERS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/coach-triggers.json");
    const START_ACTIONS: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-runs-start-actions.json"
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
                ("coach_voice_turns", COACH_VOICE_TURNS_PATH),
                ("coach_reviews_get", COACH_REVIEWS_GET_PATH),
                ("coach_triggers", COACH_TRIGGERS_PATH),
                ("device_scope_requests", DEVICE_SCOPE_REQUESTS_PATH),
                ("explore_assets", EXPLORE_ASSETS_PATH),
                (
                    "explore_attachments_discard",
                    "/api/scout-client/v1/explore/attachments/discard"
                ),
                (
                    "explore_attachments_upload",
                    "/api/scout-client/v1/explore/attachments/upload"
                ),
                ("explore_conversations_get", EXPLORE_CONVERSATIONS_GET_PATH),
                (
                    "explore_conversations_list",
                    EXPLORE_CONVERSATIONS_LIST_PATH
                ),
                (
                    "explore_conversations_revoke_share",
                    "/api/scout-client/v1/explore/conversations/revoke-share"
                ),
                (
                    "explore_conversations_set_leaf",
                    "/api/scout-client/v1/explore/conversations/set-leaf"
                ),
                (
                    "explore_conversations_share",
                    "/api/scout-client/v1/explore/conversations/share"
                ),
                ("explore_models", "/api/scout-client/v1/explore/models"),
                ("explore_runs_active", EXPLORE_RUNS_ACTIVE_PATH),
                ("explore_runs_outcome", EXPLORE_RUNS_OUTCOME_PATH),
                ("explore_runs_start", EXPLORE_RUNS_START_PATH),
                ("explore_runs_start_app", EXPLORE_RUNS_START_APP_PATH),
                ("explore_runs_stop", EXPLORE_RUNS_STOP_PATH),
                ("explore_runs_stream", EXPLORE_RUNS_STREAM_PATH),
                ("explore_status", EXPLORE_STATUS_PATH),
                ("explore_visualization", EXPLORE_VISUALIZATION_PATH),
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
        assert_eq!(streaming, vec!["coach_voice_turns", "explore_runs_stream"]);
        let images: Vec<&str> = contract
            .routes
            .iter()
            .filter(|(_, route)| route.response == RouteResponseKind::Png)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(images, vec!["explore_visualization"]);
        assert_eq!(
            contract.native_visualization_kinds,
            ["TABLE", "LIST", "LEADERBOARD", "KPI_CARD"]
        );
        Ok(())
    }

    #[test]
    fn every_route_has_a_golden_fixture() -> TestResult {
        let contract: DesktopApiContract = serde_json::from_str(CONTRACT)?;
        let mut named = Vec::new();
        for fixture in [
            PAIRINGS_V2,
            SCOPE_REQUESTS,
            STATUS,
            LIST,
            GET,
            RUNS_START,
            RUNS_START_APP,
            RUNS_STOP,
            RUNS_ACTIVE,
            RUNS_OUTCOME,
            RUNS_STREAM,
            ASSETS,
            VISUALIZATION,
            MODELS,
            SET_LEAF,
            SHARE,
            REVOKE_SHARE,
            ATTACHMENTS_UPLOAD,
            ATTACHMENTS_DISCARD,
            VOICE_TURNS,
            COACH_REVIEWS_GET,
            COACH_TRIGGERS,
        ] {
            let fixture: Value = serde_json::from_str(fixture)?;
            named.push(fixture["route"].as_str().ok_or("route name")?.to_owned());
        }
        named.sort();
        assert_eq!(named, contract.routes.keys().cloned().collect::<Vec<_>>());
        Ok(())
    }

    #[test]
    fn coach_reviews_get_fixture_parses_strictly() -> TestResult {
        check_route::<CoachReviewRequest, CoachReviewResponse>(
            COACH_REVIEWS_GET,
            "coach_reviews_get",
        )
    }

    #[test]
    fn runs_start_fixture_parses_strictly() -> TestResult {
        check_route::<RunStartRequest, ActiveRun>(RUNS_START, "explore_runs_start")
    }

    #[test]
    fn runs_start_app_fixture_parses_strictly() -> TestResult {
        check_route::<AppTurnRequest, ActiveRun>(RUNS_START_APP, "explore_runs_start_app")
    }

    #[test]
    fn the_app_route_refuses_what_it_never_takes() -> TestResult {
        let fixture: Value = serde_json::from_str(RUNS_START_APP)?;
        // A question and a player initiation are refused by the client's own
        // strict types, as the server refuses them.
        for case in fixture["invalidRequests"].as_array().ok_or("invalid")? {
            let reason = case["reason"].as_str().unwrap_or("?");
            let parsed = serde_json::from_value::<AppTurnRequest>(case["body"].clone());
            if matches!(reason, "a question" | "a player-started initiation") {
                assert!(parsed.is_err(), "{reason}");
            }
        }
        assert_eq!(
            serde_json::to_value(AppInitiation::AppChampSelect)?,
            "app_champ_select"
        );
        assert_eq!(
            serde_json::to_value(AppInitiation::AppPregame)?,
            "app_pregame"
        );
        Ok(())
    }

    #[test]
    fn coach_triggers_fixture_parses_strictly() -> TestResult {
        check_route::<CoachTriggerRequest, CoachTriggerResponse>(COACH_TRIGGERS, "coach_triggers")
    }

    #[test]
    fn every_trigger_kind_has_a_golden_body_and_a_duplicate_is_an_answer() -> TestResult {
        let fixture: Value = serde_json::from_str(COACH_TRIGGERS)?;
        let mut kinds = Vec::new();
        for trigger in fixture["triggers"].as_array().ok_or("triggers")? {
            let typed: CoachTrigger = serde_json::from_value(trigger.clone())?;
            assert_eq!(&serde_json::to_value(&typed)?, trigger);
            kinds.push(typed.kind());
        }
        assert_eq!(kinds, CoachTrigger::KINDS);
        let keys: Vec<String> = fixture["triggers"]
            .as_array()
            .ok_or("triggers")?
            .iter()
            .map(|trigger| serde_json::from_value::<CoachTrigger>(trigger.clone()))
            .map(|typed| typed.map(|typed| typed.window_key()))
            .collect::<Result<_, _>>()?;
        assert_eq!(
            serde_json::to_value(keys)?,
            fixture["windowKeys"],
            "the server's event identity"
        );
        assert_eq!(
            serde_json::from_value::<CoachTriggerResponse>(fixture["duplicateResponse"].clone())?,
            CoachTriggerResponse::Duplicate
        );
        Ok(())
    }

    #[test]
    fn a_start_request_omits_unset_options() -> TestResult {
        let fixture: Value = serde_json::from_str(RUNS_START)?;
        let request: RunStartRequest = serde_json::from_value(fixture["request"].clone())?;
        assert_eq!(serde_json::to_value(&request)?, fixture["request"]);
        Ok(())
    }

    #[test]
    fn assets_fixture_parses_strictly() -> TestResult {
        check_route::<EmptyRequest, AssetsResponse>(ASSETS, "explore_assets")
    }

    #[test]
    fn visualization_fixture_parses_strictly_and_names_png() -> TestResult {
        check_route::<VisualizationRequest, PngResponse>(VISUALIZATION, "explore_visualization")?;
        let fixture: Value = serde_json::from_str(VISUALIZATION)?;
        assert_eq!(fixture["response"]["contentType"], PNG_CONTENT_TYPE);
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
    fn a_paired_device_upgrades_and_an_unpaired_one_pairs() {
        use super::ChatApprovalRoute;

        assert_eq!(
            ChatApprovalRoute::for_paired(true),
            ChatApprovalRoute::ScopeUpgrade
        );
        assert_eq!(
            ChatApprovalRoute::for_paired(false),
            ChatApprovalRoute::FreshPairing
        );
    }

    #[test]
    fn scope_request_fixture_parses_strictly() -> TestResult {
        check_route::<ScopeRequest, ScopeRequestResponse>(SCOPE_REQUESTS, "device_scope_requests")
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
    fn chat_action_fixtures_parse_strictly() -> TestResult {
        check_route::<EmptyRequest, ModelsResponse>(MODELS, "explore_models")?;
        check_route::<SetLeafRequest, OkResponse>(SET_LEAF, "explore_conversations_set_leaf")?;
        check_route::<ConversationGetRequest, ShareResponse>(SHARE, "explore_conversations_share")?;
        check_route::<ConversationGetRequest, OkResponse>(
            REVOKE_SHARE,
            "explore_conversations_revoke_share",
        )?;
        check_route::<AttachmentDiscardRequest, OkResponse>(
            ATTACHMENTS_DISCARD,
            "explore_attachments_discard",
        )
    }

    #[test]
    fn edit_regenerate_and_image_turns_are_run_start_bodies() -> TestResult {
        let fixture: Value = serde_json::from_str(START_ACTIONS)?;
        assert_eq!(fixture["route"], "explore_runs_start");
        for case in fixture["requests"].as_array().ok_or("requests")? {
            let flow = case["flow"].as_str().unwrap_or("?");
            let request: RunStartRequest = serde_json::from_value(case["request"].clone())?;
            // A regenerate names no question; everything else asks one.
            assert_eq!(request.question.is_none(), flow == "regenerate", "{flow}");
            assert_eq!(
                serde_json::to_value(&request)?
                    .as_object()
                    .map(|object| object.iter().filter(|(_, v)| !v.is_null()).count()),
                case["request"]
                    .as_object()
                    .map(|object| object.iter().filter(|(_, v)| !v.is_null()).count()),
                "{flow} loses nothing on the way out"
            );
        }
        Ok(())
    }

    #[test]
    fn a_model_has_the_id_the_server_names() -> TestResult {
        let fixture: Value = serde_json::from_str(MODELS)?;
        let response: ModelsResponse = serde_json::from_value(fixture["response"].clone())?;
        let ids: Vec<&str> = response.models.iter().map(|model| model.id.id()).collect();
        let wire: Vec<&str> = fixture["response"]["models"]
            .as_array()
            .ok_or("models")?
            .iter()
            .filter_map(|model| model["id"].as_str())
            .collect();
        assert_eq!(ids, wire);
        assert_eq!(response.default_model.id(), "gpt-6-luna");
        Ok(())
    }
}
