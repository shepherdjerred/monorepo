//! Platform code for the overlay window: the only place in the workspace
//! that may use `unsafe`.
//!
//! GPUI opens the overlay as a pop-up that takes no focus, but it still takes
//! clicks. These functions make the opened window let every mouse event
//! through to the game beneath it and keep it above the game. Each platform
//! file turns the window's raw handle into the platform's own window and calls
//! safe bindings on it; the conversion is the only `unsafe`.
//!
//! `tests/unsafe_boundary.rs` fails when `unsafe` appears anywhere else in the
//! workspace.

use raw_window_handle::HasWindowHandle;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

/// Make `window` click-through, topmost, and unable to take focus. Returns
/// what the platform reports back about the window, for the log.
///
/// # Errors
/// What the platform refused, safe to record. The caller must not show a
/// window this failed for: it would take the player's clicks.
pub fn make_click_through(window: &impl HasWindowHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return macos::make_click_through(window);
    #[cfg(windows)]
    return windows::make_click_through(window);
}
