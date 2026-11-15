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
//! [`recording`] keeps snapshots on this device. Nothing here uploads.

pub mod champ_select;
pub mod gameflow;
pub mod model;
pub mod recording;
pub mod session;
pub mod snapshot;
pub mod source;
