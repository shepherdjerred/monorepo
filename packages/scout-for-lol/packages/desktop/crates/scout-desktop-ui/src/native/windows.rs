//! Windows: layered, transparent to input, never activated, topmost.
//!
//! GPUI's `WindowKind::PopUp` already has `WS_EX_TOOLWINDOW | WS_EX_TOPMOST`.
//! `WS_EX_TRANSPARENT` on a layered window sends hit-testing to the window
//! beneath, `WS_EX_NOACTIVATE` keeps a click or Alt+Tab from focusing it, and
//! `SetWindowPos(HWND_TOPMOST)` puts it above a borderless game. This has not
//! run over League; see the README's "In-game overlay".

#![expect(
    unsafe_code,
    reason = "a raw Win32 window handle becomes a winsafe HWND here, and only here"
)]

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use winsafe::{self as w, co};

pub(super) fn make_click_through(window: &impl HasWindowHandle) -> Result<String, String> {
    let handle = window
        .window_handle()
        .map_err(|error| format!("the overlay has no window handle: {error}"))?;
    let RawWindowHandle::Win32(win32) = handle.as_raw() else {
        return Err("the overlay is not a Win32 window".to_owned());
    };
    // SAFETY: `hwnd` is the live window GPUI created; the borrowed `handle`
    // keeps it open for this call. winsafe's HWND does not close or destroy
    // the window when dropped.
    let hwnd = unsafe { w::HWND::from_ptr(win32.hwnd.get() as *mut std::ffi::c_void) };
    let wanted = co::WS_EX::LAYERED | co::WS_EX::TRANSPARENT | co::WS_EX::NOACTIVATE;
    hwnd.set_style_ex(hwnd.style_ex() | wanted);
    // A layered window draws nothing until its attributes are set. Fully
    // opaque: GPUI's transparent background is what shows the game.
    hwnd.SetLayeredWindowAttributes(w::COLORREF::from_rgb(0, 0, 0), u8::MAX, co::LWA::ALPHA)
        .map_err(|error| format!("SetLayeredWindowAttributes failed: {error}"))?;
    hwnd.SetWindowPos(
        w::HwndPlace::Place(co::HWND_PLACE::TOPMOST),
        w::POINT::default(),
        w::SIZE::default(),
        co::SWP::NOMOVE | co::SWP::NOSIZE | co::SWP::NOACTIVATE | co::SWP::FRAMECHANGED,
    )
    .map_err(|error| format!("SetWindowPos(HWND_TOPMOST) failed: {error}"))?;
    // `has` is true for any shared bit, so check each style on its own.
    let kept = hwnd.style_ex();
    if [
        co::WS_EX::LAYERED,
        co::WS_EX::TRANSPARENT,
        co::WS_EX::NOACTIVATE,
    ]
    .into_iter()
    .all(|style| kept.has(style))
    {
        Ok(format!(
            "extended styles {:#010x} (layered, transparent, no-activate, topmost)",
            kept.raw()
        ))
    } else {
        Err("Windows did not keep the overlay's click-through styles".to_owned())
    }
}
