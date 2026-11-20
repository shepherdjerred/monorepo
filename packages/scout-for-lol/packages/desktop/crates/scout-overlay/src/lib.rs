//! The toolkit-independent core of Scout Desktop's in-game overlay.
//!
//! Nothing here opens a window or touches a platform API: [`card`] is the
//! wire contract, [`controller`] decides what the overlay shows and when, and
//! [`geometry`] decides where. The native window that renders a
//! [`controller::OverlayView`] waits for the Windows hardware spike and lives
//! outside this crate.

pub mod card;
pub mod controller;
pub mod geometry;

pub use card::{CardError, CardKind, CardPriority, OverlayCard};
pub use controller::{
    ControllerConfig, HotkeyEvent, OfferError, OverlayController, OverlayView, ProactivePolicy,
};
pub use geometry::{Anchor, GeometryError, HudRegions, Placement, Rect, ScreenRect};
