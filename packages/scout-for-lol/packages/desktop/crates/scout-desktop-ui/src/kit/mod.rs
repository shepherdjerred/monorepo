//! The only module that names `gpui_kit`.
//!
//! gpui-kit pins a pre-1.0 GPUI snapshot and ships weekly, so its API is
//! expected to move. Everything else in this crate uses the Scout-named
//! components, the theme, and the few lifecycle calls below, and the
//! [`prelude`] of GPUI types a view needs to name. An upgrade that changes
//! gpui-kit's API should only have to touch this directory.

mod components;
mod theme;

use gpui_kit::{
    AppContext as _, Bounds, ClipboardItem, QuitMode, Render, TitlebarOptions, WindowBounds,
    WindowOptions, px, size,
};

pub use components::{
    ButtonStyle, Handler, KeyValueTable, MonoLine, NavItem, Page, ScoutButton, ScoutToggle,
    ScrollLog, Shell, StatusRow, action_row, body_text, error_notice, note_text, section_heading,
};

/// The GPUI types a view names, re-exported so views never import gpui-kit.
pub mod prelude {
    pub use gpui_kit::{App, Context, IntoElement, ParentElement, Render, Task, Window};
}

use prelude::{App, Context, Window};

/// Start the GPUI application and call `open` once it is running. Returns
/// when the application quits, on platforms where quitting returns.
pub fn run_application(open: impl FnOnce(&mut App) + 'static) {
    gpui_kit::application()
        // The window decides when to quit, so a broken link can exit with a
        // crash status first.
        .with_quit_mode(QuitMode::Explicit)
        .run(move |cx| {
            prepare(cx);
            open(cx);
        });
}

/// Initialize gpui-kit and install the Scout theme.
pub fn prepare(cx: &mut App) {
    gpui_kit::init(cx);
    theme::apply_theme(cx);
}

/// Open the Scout window, sized like the egui window, with `build` as its
/// content.
///
/// # Errors
/// A description when the platform cannot open a window.
pub fn open_main_window<V: Render>(
    cx: &mut App,
    title: &str,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V + 'static,
) -> Result<(), String> {
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(760.), px(520.)),
            cx,
        ))),
        window_min_size: Some(size(px(620.), px(420.))),
        titlebar: Some(TitlebarOptions {
            title: Some(title.to_owned().into()),
            ..TitlebarOptions::default()
        }),
        app_id: Some("com.scout-for-lol.client".to_owned()),
        ..WindowOptions::default()
    };
    gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| build(window, cx)))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Call `on_closed` after any window closes.
pub fn on_window_closed(cx: &mut App, mut on_closed: impl FnMut(&mut App) + 'static) {
    cx.on_window_closed(move |cx, _| on_closed(cx)).detach();
}

/// Run `before_close` when the user asks to close `window`; the window then
/// closes.
pub fn on_close_requested(
    window: &Window,
    cx: &App,
    before_close: impl Fn(&mut Window, &mut App) + 'static,
) {
    window.on_window_should_close(cx, move |window, cx| {
        before_close(window, cx);
        true
    });
}

/// Put `text` on the system clipboard.
pub fn copy_to_clipboard(cx: &mut App, text: String) {
    cx.write_to_clipboard(ClipboardItem::new_string(text));
}

/// Bring `window` to the front.
pub fn bring_to_front(window: &Window) {
    window.activate_window();
}

/// Close `window`.
pub fn close_window(window: &mut Window) {
    window.remove_window();
}

/// Quit the application.
pub fn quit(cx: &App) {
    cx.quit();
}
