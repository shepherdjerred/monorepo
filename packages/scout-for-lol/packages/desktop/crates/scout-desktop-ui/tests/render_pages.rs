//! Drives the real window offscreen, with GPUI's Metal renderer: supervisor
//! messages go in as IPC lines, the navigation and the start-at-login
//! checkbox are clicked, and the commands that come out are decoded.
//!
//! Set `SCOUT_DESKTOP_UI_CAPTURE_DIR` to also write one PNG per page there; a
//! terminal without Screen Recording access cannot capture the live window.
//! Windows has no headless GPUI renderer, and Linux does not build the window,
//! so this runs on macOS only. It runs without the libtest harness because
//! `AppKit` and Metal want the main thread.

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    render::run()
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("render_pages: skipped; the offscreen renderer is macOS-only here");
}

#[cfg(target_os = "macos")]
mod render {
    use std::collections::HashSet;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, PoisonError};

    use gpui_kit::assets::Assets;
    use gpui_kit::{
        AnyWindowHandle, AppContext as _, Bounds, HeadlessAppContext, Modifiers, MouseButton,
        MouseDownEvent, MouseMoveEvent, MouseUpEvent, PlatformInput, Point, WindowBounds,
        WindowOptions, px, size,
    };
    use scout_desktop_ipc::{
        CounterReading, DiagnosticsSnapshot, GameflowPhase, PROTOCOL_VERSION, PrivacySnapshot,
        StateSnapshot, SupervisorMessage, WindowMessage, decode_line, encode_line,
    };
    use scout_desktop_ui::BuildInfo;
    use scout_desktop_ui::preview::{Incoming, Outbound, ScoutWindow, prepare};
    use scout_desktop_ui::view_model::PageId;

    type Error = Box<dyn std::error::Error>;

    /// What the window wrote to "stdout".
    #[derive(Clone, Default)]
    struct Captured(Arc<Mutex<Vec<u8>>>);

    impl Write for Captured {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Captured {
        fn messages(&self) -> Result<Vec<WindowMessage>, Error> {
            let bytes = self
                .0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            Ok(String::from_utf8(bytes)?
                .lines()
                .map(decode_line::<WindowMessage>)
                .collect::<Result<_, _>>()?)
        }
    }

    fn sample_state() -> StateSnapshot {
        StateSnapshot {
            league_connected: true,
            gameflow_phase: Some("ChampSelect".to_owned()),
            account_label: Some("Scout#NA1".to_owned()),
            paired: false,
            start_at_login: true,
            privacy: PrivacySnapshot {
                send_error_reports: true,
                send_usage_data: true,
            },
            pairing_status: Some("Waiting for approval in the browser".to_owned()),
            approval_url: Some("https://beta.scout-for-lol.com/pair/abc".to_owned()),
            pending_observations: 4,
            last_upload_at: Some("2026-11-11T10:00:00Z".to_owned()),
            last_error: Some("Scout API unavailable: connection refused".to_owned()),
            diagnostics: DiagnosticsSnapshot {
                log_folder_available: true,
                counters: vec![
                    CounterReading {
                        name: "observations_uploaded".to_owned(),
                        value: 12,
                    },
                    CounterReading {
                        name: "window_crash".to_owned(),
                        value: 1,
                    },
                ],
                recent_events: vec![
                    "info runtime start ok".to_owned(),
                    "warn upload upload_pending deferred".to_owned(),
                ],
            },
        }
    }

    struct Harness {
        cx: HeadlessAppContext,
        window: AnyWindowHandle,
        supervisor: async_channel::Sender<Incoming>,
        captured: Captured,
        capture_dir: Option<PathBuf>,
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
            let captured = Captured::default();
            let outbound = Outbound::new(captured.clone());
            let build = BuildInfo {
                client_version: env!("CARGO_PKG_VERSION"),
                protocol_version: 1,
            };
            let (window, _) = cx.update(|cx| {
                gpui_kit::open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(760.), px(520.)),
                        })),
                        focus: false,
                        show: false,
                        ..WindowOptions::default()
                    },
                    cx,
                    |window, cx| {
                        cx.new(|cx| ScoutWindow::new(window, cx, receiver, outbound, build))
                    },
                )
            })?;
            Ok(Self {
                cx,
                window,
                supervisor,
                captured,
                capture_dir: std::env::var_os("SCOUT_DESKTOP_UI_CAPTURE_DIR").map(PathBuf::from),
            })
        }

        /// Deliver one supervisor message as the stdin reader would.
        fn receive(&mut self, message: &SupervisorMessage) -> Result<(), Error> {
            let line = encode_line(message)?;
            self.supervisor
                .send_blocking(Incoming::Line(line.trim_end().to_owned()))?;
            self.cx.run_until_parked();
            Ok(())
        }

        fn click(&mut self, x: f32, y: f32) -> Result<(), Error> {
            let position = Point::new(px(x), px(y));
            let modifiers = Modifiers::default();
            for event in [
                PlatformInput::MouseMove(MouseMoveEvent {
                    position,
                    pressed_button: None,
                    modifiers,
                }),
                PlatformInput::MouseDown(MouseDownEvent {
                    button: MouseButton::Left,
                    position,
                    modifiers,
                    click_count: 1,
                    first_mouse: false,
                }),
                PlatformInput::MouseUp(MouseUpEvent {
                    button: MouseButton::Left,
                    position,
                    modifiers,
                    click_count: 1,
                }),
            ] {
                self.cx.update_window(self.window, |_, window, cx| {
                    window.dispatch_event(event, cx);
                })?;
            }
            self.cx.run_until_parked();
            Ok(())
        }

        /// Draw a frame and return its RGBA pixels.
        fn capture(&mut self, name: &str) -> Result<Vec<u8>, Error> {
            // Let component transitions (the checkbox's check mark) finish.
            self.cx.advance_clock(std::time::Duration::from_secs(1));
            self.cx.run_until_parked();
            self.cx.update_window(self.window, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
            })?;
            let image = self.cx.capture_screenshot(self.window)?;
            let colors = image.pixels().map(|pixel| pixel.0).collect::<HashSet<_>>();
            if colors.len() < 16 {
                return Err(
                    format!("{name} rendered only {} distinct colors", colors.len()).into(),
                );
            }
            if let Some(directory) = &self.capture_dir {
                std::fs::create_dir_all(directory)?;
                let path = directory.join(format!("{name}.png"));
                image.save(&path)?;
                println!("render_pages: wrote {}", path.display());
            }
            println!(
                "render_pages: {name} {}x{} with {} colors",
                image.width(),
                image.height(),
                colors.len()
            );
            Ok(image.into_raw())
        }
    }

    /// The centre of a navigation entry: the sidebar's 12 px padding, the
    /// brand line, then one 42 px row per page.
    fn navigation_point(page: PageId) -> Result<(f32, f32), Error> {
        let index = PageId::ALL
            .iter()
            .position(|candidate| *candidate == page)
            .ok_or("page is not in the navigation")?;
        let row = f32::from(u8::try_from(index)?);
        Ok((85., 76. + row * 42.))
    }

    /// The start-at-login checkbox on the Settings page.
    const START_AT_LOGIN: (f32, f32) = (202., 218.);

    pub fn run() -> Result<(), Error> {
        let mut harness = Harness::open()?;
        harness.receive(&SupervisorMessage::Hello {
            protocol: PROTOCOL_VERSION,
            tray_available: true,
        })?;
        harness.receive(&SupervisorMessage::State {
            state: sample_state(),
        })?;
        harness.receive(&SupervisorMessage::Phase {
            phase: GameflowPhase::ChampSelect,
        })?;

        for page in PageId::ALL {
            let (x, y) = navigation_point(page)?;
            harness.click(x, y)?;
            harness.capture(&page.label().to_lowercase())?;
        }

        // Settings: toggling start at login sends the opposite state, and
        // the supervisor's next snapshot is what unchecks the box.
        let (x, y) = navigation_point(PageId::Settings)?;
        harness.click(x, y)?;
        let before = harness.capture("settings")?;
        harness.click(START_AT_LOGIN.0, START_AT_LOGIN.1)?;
        let sent = harness.captured.messages()?;
        if sent != [WindowMessage::SetStartAtLogin { enabled: false }] {
            return Err(format!("clicking start at login sent {sent:?}").into());
        }
        println!("render_pages: start-at-login click sent {sent:?}");
        harness.receive(&SupervisorMessage::State {
            state: StateSnapshot {
                start_at_login: false,
                ..sample_state()
            },
        })?;
        let after = harness.capture("settings-after-toggle")?;
        if before == after {
            return Err("the snapshot with start at login off did not repaint".into());
        }

        // Close from the supervisor ends the window's listener cleanly.
        harness.receive(&SupervisorMessage::Close)?;
        if harness.captured.messages()?.len() != 1 {
            return Err("closing sent a command".into());
        }
        Ok(())
    }
}
