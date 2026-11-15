//! A typed projection of the champion-select session.
//!
//! The session carries every player's summoner ID, PUUID and (for the enemy
//! team, once revealed) more than a player can see during the select. The
//! projection keeps only what the select screen itself shows: champion IDs,
//! bans, and the local player's own slot. No summoner or Riot identity has a
//! field here, so a hidden champion-select identity cannot be projected.

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

/// One slot on the local player's team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllySlot {
    /// The slot's cell.
    pub cell_id: i64,
    /// The locked or hovered champion; 0 when none.
    pub champion_id: i64,
    /// The role the client assigned, when it assigned one.
    pub assigned_position: Option<String>,
}

/// One slot on the other team. The client reveals only the champion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnemySlot {
    /// The slot's cell.
    pub cell_id: i64,
    /// The revealed champion; 0 while it is hidden.
    pub champion_id: i64,
}

/// What the select screen shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChampSelectSnapshot {
    /// The timer's phase, such as `BAN_PICK`.
    pub phase: Option<String>,
    /// The local player's cell.
    pub local_cell_id: i64,
    /// The local player's team.
    pub my_team: Vec<AllySlot>,
    /// The other team.
    pub their_team: Vec<EnemySlot>,
    /// Champions the local team banned.
    pub my_bans: Vec<i64>,
    /// Champions the other team banned.
    pub their_bans: Vec<i64>,
}

/// The session did not decode.
#[derive(Debug, Error, PartialEq, Eq)]
#[error("the champion select session was malformed: {0}")]
pub struct ChampSelectError(String);

#[derive(Deserialize)]
struct RawSession {
    #[serde(rename = "localPlayerCellId")]
    local_player_cell_id: i64,
    #[serde(rename = "myTeam", default)]
    my_team: Vec<RawSlot>,
    #[serde(rename = "theirTeam", default)]
    their_team: Vec<RawSlot>,
    #[serde(default)]
    bans: RawBans,
    #[serde(default)]
    timer: Option<RawTimer>,
}

#[derive(Deserialize)]
struct RawSlot {
    #[serde(rename = "cellId")]
    cell_id: i64,
    #[serde(rename = "championId", default)]
    champion_id: i64,
    #[serde(rename = "assignedPosition", default)]
    assigned_position: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawBans {
    #[serde(rename = "myTeamBans", default)]
    my_team_bans: Vec<i64>,
    #[serde(rename = "theirTeamBans", default)]
    their_team_bans: Vec<i64>,
}

#[derive(Deserialize)]
struct RawTimer {
    #[serde(default)]
    phase: Option<String>,
}

/// Project `/lol-champ-select/v1/session`.
///
/// # Errors
///
/// [`ChampSelectError`] when the payload lacks the local player's cell or a
/// slot lacks its cell.
pub fn parse(value: &Value) -> Result<ChampSelectSnapshot, ChampSelectError> {
    let raw: RawSession = serde_json::from_value(value.clone())
        .map_err(|error| ChampSelectError(error.to_string()))?;
    Ok(ChampSelectSnapshot {
        phase: raw.timer.and_then(|timer| timer.phase),
        local_cell_id: raw.local_player_cell_id,
        my_team: raw
            .my_team
            .into_iter()
            .map(|slot| AllySlot {
                cell_id: slot.cell_id,
                champion_id: slot.champion_id,
                assigned_position: slot.assigned_position.filter(|role| !role.is_empty()),
            })
            .collect(),
        their_team: raw
            .their_team
            .into_iter()
            .map(|slot| EnemySlot {
                cell_id: slot.cell_id,
                champion_id: slot.champion_id,
            })
            .collect(),
        my_bans: raw.bans.my_team_bans,
        their_bans: raw.bans.their_team_bans,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::parse;

    const FIXTURE: &str = include_str!("../../testdata/live/champ-select.json");

    #[test]
    fn the_projection_keeps_champions_bans_and_the_local_slot()
    -> Result<(), Box<dyn std::error::Error>> {
        let snapshot = parse(&serde_json::from_str::<Value>(FIXTURE)?)?;
        assert_eq!(snapshot.phase.as_deref(), Some("BAN_PICK"));
        assert_eq!(snapshot.local_cell_id, 2);
        assert_eq!(snapshot.my_team.len(), 5);
        assert_eq!(snapshot.my_team[2].champion_id, 103);
        assert_eq!(
            snapshot.my_team[2].assigned_position.as_deref(),
            Some("middle")
        );
        assert_eq!(snapshot.their_team.len(), 5);
        assert!(snapshot.their_team.iter().all(|slot| slot.champion_id == 0));
        assert_eq!(snapshot.my_bans, [238, 157]);
        assert_eq!(snapshot.their_bans, [64]);
        Ok(())
    }

    #[test]
    fn no_identity_survives_the_projection() -> Result<(), Box<dyn std::error::Error>> {
        let full: Value = serde_json::from_str(FIXTURE)?;
        let text = format!("{:?}", parse(&full)?);
        for identity in ["puuid", "summonerId", "gameName", "FIXTURE-"] {
            assert!(
                FIXTURE.contains(identity),
                "the fixture should carry {identity}"
            );
            assert!(
                !text.to_lowercase().contains(&identity.to_lowercase()),
                "{identity} leaked: {text}"
            );
        }
        Ok(())
    }

    #[test]
    fn a_session_without_the_local_cell_is_malformed() {
        assert!(parse(&serde_json::json!({"myTeam": []})).is_err());
    }
}
