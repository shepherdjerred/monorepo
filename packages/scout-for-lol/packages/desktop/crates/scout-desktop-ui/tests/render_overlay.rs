//! Draws every overlay card kind offscreen through the overlay's real root
//! view, fed the same IPC lines the supervisor sends, with GPUI's Metal
//! renderer and the window's transparent background.
//!
//! The headless renderer has no window compositor, so the transparent window
//! background comes back as its clear color. Each frame must leave everything
//! below the card at exactly that color: nothing is drawn there, so the game
//! shows through. Set `SCOUT_DESKTOP_UI_CAPTURE_DIR` to also write one PNG per
//! card and a contact sheet of all of them over a checkerboard, with the clear
//! color made transparent again. macOS only, without the libtest harness,
//! because `AppKit` and Metal want the main thread.

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    render::run()
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("render_overlay: skipped; the offscreen renderer is macOS-only here");
}

#[cfg(target_os = "macos")]
mod render {
    use std::path::PathBuf;
    use std::sync::Arc;

    use gpui_kit::assets::Assets;
    use gpui_kit::{
        AnyWindowHandle, AppContext as _, Bounds, HeadlessAppContext, Point,
        WindowBackgroundAppearance, WindowBounds, WindowKind, WindowOptions, px, size,
    };
    use image::{Rgba, RgbaImage};
    use scout_desktop_ipc::{
        OverlayCommand, OverlayFrame, OverlayKeys, PROTOCOL_VERSION, encode_line,
    };
    use scout_desktop_ui::overlay_model::WINDOW_SIZE;
    use scout_desktop_ui::preview::{Incoming, OverlayWindow, prepare};
    use scout_overlay::{CardKind, CardPriority, OverlayCard};

    type Error = Box<dyn std::error::Error>;

    struct Harness {
        cx: HeadlessAppContext,
        window: AnyWindowHandle,
        supervisor: async_channel::Sender<Incoming>,
    }

    impl Harness {
        fn open() -> Result<Self, Error> {
            let mut cx = HeadlessAppContext::with_platform(
                gpui_kit::platform::current_platform(true).text_system(),
                Arc::new(Assets),
                gpui_kit::platform::current_headless_renderer,
            );
            cx.update(prepare);
            let (supervisor, receiver) = async_channel::unbounded();
            #[expect(clippy::cast_precision_loss, reason = "small whole pixel counts")]
            let (width, height) = (WINDOW_SIZE.0 as f32, WINDOW_SIZE.1 as f32);
            let window = cx.update(|cx| {
                cx.open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(width), px(height)),
                        })),
                        titlebar: None,
                        focus: false,
                        show: false,
                        kind: WindowKind::PopUp,
                        window_background: WindowBackgroundAppearance::Transparent,
                        ..WindowOptions::default()
                    },
                    |window, cx| cx.new(|cx| OverlayWindow::new(window, cx, receiver)),
                )
            })?;
            let mut harness = Self {
                cx,
                window: window.into(),
                supervisor,
            };
            harness.send(&OverlayCommand::Hello {
                protocol: PROTOCOL_VERSION,
            })?;
            Ok(harness)
        }

        fn send(&mut self, command: &OverlayCommand) -> Result<(), Error> {
            let line = encode_line(command)?;
            self.supervisor
                .send_blocking(Incoming::Line(line.trim_end().to_owned()))?;
            self.cx.run_until_parked();
            Ok(())
        }

        fn capture(&mut self) -> Result<RgbaImage, Error> {
            self.cx.advance_clock(std::time::Duration::from_secs(1));
            self.cx.run_until_parked();
            self.cx.update_window(self.window, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })?;
            Ok(self.cx.capture_screenshot(self.window)?)
        }
    }

    fn keys() -> OverlayKeys {
        OverlayKeys {
            dismiss: "F7".to_owned(),
            next: "Shift+F7".to_owned(),
            expand: "Alt+F7".to_owned(),
        }
    }

    fn card(kind: CardKind, title: &str, lines: &[&str], priority: CardPriority) -> OverlayCard {
        OverlayCard {
            id: format!("{kind:?}"),
            kind,
            title: title.to_owned(),
            lines: lines.iter().map(|line| (*line).to_owned()).collect(),
            priority,
            ttl_secs: 60,
        }
    }

    /// Every card kind, as the supervisor sends them, with a name for each.
    fn frames() -> Vec<(&'static str, OverlayFrame)> {
        let plan = [
            "Farm bot side until your first item",
            "Ward the river brush at 3:00",
            "Group for the first dragon at 5:00",
            "Their jungler starts top: track him",
        ];
        let frame = |card, expanded, queued| OverlayFrame {
            card,
            expanded,
            queued,
            keys: keys(),
        };
        vec![
            (
                "pregame-plan",
                frame(
                    card(
                        CardKind::PregamePlan,
                        "Your game plan",
                        &plan,
                        CardPriority::Normal,
                    ),
                    false,
                    2,
                ),
            ),
            (
                "pregame-plan-expanded",
                frame(
                    card(
                        CardKind::PregamePlan,
                        "Your game plan",
                        &plan,
                        CardPriority::Normal,
                    ),
                    true,
                    2,
                ),
            ),
            (
                "answer",
                frame(
                    card(
                        CardKind::Answer,
                        "What should I build next?",
                        &["Zhonya's Hourglass: Zed's ultimate is your biggest threat."],
                        CardPriority::High,
                    ),
                    false,
                    1,
                ),
            ),
            (
                "status",
                frame(
                    card(
                        CardKind::Status,
                        "Scout is thinking",
                        &["What should I build next?"],
                        CardPriority::Low,
                    ),
                    false,
                    1,
                ),
            ),
            (
                "proactive",
                frame(
                    card(
                        CardKind::Proactive,
                        "Scout noticed",
                        &[
                            "Their Jinx just finished Infinity Edge.",
                            "Build armor next.",
                        ],
                        CardPriority::Normal,
                    ),
                    false,
                    1,
                ),
            ),
            (
                "review-ready",
                frame(
                    card(
                        CardKind::ReviewReady,
                        "Your last game's review is ready",
                        &["Open it in Scout's main window."],
                        CardPriority::Normal,
                    ),
                    false,
                    1,
                ),
            ),
        ]
    }

    /// The card at the top draws; the bottom rows are the clear color.
    fn check(name: &str, image: &RgbaImage, clear: Rgba<u8>) -> Result<(), Error> {
        let drawn = image.pixels().filter(|pixel| **pixel != clear).count();
        if drawn < 1_000 {
            return Err(format!("{name}: almost nothing was drawn ({drawn} pixels)").into());
        }
        let bottom = image.height() - 2;
        if let Some(x) = (0..image.width()).find(|&x| *image.get_pixel(x, bottom) != clear) {
            return Err(
                format!("{name}: something is drawn below the card at ({x}, {bottom})").into(),
            );
        }
        Ok(())
    }

    /// `image` with the clear color made transparent.
    fn keyed(image: &RgbaImage, clear: Rgba<u8>) -> RgbaImage {
        let mut keyed = image.clone();
        for pixel in keyed.pixels_mut() {
            if *pixel == clear {
                *pixel = Rgba([0, 0, 0, 0]);
            }
        }
        keyed
    }

    /// All captures side by side over a checkerboard, three to a row.
    fn sheet(images: &[RgbaImage]) -> RgbaImage {
        let (width, height) = images
            .first()
            .map_or((1, 1), |image| (image.width(), image.height()));
        let columns = 3;
        let rows = u32::try_from(images.len().div_ceil(3)).unwrap_or(1);
        let mut sheet = RgbaImage::from_fn(width * columns, height * rows, |x, y| {
            if ((x / 24) + (y / 24)) % 2 == 0 {
                Rgba([92, 120, 88, 255])
            } else {
                Rgba([150, 170, 140, 255])
            }
        });
        for (index, image) in images.iter().enumerate() {
            let index = u32::try_from(index).unwrap_or(0);
            let (left, top) = ((index % columns) * width, (index / columns) * height);
            image::imageops::overlay(&mut sheet, image, i64::from(left), i64::from(top));
        }
        sheet
    }

    pub fn run() -> Result<(), Error> {
        let capture_dir = std::env::var_os("SCOUT_DESKTOP_UI_CAPTURE_DIR").map(PathBuf::from);
        let mut harness = Harness::open()?;
        // No card yet: the whole window is the clear color.
        let empty = harness.capture()?;
        let clear = *empty.get_pixel(0, 0);
        if empty.pixels().any(|pixel| *pixel != clear) {
            return Err("the overlay drew something before its first card".into());
        }
        let mut images = Vec::new();
        for (name, frame) in frames() {
            harness.send(&OverlayCommand::Frame { frame: Some(frame) })?;
            let image = harness.capture()?;
            check(name, &image, clear)?;
            println!(
                "render_overlay: {name} {}x{}",
                image.width(),
                image.height()
            );
            if let Some(directory) = &capture_dir {
                std::fs::create_dir_all(directory)?;
                keyed(&image, clear).save(directory.join(format!("overlay-{name}.png")))?;
            }
            images.push(keyed(&image, clear));
        }
        // Dismissing the last card draws nothing again.
        harness.send(&OverlayCommand::Frame { frame: None })?;
        if harness.capture()?.pixels().any(|pixel| *pixel != clear) {
            return Err("an empty frame drew something".into());
        }
        if let Some(directory) = &capture_dir {
            let path = directory.join("overlay-cards.png");
            sheet(&images).save(&path)?;
            println!("render_overlay: wrote {}", path.display());
        }
        Ok(())
    }
}
