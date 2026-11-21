//! The in-game overlay's window and card.
//!
//! The window is a GPUI pop-up: above other windows, never focused, no title
//! bar, a transparent background, and not movable or resizable. It opens
//! without gpui-kit's `Root`, which paints an opaque background and hosts
//! dialogs the overlay never shows. Click-through is the caller's job
//! (`crate::native`), done in the build closure while the window is new.

use gpui_kit::{
    ActivationPolicy, AppContext as _, Bounds, FontWeight, IntoElement, ParentElement as _, Render,
    Styled as _, WindowBackgroundAppearance, WindowBounds, WindowKind, WindowOptions, div, point,
    px, size,
};
use scout_overlay::Rect;

use super::prelude::{App, Context, Window};
use super::theme::{color, length, theme};
use crate::overlay_model::{CardTone, OverlayCardModel};

/// Keep the overlay out of the foreground UI: no Dock icon, no menu bar, and
/// never the active app, so starting it cannot take focus from the game. Only
/// macOS has this; elsewhere it does nothing.
pub fn stay_in_background(cx: &mut App) {
    cx.set_activation_policy(ActivationPolicy::Accessory);
}

/// The primary display's bounds in logical pixels, or none without a display.
#[must_use]
pub fn primary_display(cx: &App) -> Option<Rect> {
    let bounds = cx.primary_display()?.bounds();
    // Display coordinates are whole logical pixels; rounding drops nothing.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "display bounds are whole logical pixels far inside i32"
    )]
    let whole = |value: f32| value.round() as i32;
    Some(Rect {
        x: whole(f32::from(bounds.origin.x)),
        y: whole(f32::from(bounds.origin.y)),
        width: whole(f32::from(bounds.size.width)),
        height: whole(f32::from(bounds.size.height)),
    })
}

/// Open the overlay window at `bounds` (logical pixels) with `build` as its
/// root view.
///
/// # Errors
/// A description when the platform cannot open a window.
pub fn open_overlay_window<V: Render>(
    cx: &mut App,
    bounds: Rect,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V + 'static,
) -> Result<(), String> {
    #[expect(
        clippy::cast_precision_loss,
        reason = "overlay bounds are small whole pixel counts"
    )]
    let logical = |value: i32| px(value as f32);
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: point(logical(bounds.x), logical(bounds.y)),
            size: size(logical(bounds.width), logical(bounds.height)),
        })),
        titlebar: None,
        focus: false,
        show: true,
        kind: WindowKind::PopUp,
        is_movable: false,
        is_resizable: false,
        is_minimizable: false,
        window_background: WindowBackgroundAppearance::Transparent,
        app_id: Some("com.scout-for-lol.client.overlay".to_owned()),
        ..WindowOptions::default()
    };
    cx.open_window(options, |window, cx| cx.new(|cx| build(window, cx)))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// One card. Everything around it stays transparent.
#[must_use]
pub fn overlay_card(model: OverlayCardModel) -> impl IntoElement {
    let tokens = theme();
    let (badge_color, border) = match model.tone {
        CardTone::Advice => (tokens.primary, tokens.primary),
        CardTone::Unprompted => (tokens.warning, tokens.warning),
        CardTone::Quiet => (tokens.text_muted, tokens.border),
    };
    let mut card = div()
        .w_full()
        .flex()
        .flex_col()
        .gap_1()
        .p_3()
        .rounded(length(tokens.radius_large))
        .border(length(tokens.border_width))
        .border_color(color(border))
        // Readable over a bright game without hiding it.
        .bg(color(tokens.surface).opacity(0.9))
        .text_color(color(tokens.text))
        .child(
            div()
                .text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(color(badge_color))
                .child(model.badge),
        )
        .child(
            div()
                .text_base()
                .font_weight(FontWeight::SEMIBOLD)
                .child(model.title),
        )
        .children(
            model
                .lines
                .into_iter()
                .map(|line| div().text_sm().child(line)),
        );
    if let Some(note) = model.note {
        card = card.child(
            div()
                .text_xs()
                .text_color(color(tokens.text_muted))
                .child(note),
        );
    }
    card.child(
        div()
            .pt_1()
            .text_xs()
            .text_color(color(tokens.text_muted))
            .child(model.hint),
    )
}
