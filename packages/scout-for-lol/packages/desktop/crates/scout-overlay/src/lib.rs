//! The toolkit-independent core of Scout Desktop's in-game overlay.
//!
//! Nothing here opens a window or touches a platform API: [`card`] is the
//! wire contract, [`controller`] decides what the overlay shows and when, and
//! [`geometry`] decides where, and [`text`] fits Scout's answers into a card.
//! The window that renders an [`controller::OverlayView`] lives in
//! `scout-desktop-ui`, and the supervisor in `scout-client-app` drives it.

pub mod card;
pub mod controller;
pub mod geometry;
pub mod text;

pub use card::{CardError, CardKind, CardPriority, OverlayCard};
pub use controller::{
    ControllerConfig, HotkeyEvent, OfferError, OverlayController, OverlayView, ProactivePolicy,
};
pub use geometry::{Anchor, GeometryError, HudRegions, Placement, Rect, ScreenRect};
