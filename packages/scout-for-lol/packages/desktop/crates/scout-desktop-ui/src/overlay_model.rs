//! What the in-game overlay draws, and where, from the supervisor's frame.
//!
//! Toolkit-free, so Linux CI tests it: the overlay window (`overlay.rs`) only
//! lays this model out.

use scout_desktop_ipc::OverlayFrame;
use scout_overlay::geometry::{self, Anchor, GeometryError, HudRegions, Rect, ScreenRect};
use scout_overlay::{CardKind, CardPriority};

/// The overlay window's size in logical pixels. The card is drawn at its top
/// and is only as tall as its content; the rest is transparent and lets
/// clicks through like the card does. The height fits the longest card the
/// contract allows, expanded (about 620 on macOS); `tests/render_overlay.rs`
/// renders that card and fails if it reaches the bottom.
pub const WINDOW_SIZE: (u32, u32) = (360, 660);

/// Lines a collapsed card shows; expanding shows all of them.
pub const COLLAPSED_LINES: usize = 2;

/// The heading over a proactive card: who started it.
pub const PROACTIVE_NOTE: &str = "Scout raised this on its own. You did not ask. Beta only.";

/// How a card's badge reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardTone {
    /// Scout's ordinary advice.
    Advice,
    /// Something Scout started on its own; drawn apart from advice.
    Unprompted,
    /// A low-key status line.
    Quiet,
}

/// One card, ready to lay out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlayCardModel {
    /// The small label above the title, by kind; none when it would only
    /// repeat the title.
    pub badge: Option<&'static str>,
    /// How the badge reads.
    pub tone: CardTone,
    /// The card's title.
    pub title: String,
    /// The lines shown now.
    pub lines: Vec<String>,
    /// Who started it, when the player did not.
    pub note: Option<&'static str>,
    /// The key hint under the card, naming only keys that do something now.
    pub hint: String,
}

impl OverlayCardModel {
    /// The model for `frame`.
    #[must_use]
    pub fn new(frame: &OverlayFrame) -> Self {
        let card = &frame.card;
        let (badge, tone, note) = match card.kind {
            CardKind::PregamePlan => ("Game plan", CardTone::Advice, None),
            CardKind::Answer => ("Answer", CardTone::Advice, None),
            CardKind::Status => ("Scout", CardTone::Quiet, None),
            CardKind::Proactive => ("Scout noticed", CardTone::Unprompted, Some(PROACTIVE_NOTE)),
            CardKind::ReviewReady => ("Review ready", CardTone::Advice, None),
        };
        let tone = if card.priority == CardPriority::Low && tone == CardTone::Advice {
            CardTone::Quiet
        } else {
            tone
        };
        let hidden = card.lines.len().saturating_sub(COLLAPSED_LINES);
        let lines = if frame.expanded {
            card.lines.clone()
        } else {
            card.lines.iter().take(COLLAPSED_LINES).cloned().collect()
        };
        let mut hint = vec![format!("{} dismiss", frame.keys.dismiss)];
        if frame.queued > 1 {
            hint.push(format!(
                "{} next ({} more)",
                frame.keys.next,
                frame.queued - 1
            ));
        }
        if card.kind == CardKind::ReviewReady {
            // The supervisor opens the review on this card's expand key.
            hint.push(format!("{} open", frame.keys.expand));
        } else if frame.expanded && hidden > 0 {
            hint.push(format!("{} less", frame.keys.expand));
        } else if hidden > 0 {
            hint.push(format!("{} {hidden} more lines", frame.keys.expand));
        }
        // "Scout noticed" over a card titled "Scout noticed" says nothing new.
        let badge = (!badge.eq_ignore_ascii_case(card.title.trim())).then_some(badge);
        Self {
            badge,
            tone,
            title: card.title.clone(),
            lines,
            note,
            hint: hint.join("  \u{b7}  "),
        }
    }
}

/// The size of an ordinary card, which placement keeps clear of the HUD.
pub const CARD_SIZE: (u32, u32) = (360, 280);

/// Where the overlay window goes on a display of `display` logical bounds.
///
/// An ordinary card is placed at the middle of the left edge, clear of
/// League's default HUD, inside the safe area, and the window extends below
/// it to [`WINDOW_SIZE`] so a long expanded card still fits. Where the safe
/// area ends first, the window moves up just enough, and on a display shorter
/// than the window it fills the safe area's height.
///
/// # Errors
/// [`GeometryError`] for an empty display.
pub fn window_bounds(display: Rect) -> Result<Rect, GeometryError> {
    let screen = ScreenRect {
        rect: display,
        // GPUI bounds are already in logical pixels.
        scale_percent: 100,
    };
    let card = geometry::place(
        &screen,
        CARD_SIZE,
        Anchor::MiddleLeft,
        &HudRegions::league_default(),
    )?
    .rect;
    let safe = geometry::safe_area(&screen)?;
    let height = i32::try_from(WINDOW_SIZE.1)
        .unwrap_or(i32::MAX)
        .min(safe.height);
    Ok(Rect {
        x: card.x,
        y: card.y.min(safe.bottom() - height).max(safe.y),
        width: card.width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use scout_desktop_ipc::{OverlayFrame, OverlayKeys};
    use scout_overlay::{CardKind, CardPriority, OverlayCard};

    use super::*;

    fn frame(kind: CardKind, lines: usize, expanded: bool, queued: u32) -> OverlayFrame {
        OverlayFrame {
            card: OverlayCard {
                id: "c".to_owned(),
                kind,
                title: "Title".to_owned(),
                lines: (1..=lines).map(|n| format!("line {n}")).collect(),
                priority: CardPriority::Normal,
                ttl_secs: 60,
            },
            expanded,
            queued,
            keys: OverlayKeys {
                dismiss: "F7".to_owned(),
                next: "Shift+F7".to_owned(),
                expand: "Alt+F7".to_owned(),
            },
        }
    }

    #[test]
    fn a_collapsed_card_shows_two_lines_and_offers_the_rest() {
        let model = OverlayCardModel::new(&frame(CardKind::PregamePlan, 4, false, 1));
        assert_eq!(model.badge, Some("Game plan"));
        assert_eq!(model.lines, ["line 1", "line 2"]);
        assert_eq!(model.hint, "F7 dismiss  \u{b7}  Alt+F7 2 more lines");
    }

    #[test]
    fn an_expanded_card_shows_every_line() {
        let model = OverlayCardModel::new(&frame(CardKind::Answer, 4, true, 3));
        assert_eq!(model.lines.len(), 4);
        assert_eq!(
            model.hint,
            "F7 dismiss  \u{b7}  Shift+F7 next (2 more)  \u{b7}  Alt+F7 less"
        );
    }

    #[test]
    fn a_short_card_names_only_dismiss() {
        let model = OverlayCardModel::new(&frame(CardKind::Status, 1, false, 1));
        assert_eq!(model.hint, "F7 dismiss");
        assert_eq!(model.tone, CardTone::Quiet);
    }

    #[test]
    fn a_review_card_names_the_key_that_opens_it() {
        let model = OverlayCardModel::new(&frame(CardKind::ReviewReady, 1, false, 1));
        assert_eq!(model.badge, Some("Review ready"));
        assert_eq!(model.hint, "F7 dismiss  \u{b7}  Alt+F7 open");
    }

    #[test]
    fn a_proactive_card_says_the_player_did_not_ask() {
        let model = OverlayCardModel::new(&frame(CardKind::Proactive, 1, false, 1));
        assert_eq!(model.badge, Some("Scout noticed"));
        assert_eq!(model.tone, CardTone::Unprompted);
        assert_eq!(model.note, Some(PROACTIVE_NOTE));
    }

    #[test]
    fn a_badge_that_repeats_the_title_is_dropped() {
        let mut noticed = frame(CardKind::Proactive, 1, false, 1);
        "Scout noticed".clone_into(&mut noticed.card.title);
        let model = OverlayCardModel::new(&noticed);
        assert_eq!(model.badge, None);
        assert_eq!(
            model.note,
            Some(PROACTIVE_NOTE),
            "who started it still shows"
        );
    }

    #[test]
    fn the_window_sits_mid_left_inside_the_display() -> Result<(), GeometryError> {
        let display = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let bounds = window_bounds(display)?;
        assert_eq!((bounds.width, bounds.height), (360, 660));
        assert!(display.contains(&bounds));
        assert!(bounds.x < 100, "{bounds:?}");
        // The card at the window's top sits mid-left, as an ordinary card
        // placed alone would.
        assert!(bounds.y > 300 && bounds.y < 450, "{bounds:?}");
        Ok(())
    }

    #[test]
    fn a_short_display_moves_the_window_up_or_shrinks_it() -> Result<(), GeometryError> {
        let short = Rect {
            x: 0,
            y: 0,
            width: 1024,
            height: 768,
        };
        let bounds = window_bounds(short)?;
        assert_eq!(bounds.height, 660);
        assert!(short.contains(&bounds), "{bounds:?}");
        let tiny = Rect {
            x: 0,
            y: 0,
            width: 800,
            height: 480,
        };
        let bounds = window_bounds(tiny)?;
        assert!(bounds.height < 480 && tiny.contains(&bounds), "{bounds:?}");
        Ok(())
    }

    #[test]
    fn an_empty_display_has_no_place() {
        let empty = Rect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
        assert_eq!(window_bounds(empty), Err(GeometryError::EmptyScreen));
    }
}
