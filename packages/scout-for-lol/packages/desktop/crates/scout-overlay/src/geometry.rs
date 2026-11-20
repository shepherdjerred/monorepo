//! Where the overlay puts a card: anchor, safe area, HUD avoidance, and DPI.
//!
//! All coordinates are physical pixels with the origin at the top left.

use thiserror::Error;

/// An axis-aligned rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    /// Left edge.
    pub x: i32,
    /// Top edge.
    pub y: i32,
    /// Width.
    pub width: i32,
    /// Height.
    pub height: i32,
}

impl Rect {
    /// The right edge, exclusive.
    #[must_use]
    pub const fn right(&self) -> i32 {
        self.x + self.width
    }

    /// The bottom edge, exclusive.
    #[must_use]
    pub const fn bottom(&self) -> i32 {
        self.y + self.height
    }

    /// The area both rectangles cover.
    #[must_use]
    pub fn overlap_area(&self, other: &Self) -> i64 {
        let width = i64::from(self.right().min(other.right()) - self.x.max(other.x));
        let height = i64::from(self.bottom().min(other.bottom()) - self.y.max(other.y));
        if width <= 0 || height <= 0 {
            0
        } else {
            width * height
        }
    }

    /// Whether `other` lies entirely inside this rectangle.
    #[must_use]
    pub const fn contains(&self, other: &Self) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.right() <= self.right()
            && other.bottom() <= self.bottom()
    }
}

/// The game's screen: its rectangle and the DPI scale of its monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenRect {
    /// The game window or monitor rectangle.
    pub rect: Rect,
    /// DPI scale in percent, as Windows reports it: `100` is 96 DPI, `150`
    /// is 144.
    pub scale_percent: u32,
}

/// A place on the screen's edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    /// Top-left corner.
    TopLeft,
    /// Top edge, centered.
    TopCenter,
    /// Top-right corner.
    TopRight,
    /// Left edge, centered.
    MiddleLeft,
    /// Right edge, centered.
    MiddleRight,
    /// Bottom-left corner.
    BottomLeft,
    /// Bottom-right corner.
    BottomRight,
}

/// Anchors in the order they are tried after the preferred one.
const FALLBACK_ORDER: [Anchor; 7] = [
    Anchor::MiddleLeft,
    Anchor::TopLeft,
    Anchor::MiddleRight,
    Anchor::TopRight,
    Anchor::TopCenter,
    Anchor::BottomLeft,
    Anchor::BottomRight,
];

/// The parts of League's HUD a card should not cover, as thousandths of the
/// screen: `(left, top, right, bottom)`, each in `0..=1000`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HudRegions {
    /// The regions.
    pub regions: Vec<(u16, u16, u16, u16)>,
}

impl HudRegions {
    /// League's default in-game HUD: the ability bar and items along the
    /// bottom center, the minimap at the bottom right, the chat at the bottom
    /// left, and the score and ping readout at the top right.
    #[must_use]
    pub fn league_default() -> Self {
        Self {
            regions: vec![
                (270, 840, 730, 1000),
                (820, 680, 1000, 1000),
                (0, 760, 270, 1000),
                (860, 0, 1000, 50),
            ],
        }
    }

    fn rects(&self, screen: Rect) -> Vec<Rect> {
        self.regions
            .iter()
            .map(|&(left, top, right, bottom)| {
                let x0 = permille(screen.width, left);
                let x1 = permille(screen.width, right);
                let y0 = permille(screen.height, top);
                let y1 = permille(screen.height, bottom);
                Rect {
                    x: screen.x + x0,
                    y: screen.y + y0,
                    width: (x1 - x0).max(0),
                    height: (y1 - y0).max(0),
                }
            })
            .collect()
    }
}

/// Where a card goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    /// The card's rectangle.
    pub rect: Rect,
    /// The anchor it landed on.
    pub anchor: Anchor,
    /// Whether it avoids every HUD region.
    pub clear_of_hud: bool,
}

/// An input geometry cannot place.
#[derive(Debug, Error, PartialEq)]
pub enum GeometryError {
    /// The screen has no area.
    #[error("the screen rectangle is empty")]
    EmptyScreen,
    /// The scale is zero.
    #[error("the DPI scale is zero")]
    BadScale,
    /// The card has no area.
    #[error("the card size is empty")]
    EmptyCard,
}

/// Thousandths of each screen dimension kept free at the edges.
const SAFE_MARGIN_PERMILLE: u16 = 20;

/// `value * thousandths / 1000`, rounded to nearest, past `i32` saturating.
fn permille(value: i32, thousandths: u16) -> i32 {
    let product = i64::from(value) * i64::from(thousandths.min(1000));
    i32::try_from((product + 500).div_euclid(1000)).unwrap_or(i32::MAX)
}

/// `value * percent / 100`, rounded to nearest, past `i32` saturating.
fn percent_of(value: u32, percent: u32) -> i32 {
    let product = u64::from(value) * u64::from(percent);
    i32::try_from((product + 50) / 100).unwrap_or(i32::MAX)
}

/// The screen inset by the safe margin on every edge.
///
/// # Errors
/// [`GeometryError::EmptyScreen`] or [`GeometryError::BadScale`].
pub fn safe_area(screen: &ScreenRect) -> Result<Rect, GeometryError> {
    if screen.rect.width <= 0 || screen.rect.height <= 0 {
        return Err(GeometryError::EmptyScreen);
    }
    if screen.scale_percent == 0 {
        return Err(GeometryError::BadScale);
    }
    let inset_x = permille(screen.rect.width, SAFE_MARGIN_PERMILLE);
    let inset_y = permille(screen.rect.height, SAFE_MARGIN_PERMILLE);
    Ok(Rect {
        x: screen.rect.x + inset_x,
        y: screen.rect.y + inset_y,
        width: (screen.rect.width - 2 * inset_x).max(1),
        height: (screen.rect.height - 2 * inset_y).max(1),
    })
}

const fn at(anchor: Anchor, safe: Rect, width: i32, height: i32) -> Rect {
    let left = safe.x;
    let center_x = safe.x + (safe.width - width) / 2;
    let right = safe.right() - width;
    let top = safe.y;
    let middle_y = safe.y + (safe.height - height) / 2;
    let bottom = safe.bottom() - height;
    let (x, y) = match anchor {
        Anchor::TopLeft => (left, top),
        Anchor::TopCenter => (center_x, top),
        Anchor::TopRight => (right, top),
        Anchor::MiddleLeft => (left, middle_y),
        Anchor::MiddleRight => (right, middle_y),
        Anchor::BottomLeft => (left, bottom),
        Anchor::BottomRight => (right, bottom),
    };
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// Place a card of `logical_size` (width, height in device-independent
/// pixels) on the screen.
///
/// The card is scaled by the DPI factor, clamped to the safe area, and put on
/// the first anchor, starting with `preferred`, that avoids every HUD region;
/// when none does, on the one that covers the least of the HUD. The result is
/// always inside the safe area.
///
/// # Errors
/// [`GeometryError`] for an empty screen or card, or a bad scale.
pub fn place(
    screen: &ScreenRect,
    logical_size: (u32, u32),
    preferred: Anchor,
    hud: &HudRegions,
) -> Result<Placement, GeometryError> {
    let safe = safe_area(screen)?;
    if logical_size.0 == 0 || logical_size.1 == 0 {
        return Err(GeometryError::EmptyCard);
    }
    let physical =
        |logical: u32, limit: i32| percent_of(logical, screen.scale_percent).clamp(1, limit);
    let width = physical(logical_size.0, safe.width);
    let height = physical(logical_size.1, safe.height);
    let hud_rects = hud.rects(screen.rect);

    let order =
        std::iter::once(preferred).chain(FALLBACK_ORDER.into_iter().filter(|a| *a != preferred));
    let mut best: Option<(Placement, i64)> = None;
    for anchor in order {
        let rect = at(anchor, safe, width, height);
        let covered: i64 = hud_rects
            .iter()
            .map(|region| rect.overlap_area(region))
            .sum();
        let candidate = Placement {
            rect,
            anchor,
            clear_of_hud: covered == 0,
        };
        if covered == 0 {
            return Ok(candidate);
        }
        if best.is_none_or(|(_, least)| covered < least) {
            best = Some((candidate, covered));
        }
    }
    best.map(|(placement, _)| placement)
        .ok_or(GeometryError::EmptyCard)
}

#[cfg(test)]
mod tests {
    use super::*;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const fn screen(width: i32, height: i32, scale_percent: u32) -> ScreenRect {
        ScreenRect {
            rect: Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            scale_percent,
        }
    }

    #[test]
    fn the_preferred_anchor_wins_when_it_clears_the_hud() -> TestResult {
        let placement = place(
            &screen(1920, 1080, 100),
            (320, 160),
            Anchor::MiddleLeft,
            &HudRegions::league_default(),
        )?;
        assert_eq!(placement.anchor, Anchor::MiddleLeft);
        assert!(placement.clear_of_hud);
        assert_eq!(
            placement.rect,
            Rect {
                x: 38,
                y: 460,
                width: 320,
                height: 160
            }
        );
        Ok(())
    }

    #[test]
    fn a_blocked_anchor_falls_back_in_order() -> TestResult {
        let placement = place(
            &screen(1920, 1080, 100),
            (320, 160),
            Anchor::BottomRight,
            &HudRegions::league_default(),
        )?;
        assert_eq!(placement.anchor, Anchor::MiddleLeft);
        assert!(placement.clear_of_hud);
        Ok(())
    }

    #[test]
    fn dpi_scales_the_card() -> TestResult {
        let placement = place(
            &screen(3840, 2160, 200),
            (320, 160),
            Anchor::TopLeft,
            &HudRegions::league_default(),
        )?;
        assert_eq!((placement.rect.width, placement.rect.height), (640, 320));
        Ok(())
    }

    #[test]
    fn a_card_larger_than_the_screen_is_clamped_to_the_safe_area() -> TestResult {
        let screen = screen(800, 600, 300);
        let placement = place(
            &screen,
            (5000, 5000),
            Anchor::TopLeft,
            &HudRegions::league_default(),
        )?;
        assert_eq!(placement.rect, safe_area(&screen)?);
        Ok(())
    }

    #[test]
    fn a_hud_covering_everything_picks_the_least_covered_anchor() -> TestResult {
        let hud = HudRegions {
            regions: vec![(0, 0, 1000, 1000)],
        };
        let placement = place(&screen(1000, 1000, 100), (100, 100), Anchor::TopLeft, &hud)?;
        assert!(!placement.clear_of_hud);
        assert_eq!(placement.anchor, Anchor::TopLeft);
        Ok(())
    }

    #[test]
    fn a_screen_offset_moves_the_placement() -> TestResult {
        let mut offset = screen(1920, 1080, 100);
        offset.rect.x = 1920;
        let placement = place(
            &offset,
            (320, 160),
            Anchor::MiddleLeft,
            &HudRegions::league_default(),
        )?;
        assert_eq!(placement.rect.x, 1920 + 38);
        Ok(())
    }

    #[test]
    fn bad_inputs_are_refused() {
        let hud = HudRegions::league_default();
        assert_eq!(
            place(&screen(0, 100, 100), (1, 1), Anchor::TopLeft, &hud),
            Err(GeometryError::EmptyScreen)
        );
        assert_eq!(
            place(&screen(100, 100, 0), (1, 1), Anchor::TopLeft, &hud),
            Err(GeometryError::BadScale)
        );
        assert_eq!(
            place(&screen(100, 100, 100), (0, 1), Anchor::TopLeft, &hud),
            Err(GeometryError::EmptyCard)
        );
    }

    #[test]
    fn placements_stay_in_the_safe_area_for_seeded_random_inputs() -> TestResult {
        let anchors = [
            Anchor::TopLeft,
            Anchor::TopCenter,
            Anchor::TopRight,
            Anchor::MiddleLeft,
            Anchor::MiddleRight,
            Anchor::BottomLeft,
            Anchor::BottomRight,
        ];
        let hud = HudRegions::league_default();
        let mut rng = fastrand::Rng::with_seed(0x5C07);
        for _ in 0..2000 {
            let screen = ScreenRect {
                rect: Rect {
                    x: rng.i32(-4000..4000),
                    y: rng.i32(-4000..4000),
                    width: rng.i32(64..7680),
                    height: rng.i32(64..4320),
                },
                scale_percent: rng.u32(25..=400),
            };
            let card = (rng.u32(1..4000), rng.u32(1..4000));
            let anchor = anchors[rng.usize(0..anchors.len())];
            let placement = place(&screen, card, anchor, &hud)?;
            let safe = safe_area(&screen)?;
            assert!(
                safe.contains(&placement.rect),
                "{screen:?} {card:?} {placement:?}"
            );
            assert!(placement.rect.width >= 1 && placement.rect.height >= 1);
            assert_eq!(place(&screen, card, anchor, &hud)?, placement);
        }
        Ok(())
    }
}
