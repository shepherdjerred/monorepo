//! The allowlisted live-game snapshot.
//!
//! [`LiveSnapshot`] is the only live-game type that leaves the source
//! boundary. Its fields are the allowlist: the local player's own stats, and
//! for both teams champion, level, K/D/A, CS, items, summoner spell names and
//! keystone. There is deliberately no field for a Riot ID, summoner name, skin,
//! the enemy ward score, a cooldown or a position, so none can be added by
//! accident in [`project`] and none can survive a round trip through a
//! recording (`deny_unknown_fields`).

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::model::{AllGameData, ChampionStats, Event, Player, TeamSide};

/// Which side of the map a participant is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Team {
    /// The blue side.
    Order,
    /// The red side.
    Chaos,
}

impl From<TeamSide> for Team {
    fn from(side: TeamSide) -> Self {
        match side {
            TeamSide::Order => Self::Order,
            TeamSide::Chaos => Self::Chaos,
        }
    }
}

/// Mode, map and clock.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveGameInfo {
    /// The mode, such as `CLASSIC`.
    pub mode: String,
    /// The map's internal name.
    pub map: String,
    /// Whole seconds on the game clock.
    pub game_time_secs: u32,
}

/// The local player's stats-panel values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnStats {
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

impl From<&ChampionStats> for OwnStats {
    fn from(stats: &ChampionStats) -> Self {
        Self {
            gold: 0,
            max_health: stats.max_health,
            health: stats.current_health,
            resource: stats.resource_type.clone(),
            max_resource: stats.resource_max,
            current_resource: stats.resource_value,
            armor: stats.armor,
            magic_resist: stats.magic_resist,
            attack_damage: stats.attack_damage,
            ability_power: stats.ability_power,
            attack_speed: stats.attack_speed,
            move_speed: stats.move_speed,
            crit_chance: stats.crit_chance,
        }
    }
}

/// An item a participant holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveItem {
    /// The item's ID.
    pub item_id: u32,
    /// The item's display name.
    pub name: String,
    /// The stack size.
    pub count: u8,
}

/// One player of either team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveParticipant {
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
    pub items: Vec<LiveItem>,
    /// The two summoner spell names, never their cooldown state.
    pub summoner_spells: [String; 2],
    /// The keystone rune's name.
    pub keystone: Option<String>,
}

/// The newest game event, by name and time only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveEvent {
    /// Sequence number.
    pub id: u32,
    /// What happened, such as `DragonKill`. The players involved are not kept.
    pub kind: String,
    /// Game time in seconds.
    pub time_secs: f64,
}

/// A point-in-time, allowlisted view of a game in progress.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveSnapshot {
    /// Mode, map and clock.
    pub game: LiveGameInfo,
    /// The local player's stats.
    pub own: OwnStats,
    /// Both teams, in the game's order.
    pub participants: Vec<LiveParticipant>,
    /// How many events the game has logged so far.
    pub event_count: u32,
    /// The newest event.
    pub latest_event: Option<LiveEvent>,
}

impl LiveSnapshot {
    /// The local player's entry.
    #[must_use]
    pub fn local(&self) -> Option<&LiveParticipant> {
        self.participants.iter().find(|player| player.is_self)
    }
}

/// Why a frame could not be projected.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProjectionError {
    /// The active player matches no entry of `allPlayers`.
    #[error("the active player is not in the game's player list")]
    LocalPlayerMissing,
}

/// Whole units of a non-negative float; negative and NaN become zero.
#[must_use]
pub fn whole(value: f64) -> u32 {
    // Printing the floored, clamped value as an integer avoids a lossy `as`
    // cast; NaN prints as `NaN`, which does not parse, and becomes zero.
    format!("{:.0}", value.clamp(0.0, f64::from(u32::MAX)).floor())
        .parse()
        .unwrap_or(0)
}

/// Reduce a decoded frame to the allowlist.
///
/// # Errors
///
/// [`ProjectionError::LocalPlayerMissing`] when the frame names an active
/// player who is not in the roster, which is a broken frame rather than a game
/// without a local player.
pub fn project(data: &AllGameData) -> Result<LiveSnapshot, ProjectionError> {
    if !data
        .all_players
        .iter()
        .any(|player| player.riot_id == data.active_player.riot_id)
    {
        return Err(ProjectionError::LocalPlayerMissing);
    }
    let mut own = OwnStats::from(&data.active_player.champion_stats);
    own.gold = whole(data.active_player.current_gold);
    Ok(LiveSnapshot {
        game: LiveGameInfo {
            mode: data.game_data.game_mode.clone(),
            map: data.game_data.map_name.clone(),
            game_time_secs: whole(data.game_data.game_time),
        },
        own,
        participants: data
            .all_players
            .iter()
            .map(|player| participant(player, &data.active_player.riot_id))
            .collect(),
        event_count: u32::try_from(data.events.events.len()).unwrap_or(u32::MAX),
        latest_event: data.events.events.last().map(latest_event),
    })
}

fn participant(player: &Player, local_riot_id: &str) -> LiveParticipant {
    LiveParticipant {
        team: player.team.into(),
        is_self: player.riot_id == local_riot_id,
        champion: player.champion_name.clone(),
        level: player.level,
        kills: player.scores.kills,
        deaths: player.scores.deaths,
        assists: player.scores.assists,
        creep_score: player.scores.creep_score,
        items: player
            .items
            .iter()
            .map(|item| LiveItem {
                item_id: item.item_id,
                name: item.display_name.clone(),
                count: item.count,
            })
            .collect(),
        summoner_spells: [
            player.summoner_spells.one.display_name.clone(),
            player.summoner_spells.two.display_name.clone(),
        ],
        keystone: player
            .runes
            .as_ref()
            .map(|runes| runes.keystone.display_name.clone()),
    }
}

fn latest_event(event: &Event) -> LiveEvent {
    LiveEvent {
        id: event.id,
        kind: event.name.clone(),
        time_secs: event.time,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::Value;

    use super::{LiveSnapshot, ProjectionError, Team, project};
    use crate::live::model::AllGameData;

    pub(crate) const FIXTURE: &str = include_str!("../../testdata/live/allgamedata.json");

    pub(crate) fn fixture_snapshot() -> Result<LiveSnapshot, Box<dyn std::error::Error>> {
        let data: AllGameData = serde_json::from_str(FIXTURE)?;
        Ok(project(&data)?)
    }

    /// Every key, at any depth, of a JSON value.
    fn keys(value: &Value, found: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, inner) in map {
                    found.push(key.clone());
                    keys(inner, found);
                }
            }
            Value::Array(items) => items.iter().for_each(|item| keys(item, found)),
            _ => {}
        }
    }

    #[test]
    fn the_projection_keeps_the_allowlist() -> Result<(), Box<dyn std::error::Error>> {
        let snapshot = fixture_snapshot()?;
        assert_eq!(snapshot.game.mode, "CLASSIC");
        assert_eq!(snapshot.game.game_time_secs, 421);
        assert_eq!(snapshot.own.gold, 845);
        assert_eq!(snapshot.participants.len(), 10);
        assert_eq!(
            snapshot
                .participants
                .iter()
                .filter(|p| p.team == Team::Order)
                .count(),
            5
        );
        let local = snapshot.local().ok_or("local player")?;
        assert_eq!(local.champion, "Ahri");
        assert_eq!(local.keystone.as_deref(), Some("Electrocute"));
        assert_eq!(local.summoner_spells, ["Flash", "Heal"]);
        assert_eq!(local.items.len(), 3);
        assert_eq!(snapshot.event_count, 4);
        assert_eq!(
            snapshot.latest_event.as_ref().map(|e| e.kind.as_str()),
            Some("DragonKill")
        );
        Ok(())
    }

    #[test]
    fn identities_skins_ward_scores_cooldowns_and_positions_are_absent()
    -> Result<(), Box<dyn std::error::Error>> {
        // The fixture is a full allgamedata frame that carries every one of
        // these, so their absence is the projection's doing.
        let full: Value = serde_json::from_str(FIXTURE)?;
        let mut full_keys = Vec::new();
        keys(&full, &mut full_keys);
        let forbidden = [
            "riotId",
            "riotIdGameName",
            "riotIdTagLine",
            "summonerName",
            "skinID",
            "skinName",
            "rawSkinName",
            "wardScore",
            "position",
            "respawnTimer",
            "isDead",
            "KillerName",
            "VictimName",
            "Assisters",
            "abilityHaste",
        ];
        for key in forbidden {
            assert!(
                full_keys.iter().any(|found| found == key),
                "the fixture should carry {key}"
            );
        }

        let projected = serde_json::to_value(fixture_snapshot()?)?;
        let mut projected_keys = Vec::new();
        keys(&projected, &mut projected_keys);
        for key in forbidden {
            assert!(
                !projected_keys.iter().any(|found| found == key),
                "{key} leaked into the projection"
            );
        }
        for key in &projected_keys {
            let lowered = key.to_lowercase();
            for banned in [
                "riot",
                "summonername",
                "skin",
                "ward",
                "cooldown",
                "position",
                "respawn",
                "haste",
            ] {
                assert!(!lowered.contains(banned), "{key} looks like {banned}");
            }
        }
        // Values too: no name from the fixture's roster survives.
        let text = serde_json::to_string(&projected)?;
        assert!(!text.contains("Fixture Player"), "{text}");
        assert!(!text.contains("Skin of fixture"), "{text}");
        Ok(())
    }

    #[test]
    fn a_recording_cannot_smuggle_a_forbidden_field_back_in()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut value = serde_json::to_value(fixture_snapshot()?)?;
        let Some(first) = value
            .get_mut("participants")
            .and_then(|players| players.get_mut(0))
            .and_then(Value::as_object_mut)
        else {
            return Err("participants".into());
        };
        first.insert("summonerName".to_owned(), Value::from("someone"));
        assert!(serde_json::from_value::<LiveSnapshot>(value).is_err());
        Ok(())
    }

    #[test]
    fn whole_numbers_floor_and_clamp() {
        assert_eq!(super::whole(421.9), 421);
        assert_eq!(super::whole(-3.0), 0);
        assert_eq!(super::whole(f64::NAN), 0);
        assert_eq!(super::whole(1e12), u32::MAX);
    }

    #[test]
    fn an_active_player_missing_from_the_roster_is_a_broken_frame()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut data: AllGameData = serde_json::from_str(FIXTURE)?;
        data.active_player.riot_id = "nobody#0".to_owned();
        assert_eq!(
            project(&data).err(),
            Some(ProjectionError::LocalPlayerMissing)
        );
        Ok(())
    }
}
