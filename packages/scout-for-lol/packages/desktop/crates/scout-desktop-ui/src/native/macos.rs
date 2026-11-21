//! macOS: `NSWindow.ignoresMouseEvents`.
//!
//! GPUI's `WindowKind::PopUp` is a non-activating `NSPanel` at the pop-up
//! window level, joined to every Space and allowed beside fullscreen apps, so
//! it already stays on top. Ignoring mouse events sends every click, scroll
//! and hover to the window beneath.

#![expect(
    unsafe_code,
    reason = "a raw AppKit view pointer becomes an NSView reference here, and only here"
)]

use objc2_app_kit::NSView;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

pub(super) fn make_click_through(window: &impl HasWindowHandle) -> Result<(), String> {
    let handle = window
        .window_handle()
        .map_err(|error| format!("the overlay has no window handle: {error}"))?;
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        return Err("the overlay is not an AppKit window".to_owned());
    };
    // SAFETY: `ns_view` is the content view GPUI created for this window. The
    // borrowed `handle` keeps the window, and so the view, alive for this
    // call, and GPUI calls the window's build closure on the main thread,
    // where AppKit objects may be used.
    let view: &NSView = unsafe { appkit.ns_view.cast::<NSView>().as_ref() };
    let ns_window = view
        .window()
        .ok_or_else(|| "the overlay view is not in a window".to_owned())?;
    ns_window.setIgnoresMouseEvents(true);
    if ns_window.ignoresMouseEvents() {
        Ok(())
    } else {
        Err("macOS kept delivering mouse events to the overlay".to_owned())
    }
}
