//! macOS: `NSWindow.ignoresMouseEvents`, and a window that cannot become key.
//!
//! GPUI's `WindowKind::PopUp` is a non-activating `NSPanel` at the pop-up
//! window level, joined to every Space and allowed beside fullscreen apps, so
//! it already stays on top. Ignoring mouse events sends every click, scroll
//! and hover to the window beneath, and the window casts no shadow, which
//! would outline its transparent frame. GPUI's window classes answer YES to
//! `canBecomeKeyWindow`, so the overlay's window is moved to a subclass that
//! answers NO to it and to `canBecomeMainWindow`: nothing can make it take the
//! keyboard from the game. The overlay process has only this one window.

#![expect(
    unsafe_code,
    reason = "a raw AppKit view becomes an NSView, and the overlay's window moves to a never-key subclass, here and only here"
)]

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::sel;
use objc2_app_kit::{NSView, NSWindow};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// The subclass the overlay's window becomes.
const NEVER_KEY_CLASS: &std::ffi::CStr = c"ScoutOverlayNeverKeyWindow";

extern "C" fn answer_no(_window: &NSWindow, _selector: Sel) -> Bool {
    Bool::NO
}

/// A subclass of `superclass` that can become neither key nor main.
fn never_key_class(superclass: &AnyClass) -> Result<&'static AnyClass, String> {
    if let Some(existing) = AnyClass::get(NEVER_KEY_CLASS) {
        return Ok(existing);
    }
    let mut builder = ClassBuilder::new(NEVER_KEY_CLASS, superclass)
        .ok_or_else(|| "could not declare the overlay's window class".to_owned())?;
    // SAFETY: both selectors take no arguments and return BOOL, which is the
    // signature `answer_no` has.
    unsafe {
        builder.add_method(
            sel!(canBecomeKeyWindow),
            answer_no as extern "C" fn(_, _) -> _,
        );
        builder.add_method(
            sel!(canBecomeMainWindow),
            answer_no as extern "C" fn(_, _) -> _,
        );
    }
    Ok(builder.register())
}

pub(super) fn make_click_through(window: &impl HasWindowHandle) -> Result<String, String> {
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
    let object: &AnyObject = ns_window.as_ref();
    let subclass = never_key_class(object.class())?;
    // SAFETY: the subclass adds two methods and no instance variables, so
    // the window's layout is unchanged; it only answers NO where GPUI's class
    // answers YES.
    unsafe {
        AnyObject::set_class(object, subclass);
    }
    ns_window.setIgnoresMouseEvents(true);
    // A transparent window's shadow outlines its whole frame over the game.
    ns_window.setHasShadow(false);
    let probe = format!(
        "ignoresMouseEvents={} level={} canBecomeKey={} canBecomeMain={} frame=({:.0},{:.0} {:.0}x{:.0})",
        ns_window.ignoresMouseEvents(),
        ns_window.level(),
        ns_window.canBecomeKeyWindow(),
        ns_window.canBecomeMainWindow(),
        ns_window.frame().origin.x,
        ns_window.frame().origin.y,
        ns_window.frame().size.width,
        ns_window.frame().size.height,
    );
    if ns_window.ignoresMouseEvents() && !ns_window.canBecomeKeyWindow() {
        Ok(probe)
    } else {
        Err(format!("macOS did not keep the overlay's styles: {probe}"))
    }
}
