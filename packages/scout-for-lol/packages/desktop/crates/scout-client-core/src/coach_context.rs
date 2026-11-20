//! The game context Scout Desktop may attach to an Explore turn.
//!
//! The wire contract is `data/src/scout-client/coach-context.schema.json`,
//! and `coach-context.fixtures.json` beside it holds the accept and reject
//! bodies. The backend validates the same files with Zod; the tests here hold
//! these strict serde types to them, so either side drifting fails its own
//! suite.
//!
//! Every section is an allowlist of what the player can see in their own
//! client. No struct here has a field for a Riot ID or summoner name, a skin,
//! the enemy ward score, a cooldown or summoner timer, or a map position, and
//! every struct refuses unknown fields, so none can be added by accident or
//! smuggled in. [`LiveContext`] is built from the already allowlisted
//! [`LiveSnapshot`], never from Riot's raw payload.
//!
//! What serde cannot say (string and list bounds, at least one section) is
//! checked by [`GameContext::validate`]. Whether a section reaches the agent
//! at all is the server's coach policy, not this contract.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::live::champ_select::ChampSelectSnapshot;
use crate::live::snapshot::{
    LiveEvent, LiveGameInfo, LiveItem, LiveParticipant, LiveSnapshot, OwnStats, Team,
};

/// The longest name the contract accepts: a champion, spell, rune, mode or map.
const NAME_MAX: usize = 64;
/// The longest item name.
const ITEM_NAME_MAX: usize = 96;
/// The longest champion-select phase.
const PHASE_MAX: usize = 32;
/// The longest assigned role.
const ROLE_MAX: usize = 16;
/// The most players a game has (Arena).
const PARTICIPANTS_MAX: usize = 16;
/// Inventory slots, trinket included.
const ITEMS_MAX: usize = 7;
/// Players, or bans, on one champion-select team.
const TEAM_MAX: usize = 5;

/// A present section: `null` is refused, as the contract says, where a plain
/// `Option` would read it as absent.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// A required key that may be `null`: a plain `Option` field would also
/// accept the key being left out, which the contract refuses.
fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// The game context of one turn. At least one section is present.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GameContext {
    /// The champion-select screen.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub champ_select: Option<ChampSelectContext>,
    /// The loading screen.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub pregame: Option<PregameContext>,
    /// The game in progress.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub live: Option<LiveContext>,
    /// The finished game.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub postgame: Option<PostgameContext>,
}

/// What the champion-select screen shows. Enemy summoners stay hidden.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChampSelectContext {
    /// The timer's phase, such as `BAN_PICK`.
    #[serde(deserialize_with = "nullable")]
    pub phase: Option<String>,
    /// The local player's cell.
    pub local_cell_id: u8,
    /// The local player's team.
    pub my_team: Vec<AllySlot>,
    /// The other team: revealed champions only.
    pub their_team: Vec<EnemySlot>,
    /// Champions the local team banned.
    pub my_bans: Vec<u32>,
    /// Champions the other team banned.
    pub their_bans: Vec<u32>,
}

/// One slot on the local player's team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllySlot {
    /// The slot's cell.
    pub cell_id: u8,
    /// The locked or hovered champion; 0 when none.
    pub champion_id: u32,
    /// The role the client assigned, when it assigned one.
    #[serde(deserialize_with = "nullable")]
    pub assigned_role: Option<String>,
}

/// One slot on the other team: the client reveals only the champion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnemySlot {
    /// The slot's cell.
    pub cell_id: u8,
    /// The revealed champion; 0 while it is hidden.
    pub champion_id: u32,
}

/// The loading screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PregameContext {
    /// Mode and map.
    pub game: PregameGame,
    /// Every player's loading card.
    pub participants: Vec<PregameParticipant>,
}

/// Mode and map, before the clock starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PregameGame {
    /// The mode, such as `CLASSIC`.
    pub mode: String,
    /// The map's internal name.
    pub map: String,
}

/// One player's loading card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PregameParticipant {
    /// The side of the map.
    pub team: Team,
    /// Whether this is the local player.
    pub is_self: bool,
    /// The champion's display name.
    pub champion: String,
    /// The two summoner spell names.
    pub summoner_spells: [String; 2],
    /// The keystone rune's name.
    #[serde(deserialize_with = "nullable")]
    pub keystone: Option<String>,
}

/// The allowlisted [`LiveSnapshot`], as the contract spells it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveContext {
    /// Mode, map and clock.
    pub game: LiveGame,
    /// The local player's stats panel.
    pub own: LiveOwnStats,
    /// Both teams' scoreboard rows.
    pub participants: Vec<LiveContextParticipant>,
    /// How many events the game has logged so far.
    pub event_count: u32,
    /// The newest event.
    #[serde(deserialize_with = "nullable")]
    pub latest_event: Option<LiveContextEvent>,
}

/// Mode, map and clock.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveGame {
    /// The mode.
    pub mode: String,
    /// The map's internal name.
    pub map: String,
    /// Whole seconds on the game clock.
    pub game_time_secs: u32,
}

/// The local player's stats panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveOwnStats {
    /// Whole unspent gold.
    pub gold: u32,
    /// Maximum health.
    pub max_health: f64,
    /// Current health.
    pub health: f64,
    /// The resource's name, such as `MANA`.
    pub resource: String,
    /// Maximum resource.
    pub max_resource: f64,
    /// Current resource.
    pub current_resource: f64,
    /// Armor.
    pub armor: f64,
    /// Magic resistance.
    pub magic_resist: f64,
    /// Attack damage.
    pub attack_damage: f64,
    /// Ability power.
    pub ability_power: f64,
    /// Attacks per second.
    pub attack_speed: f64,
    /// Movement speed.
    pub move_speed: f64,
    /// Critical strike chance.
    pub crit_chance: f64,
}

/// One scoreboard row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveContextParticipant {
    /// The side of the map.
    pub team: Team,
    /// Whether this is the local player.
    pub is_self: bool,
    /// The champion's display name.
    pub champion: String,
    /// Champion level.
    pub level: u8,
    /// Kills.
    pub kills: u32,
    /// Deaths.
    pub deaths: u32,
    /// Assists.
    pub assists: u32,
    /// Creep score.
    pub creep_score: u32,
    /// Items, in slot order.
    pub items: Vec<LiveContextItem>,
    /// The two summoner spell names, never their cooldown state.
    pub summoner_spells: [String; 2],
    /// The keystone rune's name.
    #[serde(deserialize_with = "nullable")]
    pub keystone: Option<String>,
}

/// An item a participant holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveContextItem {
    /// The item's ID.
    pub item_id: u32,
    /// The item's display name.
    pub name: String,
    /// The stack size.
    pub count: u8,
}

/// The newest game event, by name and time only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveContextEvent {
    /// Sequence number.
    pub id: u32,
    /// What happened, such as `DragonKill`.
    pub kind: String,
    /// Game time in seconds.
    pub time_secs: f64,
}

/// The finished game, by Riot match ID only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PostgameContext {
    /// Such as `NA1_5663121007`.
    pub match_id: String,
}

/// A context that parsed but breaks a bound serde cannot state.
#[derive(Debug, Error, PartialEq, Eq)]
#[error("the game context breaks the coach contract at {0}")]
pub struct ContextError(String);

fn text(path: &str, value: &str, max: usize) -> Result<(), ContextError> {
    let length = value.chars().count();
    if length == 0 || length > max {
        return Err(ContextError(path.to_owned()));
    }
    Ok(())
}

fn at_most<T>(path: &str, values: &[T], max: usize) -> Result<(), ContextError> {
    if values.len() > max {
        return Err(ContextError(path.to_owned()));
    }
    Ok(())
}

fn number(path: &str, value: f64) -> Result<(), ContextError> {
    if !value.is_finite() {
        return Err(ContextError(path.to_owned()));
    }
    Ok(())
}

fn spells(path: &str, names: &[String; 2]) -> Result<(), ContextError> {
    names.iter().try_for_each(|name| text(path, name, NAME_MAX))
}

fn keystone(path: &str, name: Option<&str>) -> Result<(), ContextError> {
    name.map_or(Ok(()), |name| text(path, name, NAME_MAX))
}

/// `^[A-Z0-9]{2,6}_\d{1,20}$`, without a regex engine.
fn match_id(value: &str) -> bool {
    value.split_once('_').is_some_and(|(platform, number)| {
        (2..=6).contains(&platform.len())
            && platform
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
            && (1..=20).contains(&number.len())
            && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

impl GameContext {
    /// A context of the live game alone.
    #[must_use]
    pub fn live(snapshot: &LiveSnapshot) -> Self {
        Self {
            live: Some(LiveContext::from(snapshot)),
            ..Self::default()
        }
    }

    /// A context of the champion-select screen alone: the allowlisted
    /// projection of what the select shows, with no identity in it.
    ///
    /// # Errors
    ///
    /// [`ContextError`] when the screen breaks a bound the contract states, such
    /// as a cell or champion that is not a small non-negative number.
    pub fn champ_select(snapshot: &ChampSelectSnapshot) -> Result<Self, ContextError> {
        let context = Self {
            champ_select: Some(ChampSelectContext::try_from(snapshot)?),
            ..Self::default()
        };
        context.validate()?;
        Ok(context)
    }

    /// A context of the loading screen alone, read from the first frame of
    /// the game: the mode and map and each player's champion, spells and
    /// keystone, which the loading screen showed them.
    ///
    /// # Errors
    ///
    /// [`ContextError`] when the frame breaks a bound the contract states.
    pub fn pregame(snapshot: &LiveSnapshot) -> Result<Self, ContextError> {
        let context = Self {
            pregame: Some(PregameContext::from(snapshot)),
            ..Self::default()
        };
        context.validate()?;
        Ok(context)
    }

    /// Check what serde cannot: at least one section, and every bound.
    ///
    /// # Errors
    ///
    /// [`ContextError`] naming the first field out of bounds.
    pub fn validate(&self) -> Result<(), ContextError> {
        if self.champ_select.is_none()
            && self.pregame.is_none()
            && self.live.is_none()
            && self.postgame.is_none()
        {
            return Err(ContextError("the context, which has no section".to_owned()));
        }
        if let Some(select) = &self.champ_select {
            select.validate()?;
        }
        if let Some(pregame) = &self.pregame {
            pregame.validate()?;
        }
        if let Some(live) = &self.live {
            live.validate()?;
        }
        if let Some(postgame) = &self.postgame
            && !match_id(&postgame.match_id)
        {
            return Err(ContextError("postgame.matchId".to_owned()));
        }
        Ok(())
    }
}

impl ChampSelectContext {
    fn validate(&self) -> Result<(), ContextError> {
        if let Some(phase) = &self.phase {
            text("champSelect.phase", phase, PHASE_MAX)?;
        }
        at_most("champSelect.myTeam", &self.my_team, TEAM_MAX)?;
        at_most("champSelect.theirTeam", &self.their_team, TEAM_MAX)?;
        at_most("champSelect.myBans", &self.my_bans, TEAM_MAX)?;
        at_most("champSelect.theirBans", &self.their_bans, TEAM_MAX)?;
        self.my_team.iter().try_for_each(|slot| {
            slot.assigned_role.as_deref().map_or(Ok(()), |role| {
                text("champSelect.myTeam.assignedRole", role, ROLE_MAX)
            })
        })
    }
}

impl PregameContext {
    fn validate(&self) -> Result<(), ContextError> {
        text("pregame.game.mode", &self.game.mode, NAME_MAX)?;
        text("pregame.game.map", &self.game.map, NAME_MAX)?;
        at_most("pregame.participants", &self.participants, PARTICIPANTS_MAX)?;
        self.participants.iter().try_for_each(|player| {
            text("pregame.participants.champion", &player.champion, NAME_MAX)?;
            spells(
                "pregame.participants.summonerSpells",
                &player.summoner_spells,
            )?;
            keystone("pregame.participants.keystone", player.keystone.as_deref())
        })
    }
}

impl LiveContext {
    fn validate(&self) -> Result<(), ContextError> {
        text("live.game.mode", &self.game.mode, NAME_MAX)?;
        text("live.game.map", &self.game.map, NAME_MAX)?;
        text("live.own.resource", &self.own.resource, NAME_MAX)?;
        let own = &self.own;
        for value in [
            own.max_health,
            own.health,
            own.max_resource,
            own.current_resource,
            own.armor,
            own.magic_resist,
            own.attack_damage,
            own.ability_power,
            own.attack_speed,
            own.move_speed,
            own.crit_chance,
        ] {
            number("live.own", value)?;
        }
        at_most("live.participants", &self.participants, PARTICIPANTS_MAX)?;
        for player in &self.participants {
            text("live.participants.champion", &player.champion, NAME_MAX)?;
            at_most("live.participants.items", &player.items, ITEMS_MAX)?;
            for item in &player.items {
                text("live.participants.items.name", &item.name, ITEM_NAME_MAX)?;
            }
            spells("live.participants.summonerSpells", &player.summoner_spells)?;
            keystone("live.participants.keystone", player.keystone.as_deref())?;
        }
        if let Some(event) = &self.latest_event {
            text("live.latestEvent.kind", &event.kind, NAME_MAX)?;
            if !event.time_secs.is_finite() || event.time_secs < 0.0 {
                return Err(ContextError("live.latestEvent.timeSecs".to_owned()));
            }
        }
        Ok(())
    }
}

impl From<&LiveGameInfo> for LiveGame {
    fn from(game: &LiveGameInfo) -> Self {
        Self {
            mode: game.mode.clone(),
            map: game.map.clone(),
            game_time_secs: game.game_time_secs,
        }
    }
}

impl From<&OwnStats> for LiveOwnStats {
    fn from(own: &OwnStats) -> Self {
        Self {
            gold: own.gold,
            max_health: own.max_health,
            health: own.health,
            resource: own.resource.clone(),
            max_resource: own.max_resource,
            current_resource: own.current_resource,
            armor: own.armor,
            magic_resist: own.magic_resist,
            attack_damage: own.attack_damage,
            ability_power: own.ability_power,
            attack_speed: own.attack_speed,
            move_speed: own.move_speed,
            crit_chance: own.crit_chance,
        }
    }
}

impl From<&LiveItem> for LiveContextItem {
    fn from(item: &LiveItem) -> Self {
        Self {
            item_id: item.item_id,
            name: item.name.clone(),
            count: item.count,
        }
    }
}

impl From<&LiveParticipant> for LiveContextParticipant {
    fn from(player: &LiveParticipant) -> Self {
        Self {
            team: player.team,
            is_self: player.is_self,
            champion: player.champion.clone(),
            level: player.level,
            kills: player.kills,
            deaths: player.deaths,
            assists: player.assists,
            creep_score: player.creep_score,
            items: player.items.iter().map(LiveContextItem::from).collect(),
            summoner_spells: player.summoner_spells.clone(),
            keystone: player.keystone.clone(),
        }
    }
}

impl From<&LiveEvent> for LiveContextEvent {
    fn from(event: &LiveEvent) -> Self {
        Self {
            id: event.id,
            kind: event.kind.clone(),
            time_secs: event.time_secs,
        }
    }
}

impl From<&LiveSnapshot> for LiveContext {
    fn from(snapshot: &LiveSnapshot) -> Self {
        Self {
            game: LiveGame::from(&snapshot.game),
            own: LiveOwnStats::from(&snapshot.own),
            participants: snapshot
                .participants
                .iter()
                .map(LiveContextParticipant::from)
                .collect(),
            event_count: snapshot.event_count,
            latest_event: snapshot.latest_event.as_ref().map(LiveContextEvent::from),
        }
    }
}

impl From<&LiveSnapshot> for PregameContext {
    fn from(snapshot: &LiveSnapshot) -> Self {
        Self {
            game: PregameGame {
                mode: snapshot.game.mode.clone(),
                map: snapshot.game.map.clone(),
            },
            participants: snapshot
                .participants
                .iter()
                .map(|player| PregameParticipant {
                    team: player.team,
                    is_self: player.is_self,
                    champion: player.champion.clone(),
                    summoner_spells: player.summoner_spells.clone(),
                    keystone: player.keystone.clone(),
                })
                .collect(),
        }
    }
}

impl TryFrom<&ChampSelectSnapshot> for ChampSelectContext {
    type Error = ContextError;

    fn try_from(snapshot: &ChampSelectSnapshot) -> Result<Self, ContextError> {
        let cell =
            |path: &str, value: i64| u8::try_from(value).map_err(|_| ContextError(path.to_owned()));
        let champion = |path: &str, value: i64| {
            u32::try_from(value).map_err(|_| ContextError(path.to_owned()))
        };
        let champions = |path: &str, values: &[i64]| {
            values
                .iter()
                .map(|value| champion(path, *value))
                .collect::<Result<Vec<_>, _>>()
        };
        Ok(Self {
            phase: snapshot.phase.clone(),
            local_cell_id: cell("champSelect.localCellId", snapshot.local_cell_id)?,
            my_team: snapshot
                .my_team
                .iter()
                .map(|slot| {
                    Ok(AllySlot {
                        cell_id: cell("champSelect.myTeam.cellId", slot.cell_id)?,
                        champion_id: champion("champSelect.myTeam.championId", slot.champion_id)?,
                        assigned_role: slot.assigned_position.clone(),
                    })
                })
                .collect::<Result<_, ContextError>>()?,
            their_team: snapshot
                .their_team
                .iter()
                .map(|slot| {
                    Ok(EnemySlot {
                        cell_id: cell("champSelect.theirTeam.cellId", slot.cell_id)?,
                        champion_id: champion(
                            "champSelect.theirTeam.championId",
                            slot.champion_id,
                        )?,
                    })
                })
                .collect::<Result<_, ContextError>>()?,
            my_bans: champions("champSelect.myBans", &snapshot.my_bans)?,
            their_bans: champions("champSelect.theirBans", &snapshot.their_bans)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::Value;

    use super::GameContext;
    use crate::live::snapshot::tests::fixture_snapshot;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn the_select_screen_projects_without_an_identity() -> TestResult {
        let snapshot = crate::live::champ_select::parse(&serde_json::from_str(include_str!(
            "../testdata/live/champ-select.json"
        ))?)?;
        let context = GameContext::champ_select(&snapshot)?;
        let select = context.champ_select.ok_or("champ select")?;
        assert_eq!(select.my_team.len(), 5);
        assert_eq!(select.my_team[2].champion_id, 103);
        assert_eq!(select.my_bans, [238, 157]);
        let wire = serde_json::to_string(&select)?;
        for hidden in ["puuid", "summonerId", "gameName", "summonerName"] {
            assert!(!wire.contains(hidden), "{hidden} crossed");
        }
        Ok(())
    }

    #[test]
    fn a_negative_cell_breaks_the_projection_rather_than_wrapping() -> TestResult {
        let mut snapshot = crate::live::champ_select::parse(&serde_json::from_str(include_str!(
            "../testdata/live/champ-select.json"
        ))?)?;
        snapshot.local_cell_id = -1;
        assert!(GameContext::champ_select(&snapshot).is_err());
        Ok(())
    }

    #[test]
    fn the_first_frame_projects_the_loading_screen() -> TestResult {
        let context = GameContext::pregame(&fixture_snapshot()?)?;
        let pregame = context.pregame.ok_or("pregame")?;
        assert!(context.live.is_none());
        assert!(pregame.participants.iter().any(|player| player.is_self));
        Ok(())
    }

    const SCHEMA: &str =
        include_str!("../../../../data/src/scout-client/coach-context.schema.json");
    const FIXTURES: &str =
        include_str!("../../../../data/src/scout-client/coach-context.fixtures.json");

    fn parse(body: &Value) -> Result<GameContext, String> {
        let context: GameContext =
            serde_json::from_value(body.clone()).map_err(|error| error.to_string())?;
        context.validate().map_err(|error| error.to_string())?;
        Ok(context)
    }

    /// Every dotted key path a JSON value uses.
    fn used_paths(value: &Value, prefix: &str, found: &mut BTreeSet<String>) {
        match value {
            Value::Array(entries) => {
                for entry in entries {
                    used_paths(entry, prefix, found);
                }
            }
            Value::Object(object) => {
                for (key, child) in object {
                    let path = format!("{prefix}{key}");
                    used_paths(child, &format!("{path}."), found);
                    found.insert(path);
                }
            }
            _ => {}
        }
    }

    /// Every dotted property path the JSON Schema declares, `$ref`s followed.
    fn declared_paths(schema: &Value, node: &Value, prefix: &str, found: &mut BTreeSet<String>) {
        if let Some(target) = node["$ref"]
            .as_str()
            .and_then(|reference| reference.strip_prefix("#/$defs/"))
        {
            declared_paths(schema, &schema["$defs"][target], prefix, found);
            return;
        }
        if let Some(properties) = node["properties"].as_object() {
            for (key, child) in properties {
                let path = format!("{prefix}{key}");
                declared_paths(schema, child, &format!("{path}."), found);
                found.insert(path);
            }
        }
        for key in ["items", "anyOf", "prefixItems"] {
            match &node[key] {
                Value::Array(entries) => {
                    for entry in entries {
                        declared_paths(schema, entry, prefix, found);
                    }
                }
                child @ Value::Object(_) => declared_paths(schema, child, prefix, found),
                _ => {}
            }
        }
    }

    #[test]
    fn every_accept_fixture_parses_and_round_trips() -> TestResult {
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        for case in fixtures["valid"].as_array().ok_or("valid fixtures")? {
            let name = case["name"].as_str().unwrap_or("?");
            let context = parse(&case["body"]).map_err(|error| format!("{name}: {error}"))?;
            // Typed, because a whole-number stat reads back as `64.0`.
            assert_eq!(parse(&serde_json::to_value(&context)?)?, context, "{name}");
        }
        Ok(())
    }

    #[test]
    fn every_reject_fixture_is_refused() -> TestResult {
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        for case in fixtures["invalid"].as_array().ok_or("invalid fixtures")? {
            let reason = case["reason"].as_str().unwrap_or("?");
            assert!(parse(&case["body"]).is_err(), "must refuse {reason}");
        }
        Ok(())
    }

    #[test]
    fn the_complete_fixture_covers_the_schema_and_these_types_keep_it_all() -> TestResult {
        let schema: Value = serde_json::from_str(SCHEMA)?;
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        let complete = &fixtures["valid"][0]["body"];
        let mut declared = BTreeSet::new();
        declared_paths(&schema, &schema, "", &mut declared);
        let mut used = BTreeSet::new();
        used_paths(complete, "", &mut used);
        assert_eq!(used, declared);
        // The round trip is lossless, so every declared field has a home here.
        let mut kept = BTreeSet::new();
        used_paths(&serde_json::to_value(parse(complete)?)?, "", &mut kept);
        assert_eq!(kept, declared);
        Ok(())
    }

    #[test]
    fn a_live_snapshot_projects_to_a_valid_context() -> TestResult {
        let context = GameContext::live(&fixture_snapshot()?);
        context.validate()?;
        let wire = serde_json::to_value(&context)?;
        let again = parse(&wire)?;
        assert_eq!(again, context);
        let live = context.live.as_ref().ok_or("live section")?;
        assert_eq!(live.participants.len(), 10);
        assert_eq!(live.game.game_time_secs, 421);
        Ok(())
    }
}
