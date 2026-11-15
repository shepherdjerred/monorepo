//! Typed Explore bodies: messages, traces, query results, cards and the
//! `runs/stream` events.
//!
//! These mirror the Zod schemas in `data/src/model/reports/explore*.ts`, which
//! the server validates every body against before sending it. Every struct
//! refuses unknown fields, and a field the Zod schema defaults is defaulted
//! here too, so the two accept the same documents. The golden fixtures under
//! `data/src/scout-client/desktop-fixtures/` hold both sides to that.
//!
//! The REST envelopes these sit inside (status, conversation list, run
//! identity, quota) live in `scout_client_core::desktop_api`.

use chrono::{DateTime, Utc};
use scout_client_core::desktop_api::{ConversationDetail, ExploreQuota, RunOutcome};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

/// Who wrote a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    /// The asker.
    User,
    /// Explore.
    Assistant,
}

/// How one tool step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraceStatus {
    /// Still running.
    Running,
    /// Returned.
    Succeeded,
    /// Failed.
    Failed,
    /// The turn ended before it returned.
    Interrupted,
}

/// How a finished tool call ended, as `tool_result` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    /// It returned.
    Succeeded,
    /// It failed.
    Failed,
}

impl From<ToolStatus> for TraceStatus {
    fn from(status: ToolStatus) -> Self {
        match status {
            ToolStatus::Succeeded => Self::Succeeded,
            ToolStatus::Failed => Self::Failed,
        }
    }
}

/// How much of the language reference a step read. Each count is optional
/// because stored traces predate some of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceCounts {
    /// Data sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<u64>,
    /// Functions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub functions: Option<u64>,
    /// Render kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_kinds: Option<u64>,
    /// Render options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub render_options: Option<u64>,
    /// Queues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queues: Option<u64>,
    /// Presets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presets: Option<u64>,
    /// Columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u64>,
    /// Aggregate functions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregate_functions: Option<u64>,
    /// Scalar functions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scalar_functions: Option<u64>,
    /// Idioms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idioms: Option<u64>,
    /// Metrics (before `ScoutQL` v2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<u64>,
    /// Group-bys (before `ScoutQL` v2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_bys: Option<u64>,
    /// Filters (before `ScoutQL` v2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<u64>,
}

/// Structured detail about one tool step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TraceDetails {
    /// How much of the language reference the step read.
    Reference(Box<ReferenceCounts>),
    /// A query validation.
    Validation {
        /// The query checked.
        query_text: String,
        /// Whether it was valid, once known.
        ok: Option<bool>,
        /// What the validator said.
        diagnostics: Vec<String>,
        /// The query as the formatter writes it.
        formatted_query_text: Option<String>,
    },
    /// A query reformat.
    Format {
        /// The query.
        query_text: String,
        /// The reformatted query.
        formatted_query_text: Option<String>,
    },
    /// A query run.
    Execution {
        /// The query.
        query_text: String,
        /// Whether it ran, once known.
        ok: Option<bool>,
        /// Rows it returned.
        rows_returned: Option<u64>,
        /// Rows it scanned.
        rows_scanned: Option<u64>,
        /// How the result renders.
        render_kind: Option<String>,
    },
}

/// Why a raw tool payload was not kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OmittedReason {
    /// This payload alone was too large.
    PayloadLimit,
    /// The turn's payload allowance was spent.
    TurnLimit,
}

/// A tool call's raw input or output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TraceRawValue {
    /// The payload, as arbitrary JSON.
    Value {
        /// The payload.
        value: Value,
        /// Its encoded size.
        byte_length: u64,
    },
    /// The payload was dropped.
    Omitted {
        /// Why.
        reason: OmittedReason,
        /// Its encoded size.
        byte_length: u64,
    },
}

/// One auditable tool call in a turn.
///
/// Stored traces written before provider call ids existed carry
/// `{ toolName, message, ok }`; they are upgraded on read exactly as the web
/// upgrades them, so every entry has the same shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "TraceEntryWire")]
pub struct TraceEntry {
    /// Provider call id.
    pub tool_call_id: String,
    /// Tool name.
    pub tool_name: String,
    /// Generic description, safe on a share link.
    pub message: String,
    /// How the step stands.
    pub status: TraceStatus,
    /// Duration in milliseconds, once measured.
    pub duration_ms: Option<u64>,
    /// Structured details.
    pub details: Option<TraceDetails>,
    /// Raw input, if kept.
    pub raw_input: Option<TraceRawValue>,
    /// Raw output, if kept.
    pub raw_output: Option<TraceRawValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TraceEntryWire {
    Rich(Box<RichTraceEntry>),
    Legacy(LegacyTraceEntry),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RichTraceEntry {
    tool_call_id: String,
    tool_name: String,
    message: String,
    status: TraceStatus,
    duration_ms: Option<u64>,
    details: Option<TraceDetails>,
    raw_input: Option<TraceRawValue>,
    raw_output: Option<TraceRawValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyTraceEntry {
    tool_name: String,
    message: String,
    ok: bool,
}

impl From<TraceEntryWire> for TraceEntry {
    fn from(wire: TraceEntryWire) -> Self {
        match wire {
            TraceEntryWire::Rich(entry) => {
                let entry = *entry;
                Self {
                    tool_call_id: entry.tool_call_id,
                    tool_name: entry.tool_name,
                    message: entry.message,
                    status: entry.status,
                    duration_ms: entry.duration_ms,
                    details: entry.details,
                    raw_input: entry.raw_input,
                    raw_output: entry.raw_output,
                }
            }
            TraceEntryWire::Legacy(entry) => Self {
                tool_call_id: format!("legacy-{}", entry.tool_name),
                tool_name: entry.tool_name,
                message: entry.message,
                status: if entry.ok {
                    TraceStatus::Succeeded
                } else {
                    TraceStatus::Failed
                },
                duration_ms: None,
                details: None,
                raw_input: None,
                raw_output: None,
            },
        }
    }
}

/// How a result column formats its values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValueFormat {
    /// Plain text.
    Text,
    /// Whole number.
    Integer,
    /// Decimal number.
    Decimal,
    /// Fraction shown as a percentage.
    Percent,
}

/// The game asset a column's values name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    /// A champion.
    Champion,
    /// An item.
    Item,
    /// A rune.
    Rune,
    /// A rune tree.
    RuneTree,
    /// A summoner spell.
    Spell,
}

/// How a query result renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RenderKind {
    /// A list.
    List,
    /// A table.
    Table,
    /// A leaderboard.
    Leaderboard,
    /// A bar chart.
    BarChart,
    /// A line chart.
    LineChart,
    /// A stacked bar chart.
    StackedBar,
    /// An area chart.
    AreaChart,
    /// A donut chart.
    DonutChart,
    /// A scatter chart.
    ScatterChart,
    /// A heatmap.
    Heatmap,
    /// A radar chart.
    RadarChart,
    /// A single-number card.
    KpiCard,
    /// A bump chart.
    BumpChart,
    /// A calendar heatmap.
    CalendarHeatmap,
    /// A histogram.
    Histogram,
    /// A box plot.
    BoxPlot,
}

/// One column of a query result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultColumn {
    /// Stable key rows refer to.
    pub key: String,
    /// Header text.
    pub label: String,
    /// Value format.
    pub format: ValueFormat,
    /// The asset its values name, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<AssetKind>,
}

/// One cell: text, a number, or nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CellValue {
    /// Text.
    Text(String),
    /// A number, kept exactly as sent.
    Number(serde_json::Number),
    /// No value.
    Null,
}

/// One cell keyed by its column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewCell {
    /// Column key.
    pub column: String,
    /// The value.
    pub value: CellValue,
}

/// One result row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRow {
    /// Row label.
    pub label: String,
    /// Scout's games count for the row, on new previews.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub games: Option<u64>,
    /// Cells.
    pub values: Vec<PreviewCell>,
}

/// A bounded summary of a query result, the table an answer shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewSummary {
    /// Columns.
    pub columns: Vec<ResultColumn>,
    /// Display rows.
    pub rows: Vec<PreviewRow>,
    /// Rows the chart draws from.
    #[serde(default)]
    pub visualization_rows: Vec<PreviewRow>,
    /// Rows the query returned.
    #[serde(default)]
    pub rows_returned: u64,
    /// Rows the query scanned.
    pub rows_scanned: u64,
    /// How it renders.
    pub render_kind: RenderKind,
}

/// A chart snapshot, carried without interpretation.
///
/// The server validates the whole snapshot against
/// `VisualizationSnapshotSchema` before sending it, and the desktop shows
/// charts as the PNG the server renders from the same snapshot, so this
/// client checks only what it reads itself: the version, the kind, the title
/// and whether it is a sparkline. Everything else stays intact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Map<String, Value>", into = "Map<String, Value>")]
pub struct Visualization(Map<String, Value>);

impl Visualization {
    /// The snapshot as JSON.
    #[must_use]
    pub fn as_json(&self) -> &Map<String, Value> {
        &self.0
    }

    /// The chart kind, such as `BAR_CHART` or `TABLE`.
    #[must_use]
    pub fn kind(&self) -> &str {
        self.0
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    /// The chart's title, if it has one.
    #[must_use]
    pub fn title(&self) -> Option<&str> {
        self.0.get("title").and_then(Value::as_str)
    }

    /// Whether it draws as a sparkline, which is always an image.
    #[must_use]
    pub fn sparkline(&self) -> bool {
        self.0
            .get("display")
            .and_then(|display| display.get("sparkline"))
            .and_then(Value::as_bool)
            .unwrap_or_default()
    }
}

impl TryFrom<Map<String, Value>> for Visualization {
    type Error = String;

    fn try_from(value: Map<String, Value>) -> Result<Self, Self::Error> {
        if value.get("version") != Some(&Value::from(1)) {
            return Err("a visualization snapshot must be version 1".to_owned());
        }
        if value
            .get("kind")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err("a visualization snapshot must name its kind".to_owned());
        }
        if !matches!(value.get("title"), Some(Value::String(_) | Value::Null)) {
            return Err("a visualization snapshot's title must be text or null".to_owned());
        }
        if !value
            .get("display")
            .and_then(|display| display.get("sparkline"))
            .is_some_and(Value::is_boolean)
        {
            return Err("a visualization snapshot must say whether it is a sparkline".to_owned());
        }
        Ok(Self(value))
    }
}

impl From<Visualization> for Map<String, Value> {
    fn from(value: Visualization) -> Self {
        value.0
    }
}

/// What an inline entity marker names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    /// A champion.
    Champion,
    /// A champion ability.
    Ability,
    /// An item.
    Item,
    /// A rune.
    Rune,
    /// A summoner spell.
    Spell,
}

/// A game entity the answer text names inline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InlineEntity {
    /// The marker in the answer text.
    pub marker: String,
    /// What it names.
    pub kind: EntityKind,
    /// Asset key for its icon.
    pub asset_key: String,
    /// Display name.
    pub name: String,
    /// Tooltip text.
    pub description: String,
    /// Data Dragon version of the asset.
    pub version: String,
}

/// The reasoning effort a turn ran at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningEffort {
    /// High.
    High,
}

/// Which model wrote an answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Generation {
    /// Model id.
    pub model: String,
    /// Reasoning effort.
    pub reasoning_effort: ReasoningEffort,
}

/// An attached image's type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttachmentMediaType {
    /// PNG.
    #[serde(rename = "image/png")]
    Png,
    /// JPEG.
    #[serde(rename = "image/jpeg")]
    Jpeg,
    /// WebP.
    #[serde(rename = "image/webp")]
    Webp,
}

/// An image attached to a question; its bytes are fetched by id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    /// Attachment id.
    pub id: Uuid,
    /// Image type.
    pub media_type: AttachmentMediaType,
}

impl AttachmentMediaType {
    /// The image type as the server names it, such as `image/png`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }

    /// The image type for a file extension, or none for one Explore refuses.
    #[must_use]
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }

    /// The image type the first bytes of a file say it is, the way the
    /// server checks them: PNG signature, JPEG start marker, `RIFF....WEBP`.
    #[must_use]
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
            Some(Self::Png)
        } else if bytes.starts_with(&[0xFF, 0xD8]) {
            Some(Self::Jpeg)
        } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }
}

/// Request to `explore/attachments/upload`: one image, base64 encoded, with
/// the web's size and type limits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentUploadRequest {
    /// The image type.
    pub media_type: AttachmentMediaType,
    /// The image bytes, standard base64.
    pub base64: String,
}

/// Match card size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchCardSize {
    /// Small.
    S,
    /// Medium.
    M,
    /// Large.
    L,
}

/// A Riot ID, either half of which a record may not state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiotId {
    /// Game name.
    pub game_name: Option<String>,
    /// Tag line.
    pub tag_line: Option<String>,
}

/// Objectives taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Objectives {
    /// Turrets destroyed.
    pub turrets: u32,
    /// Inhibitors destroyed.
    pub inhibitors: u32,
    /// Barons killed.
    pub barons: u32,
    /// Dragons killed.
    pub dragons: u32,
}

/// One player on a match card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchParticipant {
    /// Null for an end-of-game record, which numbers no participant.
    pub participant_id: Option<u32>,
    /// Riot ID.
    pub riot_id: RiotId,
    /// Riot champion id.
    pub champion_id: u32,
    /// Champion name.
    pub champion_name: String,
    /// Lane or role, empty when unknown.
    pub position: String,
    /// Kills.
    pub kills: u32,
    /// Deaths.
    pub deaths: u32,
    /// Assists.
    pub assists: u32,
    /// Minions and monsters killed.
    pub creep_score: u32,
    /// Gold earned.
    pub gold_earned: u32,
    /// Vision score.
    pub vision_score: u32,
    /// Damage dealt to champions.
    pub damage_to_champions: u64,
    /// Share of team kills taken part in.
    pub kill_participation: Option<f64>,
    /// Share of team damage to champions.
    pub damage_share: Option<f64>,
    /// Objectives taken.
    pub objectives: Objectives,
}

/// One team on a match card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchTeam {
    /// Riot team id.
    pub team_id: u32,
    /// Whether it won.
    pub win: bool,
    /// Team kills.
    pub kills: u32,
    /// Null when the lake holds no team row.
    pub objectives: Option<Objectives>,
    /// Players.
    pub participants: Vec<MatchParticipant>,
}

/// A frozen match as a card shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchSnapshot {
    /// Riot match id.
    pub match_id: String,
    /// Null when the record states no lobby creation time.
    pub game_creation_ms: Option<u64>,
    /// Game length in seconds.
    pub game_duration_seconds: u64,
    /// Queue name.
    pub queue: Option<String>,
    /// Riot queue id.
    pub queue_id: u32,
    /// Riot game mode.
    pub game_mode: String,
    /// Riot game type.
    pub game_type: String,
    /// Null when the record states no game version.
    pub game_version: Option<String>,
    /// Riot map id.
    pub map_id: u32,
    /// Teams.
    pub teams: Vec<MatchTeam>,
}

/// A match card inside an answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatchCard {
    /// Card size.
    pub size: MatchCardSize,
    /// The match.
    #[serde(rename = "match")]
    pub snapshot: MatchSnapshot,
}

/// Loadout card size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoadoutCardSize {
    /// Small.
    S,
    /// Large.
    L,
}

/// A rune or rune tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamedRune {
    /// Riot id.
    pub id: u32,
    /// Asset key for its icon.
    pub asset_key: String,
    /// Display name.
    pub name: String,
    /// False when the id is not in the current rune data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known: Option<bool>,
}

/// One final item slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadoutItem {
    /// Slot 0 to 6.
    pub slot: u8,
    /// Item id, empty slot when none.
    pub item_id: Option<u32>,
    /// Item name.
    pub name: Option<String>,
}

/// One summoner spell slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadoutSpell {
    /// Slot 1 or 2.
    pub slot: u8,
    /// Spell id.
    pub spell_id: Option<String>,
    /// Spell name.
    pub name: Option<String>,
}

/// A stat shard row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShardSlot {
    /// The offense row.
    Offense,
    /// The flex row.
    Flex,
    /// The defense row.
    Defense,
}

/// One stat shard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuneShard {
    /// Row.
    pub slot: ShardSlot,
    /// Shard id.
    pub id: Option<u32>,
}

/// A rune page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunePage {
    /// Primary rune tree.
    pub primary_tree: Option<NamedRune>,
    /// Keystone rune.
    pub keystone: Option<NamedRune>,
    /// The other primary runes.
    pub primary_runes: Vec<NamedRune>,
    /// Secondary rune tree.
    pub secondary_tree: Option<NamedRune>,
    /// Secondary runes.
    pub secondary_runes: Vec<NamedRune>,
    /// Stat shards, one per row.
    pub shards: Vec<RuneShard>,
}

/// Whether a build path event bought or sold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildPathKind {
    /// Bought.
    Purchase,
    /// Sold.
    Sold,
}

/// One purchase or sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildPathEvent {
    /// Game minute.
    pub minute: u32,
    /// Item id.
    pub item_id: u32,
    /// Item name.
    pub name: Option<String>,
    /// Bought or sold.
    pub kind: BuildPathKind,
}

/// An ability key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Skill {
    /// The Q ability.
    Q,
    /// The W ability.
    W,
    /// The E ability.
    E,
    /// The ultimate.
    R,
}

/// One skill point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillOrderEntry {
    /// Champion level.
    pub level: u8,
    /// Ability levelled.
    pub skill: Skill,
}

/// A loadout card inside an answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadoutCard {
    /// Card size.
    pub size: LoadoutCardSize,
    /// Riot match id.
    pub match_id: String,
    /// Riot participant id.
    pub participant_id: u32,
    /// Riot champion id.
    pub champion_id: u32,
    /// Champion name.
    pub champion_name: String,
    /// Game length in seconds.
    pub game_duration_seconds: u64,
    /// Items held at the end, one per slot.
    pub final_items: Vec<LoadoutItem>,
    /// Summoner spells.
    pub spells: Vec<LoadoutSpell>,
    /// Rune page.
    pub rune_page: RunePage,
    /// Whether the timeline recorded purchases.
    pub build_path_recorded: bool,
    /// Whether the build path was cut to its limit.
    #[serde(default)]
    pub build_path_truncated: bool,
    /// Purchases and sales in order.
    pub build_path: Vec<BuildPathEvent>,
    /// Skill points in order.
    pub skill_order: Vec<SkillOrderEntry>,
}

const fn one() -> u32 {
    1
}

/// One persisted turn, as `conversations/get` returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExploreMessage {
    /// Message id.
    pub id: Uuid,
    /// Who wrote it.
    pub role: MessageRole,
    /// Parent turn; none for the opening message.
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    /// Every version of this turn, oldest first.
    #[serde(default)]
    pub sibling_ids: Vec<Uuid>,
    /// Position within `sibling_ids`.
    #[serde(default)]
    pub version_index: u32,
    /// Length of `sibling_ids`.
    #[serde(default = "one")]
    pub version_count: u32,
    /// Text.
    pub content: String,
    /// Entities the text names inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_entities: Option<Vec<InlineEntity>>,
    /// Which model answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<Generation>,
    /// The `ScoutQL` the answer ran.
    #[serde(default)]
    pub query_text: Option<String>,
    /// Caveats.
    #[serde(default)]
    pub caveats: Vec<String>,
    /// Suggested follow-up questions.
    #[serde(default)]
    pub follow_ups: Vec<String>,
    /// The answer's table.
    #[serde(default)]
    pub preview: Option<PreviewSummary>,
    /// The answer's chart.
    #[serde(default)]
    pub visualization: Option<Visualization>,
    /// Match cards.
    #[serde(default)]
    pub match_cards: Vec<MatchCard>,
    /// Loadout cards.
    #[serde(default)]
    pub loadout_cards: Vec<LoadoutCard>,
    /// Guilds the turn's capabilities came from.
    #[serde(default)]
    pub guild_ids: Vec<String>,
    /// Images attached to the question.
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// Tool calls.
    #[serde(default)]
    pub trace: Vec<TraceEntry>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// The persisted answer as the `final` event carries it: the pre-card shape,
/// so a client refetches the transcript after `done` for cards and entities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamMessage {
    /// Message id.
    pub id: Uuid,
    /// Who wrote it.
    pub role: MessageRole,
    /// Parent turn.
    #[serde(default)]
    pub parent_id: Option<Uuid>,
    /// Every version of this turn, oldest first.
    #[serde(default)]
    pub sibling_ids: Vec<Uuid>,
    /// Position within `sibling_ids`.
    #[serde(default)]
    pub version_index: u32,
    /// Length of `sibling_ids`.
    #[serde(default = "one")]
    pub version_count: u32,
    /// Text.
    pub content: String,
    /// The `ScoutQL` the answer ran.
    #[serde(default)]
    pub query_text: Option<String>,
    /// Caveats.
    #[serde(default)]
    pub caveats: Vec<String>,
    /// Suggested follow-up questions.
    #[serde(default)]
    pub follow_ups: Vec<String>,
    /// The answer's table.
    #[serde(default)]
    pub preview: Option<PreviewSummary>,
    /// The answer's chart.
    #[serde(default)]
    pub visualization: Option<Visualization>,
    /// Tool calls.
    #[serde(default)]
    pub trace: Vec<TraceEntry>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// Response from `explore/conversations/get`: one conversation's branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transcript {
    /// Conversation header.
    pub conversation: ConversationDetail,
    /// Messages on the current branch, oldest first.
    pub messages: Vec<ExploreMessage>,
}

/// The literal `true` a skippable event carries.
///
/// A sender marks an event `ignorable` to say a client that does not know it
/// may drop it; it is never `false`, so this refuses `false` rather than
/// letting a caller claim otherwise.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "bool", into = "bool")]
pub struct Ignorable;

impl TryFrom<bool> for Ignorable {
    type Error = &'static str;

    fn try_from(value: bool) -> Result<Self, Self::Error> {
        if value {
            Ok(Self)
        } else {
            Err("ignorable is always true")
        }
    }
}

impl From<Ignorable> for bool {
    fn from(_: Ignorable) -> Self {
        true
    }
}

/// One frame of `runs/stream`: `event: <type>` and `data: <json>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StreamEvent {
    /// Complete replaceable state, always the first frame after attaching, so
    /// a reconnect replaces state rather than appending it twice.
    Snapshot {
        /// Run id.
        run_id: Uuid,
        /// Conversation id.
        conversation_id: Uuid,
        /// The question being answered.
        question_message_id: Uuid,
        /// The leaf on screen when the run began.
        leaf_id_at_start: Option<Uuid>,
        /// Answers that existed when the run began.
        #[serde(default)]
        version_count_at_start: u32,
        /// When the run began.
        started_at: DateTime<Utc>,
        /// The answer so far.
        answer: Option<String>,
        /// What the run is doing now.
        activity: Option<String>,
        /// Tool calls so far.
        trace: Vec<TraceEntry>,
    },
    /// The newest table, sent straight after a snapshot.
    RunPreview {
        /// The table, if any.
        preview: Option<PreviewSummary>,
        /// Always true.
        #[serde(default)]
        ignorable: Ignorable,
    },
    /// The run began.
    Started {
        /// Run id.
        run_id: Uuid,
        /// Conversation id.
        conversation_id: Uuid,
        /// The question being answered.
        question_message_id: Uuid,
    },
    /// Owner-only narration of what the run is doing.
    Activity {
        /// The narration.
        text: String,
        /// The tool call it narrates, if any.
        #[serde(default)]
        tool_call_id: Option<String>,
        /// Always true.
        #[serde(default)]
        ignorable: Ignorable,
    },
    /// A tool call began.
    ToolCall {
        /// Provider call id.
        tool_call_id: String,
        /// Tool name.
        tool_name: String,
        /// Generic description.
        message: String,
        /// Structured details.
        details: Option<TraceDetails>,
        /// The call's input, if kept.
        raw_input: Option<TraceRawValue>,
    },
    /// A tool call finished.
    ToolResult {
        /// Provider call id.
        tool_call_id: String,
        /// Tool name.
        tool_name: String,
        /// How it finished.
        status: ToolStatus,
        /// Generic description.
        message: String,
        /// Duration in milliseconds.
        duration_ms: Option<u64>,
        /// Structured details.
        details: Option<TraceDetails>,
        /// The call's output, if kept.
        raw_output: Option<TraceRawValue>,
    },
    /// A query result to show while the answer is written.
    Preview {
        /// The table.
        preview: PreviewSummary,
        /// A chart for it.
        #[serde(default)]
        visualization: Option<Visualization>,
    },
    /// More answer text.
    AnswerDelta {
        /// Text to append.
        text: String,
    },
    /// The persisted answer.
    Final {
        /// The assistant message.
        message: Box<StreamMessage>,
        /// The conversation's title.
        title: String,
        /// Quota after the turn.
        quota: Vec<ExploreQuota>,
    },
    /// The run failed; the message is safe to show.
    Error {
        /// Why.
        message: String,
        /// When to try again.
        #[serde(default)]
        retry_after_seconds: Option<u32>,
        /// Quota at the failure.
        #[serde(default)]
        quota: Option<Vec<ExploreQuota>>,
    },
    /// The last frame.
    Done {
        /// How the run ended.
        outcome: RunOutcome,
    },
}

impl StreamEvent {
    /// The frame's `type`, which is also its SSE `event:` name.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Snapshot { .. } => "snapshot",
            Self::RunPreview { .. } => "run_preview",
            Self::Started { .. } => "started",
            Self::Activity { .. } => "activity",
            Self::ToolCall { .. } => "tool_call",
            Self::ToolResult { .. } => "tool_result",
            Self::Preview { .. } => "preview",
            Self::AnswerDelta { .. } => "answer_delta",
            Self::Final { .. } => "final",
            Self::Error { .. } => "error",
            Self::Done { .. } => "done",
        }
    }
}

/// The golden `runs/stream` body: its frames, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStreamFrames {
    /// Frames as the server sends them.
    pub events: Vec<StreamEvent>,
}
