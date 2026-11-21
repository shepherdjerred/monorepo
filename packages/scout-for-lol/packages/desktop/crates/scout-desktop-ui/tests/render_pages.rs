//! Drives the real window offscreen, with GPUI's Metal renderer: supervisor
//! messages go in as IPC lines, the sidebar, the chat controls and the
//! start-at-login checkbox are clicked, and the commands that come out are
//! decoded.
//!
//! The chat states come from the golden Explore fixtures played through the
//! supervisor's chat session, so what renders here is what the relay sends.
//! The visuals states show the golden visuals transcript one answer at a
//! time, with a stub PNG standing in for Scout's chart and flat squares for
//! card art, written where the supervisor's cache would hold them.
//!
//! Voice renders last: the microphone indicator in every state, the first-use
//! question, the spoken turn above the chat, and the Settings section, each
//! from the supervisor's voice messages, with the commands its controls send.
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
        ChatAvailability, ChatCoach, ChatCoachKind, ChatCommand, ChatImage, ChatParts, ChatStatus,
        CounterReading, DiagnosticsSnapshot, GameflowPhase, LiveGameSnapshot, OverlayWarning,
        PROTOCOL_VERSION, PrivacySnapshot, StateSnapshot, SupervisorMessage, UpdateSnapshot,
        UpdateStatus, VoiceCommand, VoiceConsent, VoiceSettings, VoiceSnapshot, VoiceState,
        VoiceTurnView, WindowMessage, decode_line, encode_line,
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
            overlay_warning: None,
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

    /// A stub chart: four bars on the chart surface, so the frame shows
    /// a picture rather than a flat fill.
    fn stub_chart(path: &std::path::Path) -> Result<(), Error> {
        // Bar heights in percent of the frame.
        let bars = [61_u32, 55, 52, 47];
        let (width, height) = (720_u32, 360_u32);
        let image = image::RgbaImage::from_fn(width, height, |x, y| {
            let band = x * 4 / width;
            let left = band * width / 4;
            let inside = x > left + 30 && x < left + width / 4 - 30;
            let bar = usize::try_from(band)
                .ok()
                .and_then(|index| bars.get(index))
                .copied()
                .unwrap_or(0);
            let top = height - bar * height / 100;
            if inside && y > top {
                image::Rgba([0x3B, 0x82, 0xC4, 0xFF])
            } else if y % 90 == 0 {
                image::Rgba([0x2A, 0x33, 0x3D, 0xFF])
            } else {
                image::Rgba([0x0A, 0x14, 0x1E, 0xFF])
            }
        });
        image.save(path)?;
        Ok(())
    }

    /// A flat square in a color picked from `seed`, standing in for art.
    fn stub_art(path: &std::path::Path, seed: usize) -> Result<(), Error> {
        let palette = [
            [0xC8, 0xAA, 0x6E],
            [0x3B, 0x82, 0xC4],
            [0x5B, 0xA8, 0x7A],
            [0xB0, 0x5C, 0x8E],
            [0xD0, 0x7A, 0x3A],
        ];
        let [r, g, b] = palette[seed % palette.len()];
        image::RgbaImage::from_fn(64, 64, |x, y| {
            let edge = x < 4 || y < 4 || x > 59 || y > 59;
            if edge {
                image::Rgba([r / 2, g / 2, b / 2, 0xFF])
            } else {
                image::Rgba([r, g, b, 0xFF])
            }
        })
        .save(path)?;
        Ok(())
    }

    /// The golden visuals session with every picture written to disk.
    fn visuals_with_pictures() -> Result<ChatParts, Error> {
        let mut parts = golden::visuals()?.parts();
        let directory =
            std::env::temp_dir().join(format!("scout-render-pictures-{}", std::process::id()));
        std::fs::create_dir_all(&directory)?;
        let mut images = std::collections::BTreeMap::new();
        for (index, key) in parts.images.keys().enumerate() {
            let path = directory.join(format!("{index}.png"));
            if key.starts_with("chart:") {
                stub_chart(&path)?;
            } else {
                stub_art(&path, index)?;
            }
            images.insert(
                key.clone(),
                ChatImage::Ready {
                    path: path.to_string_lossy().into_owned(),
                },
            );
        }
        parts.images = images;
        Ok(parts)
    }

    /// `parts` showing only messages `from..from + 2`: one question and its
    /// answer, so each capture frames one kind of visual.
    fn one_answer(parts: &ChatParts, from: usize) -> Result<ChatParts, Error> {
        let mut shown = parts.clone();
        let transcript = shown.transcript.as_mut().ok_or("no transcript")?;
        transcript.messages = transcript
            .messages
            .get(from..from + 2)
            .ok_or("the visuals transcript is too short")?
            .to_vec();
        Ok(shown)
    }

    /// Let the window read and decode the pictures it was just told about.
    fn settle_pictures(harness: &mut Harness) -> Result<(), Error> {
        for _ in 0..20 {
            harness.cx.run_until_parked();
            std::thread::sleep(std::time::Duration::from_millis(25));
            harness
                .cx
                .update_window(harness.window, |_, window, _| window.refresh())?;
        }
        harness.cx.run_until_parked();
        Ok(())
    }

    fn visual_states(harness: &mut Harness) -> Result<(), Error> {
        let parts = visuals_with_pictures()?;

        // The chart while Scout draws it, then drawn.
        let mut loading = one_answer(&parts, 0)?;
        for image in loading.images.values_mut() {
            *image = ChatImage::Loading;
        }
        harness.chat(loading)?;
        harness.capture("chat-chart-loading")?;
        let mut failed = one_answer(&parts, 0)?;
        for image in failed.images.values_mut() {
            *image = ChatImage::Failed {
                message: "Too many charts from this device. Try again shortly.".to_owned(),
            };
        }
        harness.chat(failed)?;
        harness.capture("chat-chart-failed")?;
        harness.chat(one_answer(&parts, 0)?)?;
        settle_pictures(harness)?;
        harness.capture("chat-chart")?;

        harness.chat(one_answer(&parts, 2)?)?;
        settle_pictures(harness)?;
        harness.capture("chat-table")?;

        harness.chat(one_answer(&parts, 4)?)?;
        settle_pictures(harness)?;
        harness.capture("chat-match-card")?;

        harness.chat(one_answer(&parts, 6)?)?;
        settle_pictures(harness)?;
        harness.capture("chat-loadout-card")?;
        Ok(())
    }

    const BUILD_SCREEN: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/build-screen.png"
    );
    const SCOREBOARD: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/scoreboard.png");

    /// What clicking at `point` sends, as the commands that came out.
    fn click_sends(harness: &mut Harness, point: (f32, f32)) -> Result<Vec<WindowMessage>, Error> {
        let before = harness.sent()?.len();
        harness.click(point.0, point.1)?;
        Ok(harness.sent()?.split_off(before))
    }

    fn chat_command(command: ChatCommand) -> WindowMessage {
        WindowMessage::Chat { command }
    }

    /// The question's switcher: previous, next. The answer's: the same.
    const QUESTION_PREVIOUS: (f32, f32) = (580., 136.);
    const QUESTION_NEXT: (f32, f32) = (658., 136.);
    const QUESTION_EDIT: (f32, f32) = (703., 136.);
    const ANSWER_PREVIOUS: (f32, f32) = (240., 234.);
    const ANSWER_NEXT: (f32, f32) = (315., 234.);
    const ANSWER_REGENERATE: (f32, f32) = (385., 234.);
    const OPEN_IN_BROWSER: (f32, f32) = (577., 39.);
    const SHARE_LINK: (f32, f32) = (693., 39.);
    const SEND: (f32, f32) = (708., 484.);
    /// The first draft's Remove button, under its thumbnail.
    const REMOVE_FIRST_IMAGE: (f32, f32) = (260., 404.);
    /// The model picker's button, above the composer.
    const MODEL_PICKER: (f32, f32) = (315., 444.);

    /// Edit and regenerate, the version switcher, image attachments, share
    /// links and the model picker.
    fn chat_actions(harness: &mut Harness) -> Result<(), Error> {
        // The version switcher: arrows name the neighbouring versions, and
        // the end of the line is disabled.
        harness.chat(golden::versioned()?.parts())?;
        harness.capture("chat-versions")?;
        for (point, target) in [
            (QUESTION_PREVIOUS, golden::BRANCHED_QUESTION_FIRST),
            (QUESTION_NEXT, golden::BRANCHED_QUESTION_LAST),
            (ANSWER_NEXT, golden::BRANCHED_ANSWER_NEXT),
        ] {
            let sent = click_sends(harness, point)?;
            if sent
                != [chat_command(ChatCommand::SwitchVersion {
                    message_id: target,
                })]
            {
                return Err(format!("a version arrow sent {sent:?}, not {target}").into());
            }
        }
        let sent = click_sends(harness, ANSWER_PREVIOUS)?;
        if !sent.is_empty() {
            return Err(format!("the first version's Previous sent {sent:?}").into());
        }
        let sent = click_sends(harness, ANSWER_REGENERATE)?;
        if sent
            != [chat_command(ChatCommand::Regenerate {
                message_id: golden::BRANCHED_ANSWER,
            })]
        {
            return Err(format!("Regenerate sent {sent:?}").into());
        }

        // Edit puts the question back in the composer; sending it adds a
        // version of that turn rather than asking again.
        let sent = click_sends(harness, QUESTION_EDIT)?;
        if !sent.is_empty() {
            return Err(format!("Edit sent {sent:?} before anything was typed").into());
        }
        harness.capture("chat-editing")?;
        let sent = click_sends(harness, SEND)?;
        if sent
            != [chat_command(ChatCommand::Edit {
                message_id: golden::BRANCHED_QUESTION,
                question: "Which bot lane pair wins most in ARAM this month?".to_owned(),
            })]
        {
            return Err(format!("sending an edit sent {sent:?}").into());
        }

        // Open in browser links to the web conversation.
        let sent = click_sends(harness, OPEN_IN_BROWSER)?;
        let expected = format!(
            "https://scout-for-lol.com/app/explore/{}",
            golden::BRANCHED_CONVERSATION
        );
        if sent != [WindowMessage::OpenUrl { url: expected }] {
            return Err(format!("Open in browser sent {sent:?}").into());
        }

        // Sharing: the button asks, and the link shows once Scout answers.
        let sent = click_sends(harness, SHARE_LINK)?;
        if sent != [chat_command(ChatCommand::Share)] {
            return Err(format!("Share link sent {sent:?}").into());
        }
        harness.chat(golden::shared()?.parts())?;
        harness.capture("chat-shared")?;

        // Two images waiting in the composer, with their thumbnails.
        let composing = golden::composing(BUILD_SCREEN, SCOREBOARD)?.parts();
        let first_image = composing.composer.drafts[0].key;
        harness.chat(composing)?;
        harness.capture("chat-composing")?;
        let sent = click_sends(harness, REMOVE_FIRST_IMAGE)?;
        if sent
            != [chat_command(ChatCommand::RemoveAttachment {
                key: first_image,
            })]
        {
            return Err(format!("Remove sent {sent:?}").into());
        }

        // The model picker opens in the window and lists the server's models.
        harness.click(MODEL_PICKER.0, MODEL_PICKER.1)?;
        harness.capture("chat-model-picker")?;
        Ok(())
    }

    /// A champion-select answer's options render as chips with their reasons,
    /// and picking one sends the answer and the option's place, never text.
    fn coach_options(harness: &mut Harness) -> Result<(), Error> {
        let parts = golden::coach_options()?.parts();
        harness.chat(parts)?;
        harness.capture("chat-coach-options")?;
        let sent = click_sends(harness, COACH_FIRST_OPTION)?;
        if sent
            != [chat_command(ChatCommand::ChooseOption {
                message_id: golden::COACH_ANSWER,
                index: 0,
            })]
        {
            return Err(format!("the first option sent {sent:?}").into());
        }
        Ok(())
    }

    /// The first option chip of the golden champion-select answer.
    const COACH_FIRST_OPTION: (f32, f32) = (334., 234.);

    /// The coach panel over a champion select: the answer and its options as
    /// chips above the conversation, and over a game's start the plan with no
    /// options. Picking a chip sends the same follow-up as a transcript chip.
    fn coach_panels(harness: &mut Harness) -> Result<(), Error> {
        let mut parts = golden::coach_options()?.parts();
        parts.coach = Some(ChatCoach {
            kind: ChatCoachKind::ChampSelect,
            message_id: golden::COACH_ANSWER,
        });
        harness.chat(parts.clone())?;
        harness.capture("chat-coach-champ-select")?;
        let sent = click_sends(harness, COACH_PANEL_FIRST_OPTION)?;
        if sent
            != [chat_command(ChatCommand::ChooseOption {
                message_id: golden::COACH_ANSWER,
                index: 0,
            })]
        {
            return Err(format!("the panel's first option sent {sent:?}").into());
        }
        fullscreen_warning(harness)?;

        if let Some(transcript) = parts.transcript.as_mut() {
            for message in &mut transcript.messages {
                if message.id == golden::COACH_ANSWER {
                    message.coach_options.clear();
                    "Your lane is Ahri into Zed. Take Doran's Ring, hold Flash for his all-in, and look for a first back near level 5 with the wave pushed.".clone_into(&mut message.content);
                }
            }
        }
        parts.coach = Some(ChatCoach {
            kind: ChatCoachKind::Pregame,
            message_id: golden::COACH_ANSWER,
        });
        harness.chat(parts.clone())?;
        harness.capture("chat-coach-pregame")?;
        proactive_panel(harness, parts)
    }

    /// League set to exclusive fullscreen during champion select: the chat
    /// page says the overlay cannot draw over the game, above the coach panel.
    fn fullscreen_warning(harness: &mut Harness) -> Result<(), Error> {
        harness.receive(&SupervisorMessage::State {
            state: StateSnapshot {
                overlay_warning: Some(OverlayWarning::ExclusiveFullscreen),
                ..sample_state()
            },
        })?;
        harness.capture("chat-overlay-fullscreen-warning")?;
        harness.receive(&SupervisorMessage::State {
            state: sample_state(),
        })?;
        Ok(())
    }

    /// Beta profile only: something Scout noticed on the scoreboard and
    /// raised on its own, set apart as a "Scout noticed" card that says the
    /// player did not ask. The question above it is the one the server words.
    #[cfg(scout_proactive_coach)]
    fn proactive_panel(harness: &mut Harness, mut parts: ChatParts) -> Result<(), Error> {
        if let Some(transcript) = parts.transcript.as_mut() {
            for message in &mut transcript.messages {
                if message.id == golden::COACH_ANSWER {
                    "Three deaths without a takedown: Zed is finding you alone in the river. Stay behind your wave until your jungler shows, and buy a Zhonya's Hourglass next to answer his ultimate.".clone_into(&mut message.content);
                } else {
                    "Scout noticed I died 3 times without a takedown. What, if anything, should I consider?".clone_into(&mut message.content);
                }
            }
        }
        parts.coach = Some(ChatCoach {
            kind: ChatCoachKind::Proactive,
            message_id: golden::COACH_ANSWER,
        });
        harness.chat(parts)?;
        harness.capture("chat-coach-proactive")?;
        Ok(())
    }

    /// A stable build has no proactive panel to draw.
    #[cfg(not(scout_proactive_coach))]
    #[expect(clippy::unnecessary_wraps, reason = "matches the beta signature")]
    fn proactive_panel(_harness: &mut Harness, _parts: ChatParts) -> Result<(), Error> {
        Ok(())
    }

    /// The first option chip in the coach panel, above the transcript.
    const COACH_PANEL_FIRST_OPTION: (f32, f32) = (334., 160.);

    /// The live game chip, above the composer while a game is live.
    const LIVE_GAME_CHIP: (f32, f32) = (330., 444.);

    fn ahri_at_seven() -> LiveGameSnapshot {
        LiveGameSnapshot {
            game_time_secs: 421,
            champion: "Ahri".to_owned(),
            level: 10,
            kills: 4,
            deaths: 2,
            assists: 7,
            creep_score: 87,
        }
    }

    /// Type `keys` into the focused composer and press Enter; what it sent.
    fn ask(harness: &mut Harness, keys: &[&'static str]) -> Result<Vec<WindowMessage>, Error> {
        let before = harness.sent()?.len();
        for key in keys {
            harness.key(key)?;
        }
        harness.key("enter")?;
        Ok(harness.sent()?.split_off(before))
    }

    /// "Using your live game": shown while a game is live and on until the
    /// player turns it off; a question sent with it on asks the supervisor
    /// to attach the game, and with it off does not.
    fn live_game_chip(harness: &mut Harness) -> Result<(), Error> {
        harness.chat(golden::ready()?.parts())?;
        let idle = harness.capture("chat-no-live-game")?;
        harness.receive(&SupervisorMessage::LiveGame {
            live: Some(ahri_at_seven()),
        })?;
        let on = harness.capture("chat-live-game-on")?;
        if on == idle {
            return Err("a live game did not show the chip".into());
        }
        let sent = ask(harness, &["h", "i"])?;
        if sent
            != [chat_command(ChatCommand::Send {
                question: "hi".to_owned(),
                live_game: true,
            })]
        {
            return Err(format!("a question with the chip on sent {sent:?}").into());
        }
        let sent = click_sends(harness, LIVE_GAME_CHIP)?;
        if !sent.is_empty() {
            return Err(format!("the chip sent {sent:?}; it is the window's own state").into());
        }
        let off = harness.capture("chat-live-game-off")?;
        if off == on {
            return Err("turning the chip off did not repaint it".into());
        }
        let sent = ask(harness, &["o", "k"])?;
        if sent
            != [chat_command(ChatCommand::Send {
                question: "ok".to_owned(),
                live_game: false,
            })]
        {
            return Err(format!("a question with the chip off sent {sent:?}").into());
        }
        // Back on for the rest of the run, then the game ends.
        harness.click(LIVE_GAME_CHIP.0, LIVE_GAME_CHIP.1)?;
        harness.receive(&SupervisorMessage::LiveGame { live: None })?;
        Ok(())
    }

    /// The Overview's "Live game" line: "Not in a game" until the supervisor
    /// reports one, then the local player's line, then cleared again.
    fn live_game(harness: &mut Harness) -> Result<(), Error> {
        let (x, y) = status_point(PageId::Overview)?;
        harness.click(x, y)?;
        let idle = harness.capture("overview-no-game")?;
        harness.receive(&SupervisorMessage::State {
            state: StateSnapshot {
                gameflow_phase: Some("InProgress".to_owned()),
                ..sample_state()
            },
        })?;
        harness.receive(&SupervisorMessage::LiveGame {
            live: Some(ahri_at_seven()),
        })?;
        let playing = harness.capture("live-game")?;
        if idle == playing {
            return Err("the live game did not repaint the Overview".into());
        }
        harness.receive(&SupervisorMessage::LiveGame { live: None })?;
        harness.receive(&SupervisorMessage::State {
            state: sample_state(),
        })?;
        Ok(())
    }

    fn status_pages(harness: &mut Harness) -> Result<(), Error> {
        live_game(harness)?;
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

    fn voice_settings() -> VoiceSettings {
        VoiceSettings {
            conversation_mode: true,
            push_to_talk: true,
            push_to_talk_key: "F8".to_owned(),
            mute_key: "Shift+F8".to_owned(),
        }
    }

    fn voice(state: VoiceState) -> SupervisorMessage {
        SupervisorMessage::Voice {
            voice: VoiceSnapshot {
                state,
                consent: VoiceConsent::Accepted,
                consent_requested: false,
                muted: state == VoiceState::Muted,
                settings: Some(voice_settings()),
                detail: (state == VoiceState::Error)
                    .then(|| "The microphone stopped: no default input device".to_owned()),
            },
        }
    }

    fn voice_command(command: VoiceCommand) -> WindowMessage {
        WindowMessage::Voice { command }
    }

    /// The microphone indicator, right of "Scout" at the top of the sidebar.
    const MIC_INDICATOR: (f32, f32) = (150., 26.);
    /// "Turn on voice" in the first-use question.
    const CONSENT_ACCEPT: (f32, f32) = (238., 368.);
    /// The F9 push-to-talk key on the Settings page.
    const PUSH_TO_TALK_F9: (f32, f32) = (287., 400.);

    fn voice_states(harness: &mut Harness) -> Result<(), Error> {
        // The chat page, as a player sees it mid-game.
        harness.click(NEW_CHAT.0, NEW_CHAT.1)?;
        harness.chat(golden::settled()?.parts())?;
        let before = harness.capture("voice-none")?;

        // First use: the question over the window, before anything listens.
        harness.receive(&SupervisorMessage::Voice {
            voice: VoiceSnapshot {
                state: VoiceState::Off,
                consent: VoiceConsent::NotAsked,
                consent_requested: true,
                muted: false,
                settings: Some(voice_settings()),
                detail: None,
            },
        })?;
        harness.capture("voice-consent")?;
        let sent = click_sends(harness, CONSENT_ACCEPT)?;
        if sent != [voice_command(VoiceCommand::Consent { accepted: true })] {
            return Err(format!("Turn on voice sent {sent:?}").into());
        }

        // Every state the indicator shows.
        for (state, name) in [
            (VoiceState::Listening, "voice-listening"),
            (VoiceState::Capturing, "voice-recording"),
            (VoiceState::Thinking, "voice-thinking"),
            (VoiceState::Muted, "voice-muted"),
            (VoiceState::Error, "voice-error"),
        ] {
            harness.receive(&voice(state))?;
            let shown = harness.capture(name)?;
            if shown == before {
                return Err(format!("{name} did not show the indicator").into());
            }
        }
        harness.receive(&voice(VoiceState::Listening))?;
        let sent = click_sends(harness, MIC_INDICATOR)?;
        if sent != [voice_command(VoiceCommand::SetMuted { muted: true })] {
            return Err(format!("the indicator sent {sent:?}").into());
        }

        // The spoken turn above the transcript, while Scout answers aloud.
        harness.receive(&voice(VoiceState::Speaking))?;
        harness.receive(&SupervisorMessage::VoiceTurn {
            turn: Some(VoiceTurnView {
                heard: Some("What should I build next against their Zed?".to_owned()),
                answer: Some(
                    "Zhonya's Hourglass: Zed has two items and your Seeker's Armguard is ready to upgrade."
                        .to_owned(),
                ),
                error: None,
                #[cfg(scout_proactive_coach)]
                app_initiated: false,
            }),
        })?;
        harness.capture("voice-speaking")?;
        // Beta profile only: Scout saying something it noticed on its own,
        // labelled as such rather than as the player's question.
        #[cfg(scout_proactive_coach)]
        {
            harness.receive(&SupervisorMessage::VoiceTurn {
                turn: Some(VoiceTurnView {
                    heard: None,
                    answer: Some(
                        "Zed finished Eclipse, so his next all-in hits harder. A Seeker's Armguard would let you stop his ultimate."
                            .to_owned(),
                    ),
                    error: None,
                    app_initiated: true,
                }),
            })?;
            harness.capture("voice-proactive")?;
        }
        harness.receive(&voice(VoiceState::Listening))?;
        harness.receive(&SupervisorMessage::VoiceTurn {
            turn: Some(VoiceTurnView {
                heard: None,
                answer: None,
                error: Some("Scout did not hear \"hey scout\" at the start.".to_owned()),
                #[cfg(scout_proactive_coach)]
                app_initiated: false,
            }),
        })?;
        harness.capture("voice-turn-refused")?;

        // Settings: the voice section, and picking another key.
        let (x, y) = status_point(PageId::Settings)?;
        harness.click(x, y)?;
        harness.capture("settings-voice")?;
        let sent = click_sends(harness, PUSH_TO_TALK_F9)?;
        let expected = voice_command(VoiceCommand::SetSettings {
            settings: VoiceSettings {
                push_to_talk_key: "F9".to_owned(),
                ..voice_settings()
            },
        });
        if sent != [expected] {
            return Err(format!("picking F9 sent {sent:?}").into());
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
        visual_states(&mut harness)?;
        chat_actions(&mut harness)?;
        coach_options(&mut harness)?;
        coach_panels(&mut harness)?;
        live_game_chip(&mut harness)?;
        status_pages(&mut harness)?;
        voice_states(&mut harness)?;

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
