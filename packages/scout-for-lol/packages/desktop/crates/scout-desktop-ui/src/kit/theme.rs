//! Projects the generated Scout tokens onto gpui-kit's component theme.

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::{App, Hsla, Pixels, px, rgba};

use crate::tokens::{MODERN_DARK, ThemeTokens};

/// The theme the window renders. The egui window is dark, so this is
/// `modern-dark`; theme choice is a later settings change.
#[must_use]
pub const fn theme() -> &'static ThemeTokens {
    &MODERN_DARK
}

/// A token color as GPUI's color type.
#[must_use]
pub fn color(token: u32) -> Hsla {
    rgba(token).into()
}

/// A token length as GPUI pixels.
#[must_use]
pub fn length(token: u16) -> Pixels {
    px(f32::from(token))
}

/// Install [`theme`] as gpui-kit's global theme. Fonts stay the system UI
/// font and the platform monospace font: bundling Beaufort, Spiegel or
/// Berkeley Mono waits on a licensing decision.
pub fn apply_theme(cx: &mut App) {
    let tokens = theme();
    Theme::change(ThemeMode::Dark, None, cx);
    Theme::update(cx, |theme| {
        let c = &mut theme.colors;
        let hover = |token: u32| color(token).opacity(0.85);

        c.background = color(tokens.canvas);
        c.foreground = color(tokens.text);
        c.border = color(tokens.border);
        c.input = color(tokens.border);
        c.ring = color(tokens.focus);
        c.caret = color(tokens.focus);
        c.selection = color(tokens.focus).opacity(0.35);
        c.muted = color(tokens.surface_raised);
        c.muted_foreground = color(tokens.text_muted);
        c.overlay = color(tokens.overlay);
        c.popover = color(tokens.surface_raised);
        c.popover_foreground = color(tokens.text);
        c.accent = color(tokens.interactive_hover);
        c.accent_foreground = color(tokens.text);

        c.primary = color(tokens.primary);
        c.primary_foreground = color(tokens.primary_text);
        c.primary_hover = hover(tokens.primary);
        c.primary_active = color(tokens.primary);
        c.button_primary = color(tokens.primary);
        c.button_primary_foreground = color(tokens.primary_text);
        c.button_primary_hover = hover(tokens.primary);
        c.button_primary_active = color(tokens.primary);

        c.secondary = color(tokens.surface_raised);
        c.secondary_foreground = color(tokens.text);
        c.secondary_hover = color(tokens.interactive_hover);
        c.secondary_active = color(tokens.interactive_active);
        c.button = color(tokens.surface_raised);
        c.button_foreground = color(tokens.text);
        c.button_hover = color(tokens.interactive_hover);
        c.button_active = color(tokens.interactive_active);
        c.button_secondary = color(tokens.surface_raised);
        c.button_secondary_foreground = color(tokens.text);
        c.button_secondary_hover = color(tokens.interactive_hover);
        c.button_secondary_active = color(tokens.interactive_active);

        c.danger = color(tokens.danger);
        c.danger_foreground = color(tokens.danger_text);
        c.danger_hover = hover(tokens.danger);
        c.danger_active = color(tokens.danger);
        c.button_danger = color(tokens.danger);
        c.button_danger_foreground = color(tokens.danger_text);
        c.button_danger_hover = hover(tokens.danger);
        c.button_danger_active = color(tokens.danger);

        c.success = color(tokens.success);
        c.success_foreground = color(tokens.success_text);
        c.success_hover = hover(tokens.success);
        c.success_active = color(tokens.success);
        c.warning = color(tokens.warning);
        c.warning_foreground = color(tokens.warning_text);
        c.warning_hover = hover(tokens.warning);
        c.warning_active = color(tokens.warning);
        c.info = color(tokens.info);
        c.info_foreground = color(tokens.info_text);
        c.info_hover = hover(tokens.info);
        c.info_active = color(tokens.info);

        c.sidebar = color(tokens.surface);
        c.sidebar_foreground = color(tokens.text);
        c.sidebar_border = color(tokens.border);
        c.sidebar_accent = color(tokens.interactive_active);
        c.sidebar_accent_foreground = color(tokens.text);
        c.sidebar_primary = color(tokens.accent);
        c.sidebar_primary_foreground = color(tokens.accent_text);
        c.list = color(tokens.surface);
        c.list_even = color(tokens.surface_raised);
        c.list_head = color(tokens.surface_raised);
        c.list_hover = color(tokens.interactive_hover);
        c.list_active = color(tokens.interactive_active);
        c.list_active_border = color(tokens.accent);
        c.scrollbar = color(tokens.surface);
        c.scrollbar_thumb = color(tokens.interactive_active);
        c.scrollbar_thumb_hover = color(tokens.interactive_disabled);
        c.window_border = color(tokens.border);

        theme.radius = length(tokens.radius_small);
        theme.radius_lg = length(tokens.radius_large);
    });
}
