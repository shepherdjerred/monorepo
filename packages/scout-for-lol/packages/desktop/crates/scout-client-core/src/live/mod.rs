//! Live game state: what the running League client and game expose while a
//! match is being played, reduced to an allowlist before anything else sees it.
//!
//! The content limit is "nothing the player cannot see in their own client".
//! It is enforced by type, not by filtering at the edges:
//!
//! - [`model`] parses Riot's Live Client Data `allgamedata`, and its structs
//!   declare only the fields the projection needs. Riot IDs, summoner names,
//!   skins and the enemy ward score are not declared, so they are never held.
//! - [`snapshot::LiveSnapshot`] is the only live-game type that leaves the
//!   [`source`] boundary, and it has no field that could carry an identity, a
//!   skin, a ward score, a cooldown or a position.
//! - [`champ_select`] projects the champion-select session the same way, so
//!   hidden champion-select identities never leave the League client call.
//!
//! [`game_settings`] reads only the game's window mode, so Scout can warn
//! when exclusive fullscreen will hide the in-game overlay.
//!
//! [`recording`] keeps snapshots on this device. [`upload`] queues a finished
//! game's recording as a `live_game_recording` observation.
//!
//! `detectors` (beta profile only) finds the scoreboard changes a proactive
//! coach turn may be asked for. Riot's published policy prohibits unprompted
//! alerts from live game state, so a stable build does not compile it.

pub mod champ_select;
#[cfg(scout_proactive_coach)]
pub mod detectors;
pub mod game_settings;
pub mod gameflow;
pub mod model;
pub mod recording;
pub mod session;
pub mod snapshot;
pub mod source;
pub mod upload;

#[cfg(test)]
mod tests {
    use crate::profile::ReleaseProfile;

    #[test]
    fn proactive_detectors_compile_only_into_the_beta_profile() {
        assert_eq!(
            cfg!(scout_proactive_coach),
            ReleaseProfile::compiled().channel == "beta"
        );
    }
}
