//! Riot's Live Client Data `allgamedata`, as far as Scout reads it.
//!
//! Riot documents the shape at
//! <https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api>.
//! The structs deliberately declare **only** the fields the
//! [projection](super::snapshot::project) needs: serde skips every other key,
//! so a player's `riotId` (beyond the match below), `summonerName`, `skinID`,
//! `skinName`, `rawSkinName`, `wardScore`, `position`, `respawnTimer` and the
//! identities inside event payloads are never deserialized, let alone held.
//!
//! The one identity this model reads is `riotId`, and only to find which entry
//! of `allPlayers` is the local player. It is not exposed and these types do
//! not implement `Debug`, so it cannot reach a log line.
//!
//! The data is Riot's, not ours: a missing required field or an unknown team
//! is a decode error rather than something to guess around.

use serde::Deserialize;

/// One complete in-game frame.
#[derive(Clone, Deserialize)]
pub struct AllGameData {
    /// The local player.
    #[serde(rename = "activePlayer")]
    pub active_player: ActivePlayer,
    /// Every player in the game, both teams.
    #[serde(rename = "allPlayers")]
    pub all_players: Vec<Player>,
    /// The game's event log.
    pub events: EventLog,
    /// Game clock and mode.
    #[serde(rename = "gameData")]
    pub game_data: GameData,
}

/// The local player's own view.
#[derive(Clone, Deserialize)]
pub struct ActivePlayer {
    /// Live stats, as the stats panel shows them.
    #[serde(rename = "championStats")]
    pub champion_stats: ChampionStats,
    /// Unspent gold.
    #[serde(rename = "currentGold")]
    pub current_gold: f64,
    /// Champion level.
    pub level: u8,
    /// Used only to find this player in [`AllGameData::all_players`].
    #[serde(rename = "riotId")]
    pub riot_id: String,
}

/// The local player's stats-panel values that Scout keeps.
///
/// Cooldown-derived stats such as ability haste are not declared.
#[derive(Clone, Deserialize)]
pub struct ChampionStats {
    /// Maximum health.
    #[serde(rename = "maxHealth")]
    pub max_health: f64,
    /// Current health.
    #[serde(rename = "currentHealth")]
    pub current_health: f64,
    /// The resource's name, such as `MANA`.
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    /// Maximum resource.
    #[serde(rename = "resourceMax")]
    pub resource_max: f64,
    /// Current resource.
    #[serde(rename = "resourceValue")]
    pub resource_value: f64,
    /// Armor.
    pub armor: f64,
    /// Magic resistance.
    #[serde(rename = "magicResist")]
    pub magic_resist: f64,
    /// Attack damage.
    #[serde(rename = "attackDamage")]
    pub attack_damage: f64,
    /// Ability power.
    #[serde(rename = "abilityPower")]
    pub ability_power: f64,
    /// Attacks per second.
    #[serde(rename = "attackSpeed")]
    pub attack_speed: f64,
    /// Movement speed.
    #[serde(rename = "moveSpeed")]
    pub move_speed: f64,
    /// Critical strike chance.
    #[serde(rename = "critChance")]
    pub crit_chance: f64,
}

/// One entry of `allPlayers`.
#[derive(Clone, Deserialize)]
pub struct Player {
    /// The champion's display name.
    #[serde(rename = "championName")]
    pub champion_name: String,
    /// Champion level.
    pub level: u8,
    /// Items, in slot order.
    pub items: Vec<Item>,
    /// Kills, deaths, assists and creep score.
    pub scores: Scores,
    /// The two summoner spells.
    #[serde(rename = "summonerSpells")]
    pub summoner_spells: SummonerSpells,
    /// The keystone rune, when the player has runes.
    #[serde(default)]
    pub runes: Option<Runes>,
    /// Which team the player is on.
    pub team: TeamSide,
    /// Used only to find the local player; see the module docs.
    #[serde(rename = "riotId")]
    pub riot_id: String,
}

/// An item in an inventory slot.
#[derive(Clone, Deserialize)]
pub struct Item {
    /// The item's ID.
    #[serde(rename = "itemID")]
    pub item_id: u32,
    /// The item's display name.
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// The stack size.
    pub count: u8,
}

/// The scoreboard numbers Scout keeps. The ward score is not declared.
#[derive(Clone, Deserialize)]
pub struct Scores {
    /// Kills.
    pub kills: u32,
    /// Deaths.
    pub deaths: u32,
    /// Assists.
    pub assists: u32,
    /// Minions and monsters killed.
    #[serde(rename = "creepScore")]
    pub creep_score: u32,
}

/// The two summoner spells.
#[derive(Clone, Deserialize)]
pub struct SummonerSpells {
    /// First spell.
    #[serde(rename = "summonerSpellOne")]
    pub one: Named,
    /// Second spell.
    #[serde(rename = "summonerSpellTwo")]
    pub two: Named,
}

/// A thing with a display name; the rest of its payload is not read.
#[derive(Clone, Deserialize)]
pub struct Named {
    /// The display name.
    #[serde(rename = "displayName")]
    pub display_name: String,
}

/// A player's runes; only the keystone is read.
#[derive(Clone, Deserialize)]
pub struct Runes {
    /// The keystone.
    pub keystone: Named,
}

/// The side a player is on.
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum TeamSide {
    /// The blue side.
    #[serde(rename = "ORDER")]
    Order,
    /// The red side.
    #[serde(rename = "CHAOS")]
    Chaos,
}

/// The event log wrapper Riot uses.
#[derive(Clone, Deserialize)]
pub struct EventLog {
    /// Events so far, oldest first. Only the ID, name and time are read: the
    /// killer, victim and assister names that ride along are not declared.
    #[serde(rename = "Events")]
    pub events: Vec<Event>,
}

/// One game event, without its payload.
#[derive(Clone, Deserialize)]
pub struct Event {
    /// Sequence number.
    #[serde(rename = "EventID")]
    pub id: u32,
    /// What happened, such as `DragonKill`.
    #[serde(rename = "EventName")]
    pub name: String,
    /// Game time in seconds.
    #[serde(rename = "EventTime")]
    pub time: f64,
}

/// Game mode and clock.
#[derive(Clone, Deserialize)]
pub struct GameData {
    /// The mode, such as `CLASSIC` or `ARAM`.
    #[serde(rename = "gameMode")]
    pub game_mode: String,
    /// Seconds since the game clock started.
    #[serde(rename = "gameTime")]
    pub game_time: f64,
    /// The map's internal name.
    #[serde(rename = "mapName")]
    pub map_name: String,
}
