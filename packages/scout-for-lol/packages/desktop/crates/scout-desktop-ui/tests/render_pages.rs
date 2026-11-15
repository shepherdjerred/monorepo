//! Drives the real window offscreen, with GPUI's Metal renderer: supervisor
//! messages go in as IPC lines, the sidebar, the chat controls and the
//! start-at-login checkbox are clicked, and the commands that come out are
//! decoded.
//!
//! The chat states come from the golden Explore fixtures played through the
//! supervisor's chat session, so what renders here is what the relay sends.
//!
//! Set `SCOUT_DESKTOP_UI_CAPTURE_DIR` to also write one PNG per state there; a
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
        AnyWindowHandle, AppContext as _, Bounds, Entity, HeadlessAppContext, Keystroke, Modifiers,
        MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, PlatformInput, Point,
        WindowBounds, WindowOptions, px, size,
    };
    use scout_desktop_ipc::{
        ChatAvailability, ChatCommand, ChatParts, ChatStatus, CounterReading, DiagnosticsSnapshot,
        GameflowPhase, PROTOCOL_VERSION, PrivacySnapshot, StateSnapshot, SupervisorMessage,
        UpdateSnapshot, UpdateStatus, WindowMessage, decode_line, encode_line,
    };
    use scout_desktop_ui::BuildInfo;
    use scout_desktop_ui::preview::{Incoming, Outbound, ScoutWindow, prepare};
    use scout_desktop_ui::view_model::PageId;
    use scout_explore_client::golden;

    type Error = Box<dyn std::error::Error>;
    type Window = ScoutWindow<Captured>;

    const WIDTH: f32 = 760.;
    const HEIGHT: f32 = 520.;

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
            pairing_match_code: Some("K7Q-2M".to_owned()),
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
        view: Entity<Window>,
        supervisor: async_channel::Sender<Incoming>,
        captured: Captured,
        capture_dir: Option<PathBuf>,
        chat: Option<ChatParts>,
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
            let (window, view) = cx.update(|cx| {
                gpui_kit::open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(WIDTH), px(HEIGHT)),
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
                view,
                supervisor,
                captured,
                capture_dir: std::env::var_os("SCOUT_DESKTOP_UI_CAPTURE_DIR").map(PathBuf::from),
                chat: None,
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

        /// Relay chat as the supervisor does: only the parts that changed.
        fn chat(&mut self, parts: ChatParts) -> Result<(), Error> {
            for message in parts.changes_since(self.chat.as_ref()) {
                self.receive(&message)?;
            }
            self.chat = Some(parts);
            Ok(())
        }

        fn sent(&self) -> Result<Vec<WindowMessage>, Error> {
            self.captured.messages()
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

        fn key(&mut self, keystroke: &'static str) -> Result<(), Error> {
            let keystroke = Keystroke::parse(keystroke)?;
            self.cx.update_window(self.window, |_, window, cx| {
                window.dispatch_keystroke(keystroke, cx);
            })?;
            self.cx.run_until_parked();
            Ok(())
        }

        fn composer_focused(&mut self) -> Result<bool, Error> {
            let view = self.view.clone();
            Ok(self.cx.update_window(self.window, |_, window, cx| {
                view.read(cx).composer_focused(window, cx)
            })?)
        }

        /// Draw a frame and return its RGBA pixels.
        fn capture(&mut self, name: &str) -> Result<Vec<u8>, Error> {
            // Let component transitions (the checkbox's check mark, the
            // streamed text's fade) finish.
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
            let (width, height) = (image.width() as usize, image.height() as usize);
            let raw = image.into_raw();
            assert_right_gutter_clear(name, &raw, width, height)?;
            Ok(raw)
        }
    }

    /// Text that does not wrap runs off the right edge. Every page has 24 px
    /// of right padding (48 device pixels at 2x), so nothing may be drawn in
    /// the last 16 device pixels of any row; the top-right pixel is the
    /// canvas.
    fn assert_right_gutter_clear(
        name: &str,
        rgba: &[u8],
        width: usize,
        height: usize,
    ) -> Result<(), Error> {
        const GUTTER: usize = 16;
        let edge = &rgba[(width - 1) * 4..width * 4];
        for row in 0..height {
            let start = row * width * 4;
            for column in width - GUTTER..width {
                let at = start + column * 4;
                if rgba[at..at + 4] != *edge {
                    return Err(format!(
                        "{name}: content is drawn at x={column}, y={row}, inside the right \
                         margin; a line is not wrapping"
                    )
                    .into());
                }
            }
        }
        Ok(())
    }

    /// The centre of a status entry. The secondary section sits at the
    /// bottom of the sidebar: its 12 px padding, then one 46 px row per page
    /// counted up from the last.
    fn status_point(page: PageId) -> Result<(f32, f32), Error> {
        let index = PageId::STATUS
            .iter()
            .position(|candidate| *candidate == page)
            .ok_or("page is not in the status navigation")?;
        let from_bottom = f32::from(u8::try_from(PageId::STATUS.len() - index)?);
        Ok((
            100.,
            HEIGHT - 12. - from_bottom * STATUS_ROW + STATUS_ROW / 2.,
        ))
    }

    /// One sidebar entry's height plus the gap after it.
    const STATUS_ROW: f32 = 46.;
    /// "New chat", the first entry under the "Chats" heading.
    const NEW_CHAT: (f32, f32) = (100., 114.);
    /// The second conversation, two entries below "New chat".
    const SECOND_CONVERSATION: (f32, f32) = (100., 206.);
    /// The start-at-login checkbox on the Settings page.
    const START_AT_LOGIN: (f32, f32) = (232., 218.);
    /// Stop, right of Send at the bottom of the chat page.
    const STOP: (f32, f32) = (710., 484.);

    fn gated(availability: ChatAvailability) -> ChatParts {
        ChatParts {
            status: ChatStatus {
                availability,
                ..ChatStatus::default()
            },
            ..ChatParts::default()
        }
    }

    fn chat_states(harness: &mut Harness) -> Result<(), Error> {
        // Before the relay answers, chat says it is connecting.
        harness.capture("chat-loading")?;

        harness.chat(golden::ready()?.parts())?;
        if !harness.composer_focused()? {
            return Err("the window did not open with the composer focused".into());
        }
        harness.capture("chat-empty")?;

        // Keyboard order: composer, Send, then the sidebar; Shift-Tab walks
        // back. The focus ring is the theme's focus token.
        harness.key("tab")?;
        if harness.composer_focused()? {
            return Err("Tab did not leave the composer".into());
        }
        harness.capture("chat-focus-send")?;
        harness.key("tab")?;
        harness.capture("chat-focus-sidebar")?;
        harness.key("shift-tab")?;
        harness.key("shift-tab")?;
        if !harness.composer_focused()? {
            return Err("Shift-Tab did not return to the composer".into());
        }

        let streaming = golden::streaming()?.parts();
        harness.chat(streaming.clone())?;
        harness.capture("chat-streaming")?;

        let before = harness.sent()?.len();
        harness.click(STOP.0, STOP.1)?;
        let sent = harness.sent()?;
        if sent[before..]
            != [WindowMessage::Chat {
                command: ChatCommand::Stop,
            }]
        {
            return Err(format!("clicking Stop sent {:?}", &sent[before..]).into());
        }

        let mut reconnecting = streaming;
        reconnecting.status.reconnecting = true;
        harness.chat(reconnecting)?;
        harness.capture("chat-reconnecting")?;

        harness.chat(golden::settled()?.parts())?;
        harness.capture("chat-answered")?;

        let before = harness.sent()?.len();
        harness.click(SECOND_CONVERSATION.0, SECOND_CONVERSATION.1)?;
        let sent = harness.sent()?;
        let ready = golden::ready()?.parts();
        let expected = WindowMessage::Chat {
            command: ChatCommand::Open {
                conversation_id: ready.conversations[1].id,
            },
        };
        if sent[before..] != [expected] {
            return Err(format!("clicking a conversation sent {:?}", &sent[before..]).into());
        }

        harness.chat(gated(ChatAvailability::NeedsApproval))?;
        harness.capture("chat-not-approved")?;
        harness.chat(gated(ChatAvailability::TurnedOff))?;
        harness.capture("chat-turned-off")?;
        // Too old for chat: the screen shows where the update stands.
        harness.receive(&SupervisorMessage::Update {
            update: UpdateSnapshot {
                status: UpdateStatus::Downloading,
                version: Some("0.4.0".to_owned()),
                required: true,
            },
        })?;
        harness.chat(gated(ChatAvailability::UpgradeRequired))?;
        harness.capture("chat-update-required")?;

        // New chat sends its command and shows the chat page.
        let before = harness.sent()?.len();
        harness.click(NEW_CHAT.0, NEW_CHAT.1)?;
        let sent = harness.sent()?;
        if sent[before..]
            != [WindowMessage::Chat {
                command: ChatCommand::New,
            }]
        {
            return Err(format!("clicking New chat sent {:?}", &sent[before..]).into());
        }
        harness.chat(golden::settled()?.parts())?;
        Ok(())
    }

    fn status_pages(harness: &mut Harness) -> Result<(), Error> {
        for page in PageId::STATUS {
            let (x, y) = status_point(page)?;
            harness.click(x, y)?;
            harness.capture(&page.label().to_lowercase())?;
        }

        // Settings: toggling start at login sends the opposite state, and
        // the supervisor's next snapshot is what unchecks the box.
        let (x, y) = status_point(PageId::Settings)?;
        harness.click(x, y)?;
        let before = harness.capture("settings")?;
        let already = harness.sent()?.len();
        harness.click(START_AT_LOGIN.0, START_AT_LOGIN.1)?;
        let sent = harness.sent()?;
        if sent[already..] != [WindowMessage::SetStartAtLogin { enabled: false }] {
            return Err(format!("clicking start at login sent {:?}", &sent[already..]).into());
        }
        println!(
            "render_pages: start-at-login click sent {:?}",
            &sent[already..]
        );
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

        // Usage data off: the supervisor's snapshot repaints the toggle.
        harness.receive(&SupervisorMessage::State {
            state: StateSnapshot {
                privacy: PrivacySnapshot {
                    send_error_reports: true,
                    send_usage_data: false,
                },
                ..sample_state()
            },
        })?;
        let usage_off = harness.capture("settings-usage-off")?;
        if before == usage_off {
            return Err("the snapshot with usage data off did not repaint".into());
        }
        Ok(())
    }

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

        chat_states(&mut harness)?;
        status_pages(&mut harness)?;

        // Close from the supervisor ends the window's listener cleanly, and
        // sends nothing.
        let sent = harness.sent()?.len();
        harness.receive(&SupervisorMessage::Close)?;
        if harness.sent()?.len() != sent {
            return Err("closing sent a command".into());
        }
        Ok(())
    }
}
