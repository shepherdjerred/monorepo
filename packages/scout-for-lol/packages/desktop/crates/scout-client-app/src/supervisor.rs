//! The GPU-free supervisor: owns collection and runs the window as a child.
//!
//! Graphics devices get lost on Windows (sleep/resume, a driver reset, a
//! hybrid-GPU switch), and that can abort the process outright rather than
//! unwind. So the process that reads the League client and holds the outbox
//! never renders: it spawns this same executable with `--window`, talks to it
//! over the child's stdio in `scout-desktop-ipc` JSON lines, and relaunches it
//! when it dies.
//!
//! The microphone belongs here too ([`crate::voice`]): the window shows where
//! it is and sends the player's voice choices, but never opens it.
//!
//! So does the in-game overlay's state ([`overlay`]): the supervisor runs the
//! overlay as a second child (`--overlay`) for the length of a game, decides
//! which card it shows, and holds the keys that act on it. After a game it
//! looks for the game's post-game review ([`review`]) and shows it when ready.

use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::live::game_settings::GameWindowMode;
use scout_client_core::settings::PrivacySettings;
use scout_client_core::telemetry::{UsageEvent, WindowCrashCause, WindowCrashOutcome};
use scout_client_runtime::runtime::{
    ClientRuntime, GameflowPhase, PhaseReceiver, RuntimeState, StateReceiver,
};
use scout_desktop_ipc::{
    ChatCommand, ChatParts, CounterReading, DiagnosticsSnapshot, LiveGameSnapshot, OverlayWarning,
    PROTOCOL_VERSION, PrivacySnapshot, StateSnapshot, SupervisorMessage, UpdateSnapshot,
    VoiceSnapshot, VoiceState, VoiceTurnView, WindowMessage, check_protocol, decode_line,
    encode_line,
};
use scout_explore_client::relay::ChatRelay;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, watch};

use crate::hotkeys::{OverlayKey, OverlayKeyPort};
use crate::updater::service::{InstallOutcome, UpdateHandle};
use crate::voice::VoiceHandle;
use coach::CoachDriver;
use overlay::OverlayHost;
use review::{ReviewEvent, ReviewFetch, ReviewPoller};
pub use review::{ReviewSource, ScoutReviews};

/// A crash after this long is a fresh incident, not part of a crash loop.
pub const STABLE_RUN: Duration = Duration::from_mins(10);
/// The quick crash on which the supervisor stops relaunching the window.
pub const MAX_QUICK_CRASHES: u32 = 3;
/// Recent events shown on the Diagnostics page.
const RECENT_EVENT_ROWS: usize = 100;
/// How often diagnostics counters and events are re-sent while nothing else
/// changes, matching the window's one-second repaint.
const REFRESH: Duration = Duration::from_secs(1);
/// A window that cannot take a message this long is hung, not busy.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a quitting window gets to close itself before it is killed.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
/// The diagnostic operation recorded when the proactive coach asks Scout for
/// a turn. Beta profile only; `tests/proactive_boundary.rs` reads the built
/// binary for it.
#[cfg(scout_proactive_coach)]
const PROACTIVE_TRIGGER_OPERATION: &str = "proactive_coach_trigger";

/// The quick crashes in a row, counting the one that just happened.
#[must_use]
pub fn quick_crashes_now(before: u32, ran_for: Duration) -> u32 {
    if ran_for >= STABLE_RUN {
        1
    } else {
        before.saturating_add(1)
    }
}

/// What the collector offers the supervisor. [`ClientRuntime`] in production;
/// tests use a fake so no League client, keyring or network is involved.
pub trait Collector {
    /// Subscribe to the runtime snapshot.
    fn state(&self) -> StateReceiver;
    /// Subscribe to the typed gameflow phase.
    fn gameflow_phase(&self) -> PhaseReceiver;
    /// The diagnostics this process accumulates.
    fn diagnostics(&self) -> &Arc<Diagnostics>;
    /// Where JSONL records are written, when a file sink opened.
    fn log_directory(&self) -> Option<&Path>;
    /// Begin browser pairing.
    fn start_pairing(&self);
    /// Delete the local credential.
    fn disconnect(&self);
    /// Change the start-at-login registration.
    fn set_start_at_login(&self, enabled: bool);
    /// Change the two privacy switches.
    fn set_privacy_settings(&self, settings: PrivacySettings);
    /// Queue a product event; sent only while usage data is on.
    fn report_usage(&self, event: UsageEvent);
    /// Stop collection and wait for it to finish.
    fn stop(self);
}

impl Collector for ClientRuntime {
    fn state(&self) -> StateReceiver {
        ClientRuntime::state(self)
    }
    fn gameflow_phase(&self) -> PhaseReceiver {
        ClientRuntime::gameflow_phase(self)
    }
    fn diagnostics(&self) -> &Arc<Diagnostics> {
        ClientRuntime::diagnostics(self)
    }
    fn log_directory(&self) -> Option<&Path> {
        ClientRuntime::log_directory(self)
    }
    fn start_pairing(&self) {
        ClientRuntime::start_pairing(self);
    }
    fn disconnect(&self) {
        ClientRuntime::disconnect(self);
    }
    fn set_start_at_login(&self, enabled: bool) {
        ClientRuntime::set_start_at_login(self, enabled);
    }
    fn set_privacy_settings(&self, settings: PrivacySettings) {
        ClientRuntime::set_privacy_settings(self, settings);
    }
    fn report_usage(&self, event: UsageEvent) {
        ClientRuntime::report_usage(self, event);
    }
    fn stop(self) {
        ClientRuntime::stop(self);
    }
}

/// How to start the window process.
#[derive(Debug, Clone)]
pub struct WindowLauncher {
    program: PathBuf,
    arguments: Vec<String>,
}

impl WindowLauncher {
    /// Launch `program` with `arguments`.
    #[must_use]
    pub fn new(program: PathBuf, arguments: Vec<String>) -> Self {
        Self { program, arguments }
    }

    fn spawn(&self) -> std::io::Result<Child> {
        Command::new(&self.program)
            .args(&self.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
    }
}

/// A request from outside the window: the tray, or the platform event loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    /// Show the window, starting it if it is not running.
    OpenWindow,
    /// An overlay key was pressed.
    #[cfg_attr(
        not(any(target_os = "windows", target_os = "macos", test)),
        expect(
            dead_code,
            reason = "only the Windows and macOS hotkey registrar sends overlay keys; Linux has no overlay"
        )
    )]
    OverlayKey(OverlayKey),
    /// Quit Scout.
    Quit,
}

/// What the supervisor is doing with its window, for tests and the tray.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WindowStatus {
    /// Window processes started so far.
    pub launches: u32,
    /// Whether a window process is running now.
    pub running: bool,
    /// Whether relaunching stopped after [`MAX_QUICK_CRASHES`].
    pub given_up: bool,
}

/// Why [`Supervisor::run`] returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorExit {
    /// The user quit from the window or the tray.
    Quit,
    /// The window closed with no tray to reopen it.
    WindowClosedWithoutTray,
    /// An update installer was started while the app sat idle; it restarts
    /// the new version itself.
    Updating,
    /// Every control sender was dropped.
    ControlClosed,
    /// The supervisor itself panicked.
    Panicked,
}

/// Configuration for one supervisor run.
pub struct Supervisor<C: Collector> {
    collector: C,
    launcher: WindowLauncher,
    control: mpsc::UnboundedReceiver<Control>,
    tray_available: bool,
    open_window: bool,
    status: watch::Sender<WindowStatus>,
    /// The self-updater, when this build has one.
    updates: Option<UpdateHandle>,
    /// Explore chat, when the window renders it. The credential it uses stays
    /// in this process; the window only sees the chat parts.
    chat: Option<ChatRelay>,
    /// Voice, when this build has it. The microphone and the device
    /// credential stay in this process.
    voice: Option<VoiceHandle>,
    /// The in-game overlay, when this build has one. `run` takes it.
    overlay: Option<OverlayHost>,
    /// Whether this supervisor runs the overlay, for the fullscreen warning.
    overlay_available: bool,
    /// Where post-game reviews are read, when chat runs. `run` takes it.
    reviews: Option<Reviews>,
    /// How long a champion select holds still before the coach advises.
    coach_debounce: Duration,
    /// Held for the supervisor's life, so a second supervisor cannot share the
    /// outbox. The window process never takes it.
    _instance_lock: scout_client_runtime::instance::InstanceLock,
}

impl<C: Collector> Supervisor<C> {
    /// A supervisor that owns `collector` and the instance lock.
    #[must_use]
    pub fn new(
        instance_lock: scout_client_runtime::instance::InstanceLock,
        collector: C,
        launcher: WindowLauncher,
        control: mpsc::UnboundedReceiver<Control>,
        tray_available: bool,
        open_window: bool,
    ) -> Self {
        Self {
            collector,
            launcher,
            control,
            tray_available,
            open_window,
            status: watch::channel(WindowStatus::default()).0,
            updates: None,
            chat: None,
            voice: None,
            overlay: None,
            overlay_available: false,
            reviews: None,
            coach_debounce: coach::DEBOUNCE,
            _instance_lock: instance_lock,
        }
    }

    /// Let this supervisor install updates: on quit, and when the app is idle.
    #[must_use]
    pub fn with_updates(mut self, updates: UpdateHandle) -> Self {
        self.updates = Some(updates);
        self
    }

    /// Relay Explore chat between the window and Scout.
    #[must_use]
    pub fn with_chat(mut self, chat: ChatRelay) -> Self {
        self.chat = Some(chat);
        self
    }

    /// Own the microphone and relay voice between the window and Scout.
    #[must_use]
    pub fn with_voice(mut self, voice: VoiceHandle) -> Self {
        self.voice = Some(voice);
        self
    }

    /// Run the in-game overlay with `launcher` for the length of each game,
    /// holding its keys through `keys`.
    #[must_use]
    pub fn with_overlay(
        mut self,
        launcher: WindowLauncher,
        keys: Option<Box<dyn OverlayKeyPort>>,
    ) -> Self {
        self.overlay = Some(OverlayHost::new(launcher, keys));
        self.overlay_available = true;
        self
    }

    /// Look for each finished game's post-game review in `source`, and show
    /// it when it is ready.
    #[must_use]
    pub fn with_reviews(mut self, source: Box<dyn ReviewSource>) -> Self {
        self.reviews = Some(Reviews::new(source));
        self
    }

    /// Ask about reviews on every refresh, so a test does not sit through
    /// the backoff.
    #[cfg(test)]
    #[must_use]
    pub fn with_immediate_reviews(mut self, source: Box<dyn ReviewSource>) -> Self {
        let mut reviews = Reviews::new(source);
        reviews.poller = ReviewPoller::immediate();
        self.reviews = Some(reviews);
        self
    }

    /// Shorten the champion-select wait, so a test does not sit through it.
    #[cfg(test)]
    #[must_use]
    pub fn with_coach_debounce(mut self, debounce: Duration) -> Self {
        self.coach_debounce = debounce;
        self
    }

    /// Follow the window's lifecycle.
    #[cfg(test)]
    #[must_use]
    pub fn status(&self) -> watch::Receiver<WindowStatus> {
        self.status.subscribe()
    }

    /// Run until the user quits. A window crash never ends this; it is
    /// relaunched until [`MAX_QUICK_CRASHES`] quick crashes in a row.
    pub async fn run(mut self) -> SupervisorExit {
        let mut state = self.collector.state();
        let mut phase = self.collector.gameflow_phase();
        let mut window = None;
        let mut quick_crashes = 0;
        // Without a tray nothing could ever open the window, so it opens now
        // even under `--background`.
        if self.open_window || !self.tray_available {
            window = self.launch(&state, &phase).await;
        }
        let mut update_status = self.updates.as_ref().map(UpdateHandle::subscribe);
        let mut chat_parts = self.chat.as_ref().map(ChatRelay::subscribe);
        let mut voice = self.voice.as_ref().map(VoiceWatch::new);
        let mut pairing = pairing_key(&state.borrow());
        let mut coach = CoachDriver::new(self.coach_debounce);
        let mut overlay = self.overlay.take();
        let mut reviews = self.reviews.take();
        // A supervisor that starts mid-game opens the overlay now.
        self.follow_overlay_phase(&mut overlay, &phase).await;
        let mut refresh = tokio::time::interval(REFRESH);
        refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let exit = loop {
            tokio::select! {
                control = self.control.recv() => match control {
                    Some(Control::OpenWindow) => {
                        self.open_window(&mut window, &mut quick_crashes, &state, &phase).await;
                    }
                    Some(Control::OverlayKey(key)) => {
                        let diagnostics = self.collector.diagnostics();
                        if let Some(review) = OverlayHost::press(&mut overlay, key, diagnostics).await {
                            self.open_review(review, (&mut window, &mut quick_crashes), &state, &phase).await;
                        }
                    }
                    Some(Control::Quit) => break SupervisorExit::Quit,
                    None => break SupervisorExit::ControlClosed,
                },
                Some((match_id, answer)) = Reviews::next(&mut reviews) => {
                    let event = reviews.as_mut().and_then(|reviews| reviews.settle(&match_id, answer));
                    let windows = (&mut window, &mut quick_crashes);
                    self.review_settled(event, &mut overlay, windows, &state, &phase).await;
                }
                event = OverlayHost::next_event(&mut overlay) => {
                    OverlayHost::react(&mut overlay, event, self.collector.diagnostics()).await;
                }
                event = next_event(&mut window) => {
                    let windows = (&mut window, &mut quick_crashes);
                    if let Some(exit) = self.window_event(event, windows, &state, &phase).await {
                        break exit;
                    }
                }
                Ok(()) = state.changed() => {
                    self.state_changed(window.as_mut(), &state, &mut pairing).await;
                }
                true = parts_changed(&mut chat_parts) => {
                    self.observe_upgrade_required(&state);
                    if let Some(running) = window.as_mut() {
                        self.send_chat(running).await;
                    }
                    self.offer_overlay_cards(&mut overlay).await;
                }
                true = VoiceWatch::changed(&mut voice) => {
                    if let Some(running) = window.as_mut() {
                        self.send_voice(running).await;
                    }
                    self.offer_overlay_cards(&mut overlay).await;
                }
                true = update_changed(&mut update_status) => {
                    if let Some(running) = window.as_mut() {
                        self.send_update(running).await;
                    }
                }
                Ok(()) = phase.changed() => {
                    self.drive_coach(&mut coach, &state, &phase);
                    if let Some(running) = window.as_mut() {
                        let message = phase_message(&phase.borrow_and_update());
                        self.deliver(running, &message).await;
                    }
                    self.follow_overlay_phase(&mut overlay, &phase).await;
                }
                _ = refresh.tick() => {
                    self.drive_coach(&mut coach, &state, &phase);
                    if let Some(running) = window.as_mut() {
                        self.send_state(running, &state).await;
                    }
                    OverlayHost::refresh(&mut overlay, self.collector.diagnostics()).await;
                    if let Some(reviews) = reviews.as_mut() {
                        reviews.tick(&state.borrow());
                    }
                    if self.install_when_idle(window.is_some(), &phase) {
                        break SupervisorExit::Updating;
                    }
                }
            }
        };
        self.finish(exit, window, overlay, &phase).await
    }

    /// A game's review is settled: show a ready one in the main window, unless
    /// a game is being played, and raise its overlay card.
    async fn review_settled(
        &self,
        event: Option<ReviewEvent>,
        overlay: &mut Option<OverlayHost>,
        windows: (&mut Option<Window>, &mut u32),
        state: &StateReceiver,
        phase: &PhaseReceiver,
    ) {
        match event {
            Some(ReviewEvent::Ready {
                match_id,
                conversation_id,
            }) => {
                self.record(review_event(
                    DiagnosticLevel::Info,
                    DiagnosticOutcome::Succeeded,
                    format!("the review of {match_id} is ready"),
                ));
                let playing = matches!(
                    *phase.borrow(),
                    GameflowPhase::InProgress | GameflowPhase::Reconnect
                );
                if playing {
                    // Never take the screen from a game; the overlay card
                    // opens it when the player asks.
                    self.chat_command(ChatCommand::Refresh);
                } else {
                    self.open_review(conversation_id, windows, state, phase)
                        .await;
                }
                if let Some(host) = overlay.as_mut() {
                    host.review_ready(&match_id, conversation_id);
                    host.flush(self.collector.diagnostics()).await;
                }
            }
            Some(ReviewEvent::Stopped { match_id, reason }) => {
                self.record(review_event(
                    DiagnosticLevel::Info,
                    DiagnosticOutcome::Skipped,
                    format!("no review of {match_id}: {reason}"),
                ));
            }
            None => {}
        }
    }

    /// Open a review's conversation in the main window and bring the window
    /// up, starting it if it is not running.
    async fn open_review(
        &self,
        conversation_id: uuid::Uuid,
        (window, quick_crashes): (&mut Option<Window>, &mut u32),
        state: &StateReceiver,
        phase: &PhaseReceiver,
    ) {
        self.chat_command(ChatCommand::Open { conversation_id });
        self.chat_command(ChatCommand::Refresh);
        self.open_window(window, quick_crashes, state, phase).await;
    }

    /// Close the window and the overlay, stop collection, and install a
    /// waiting update when the user quit.
    async fn finish(
        self,
        exit: SupervisorExit,
        window: Option<Window>,
        overlay: Option<OverlayHost>,
        phase: &PhaseReceiver,
    ) -> SupervisorExit {
        if let Some(running) = window {
            self.close(running).await;
        }
        if let Some(mut host) = overlay {
            host.stop();
        }
        self.status.send_modify(|status| status.running = false);
        let updates = self.updates.clone();
        self.collector.stop();
        // A user who quit gets the update they were waiting on, once the
        // outbox has been closed cleanly, and never over a live game.
        if matches!(
            exit,
            SupervisorExit::Quit | SupervisorExit::WindowClosedWithoutTray
        ) && let Some(updates) = &updates
        {
            updates.install(false, &phase.borrow());
        }
        exit
    }

    /// Act on what the window said or did. Returns why the supervisor should
    /// stop, when it should.
    async fn window_event(
        &self,
        event: WindowEvent,
        (window, quick_crashes): (&mut Option<Window>, &mut u32),
        state: &StateReceiver,
        phase: &PhaseReceiver,
    ) -> Option<SupervisorExit> {
        match event {
            WindowEvent::Message(message) => {
                if let Some(running) = window.as_mut()
                    && self.handle(running, message).await == Handled::Quit
                {
                    return Some(SupervisorExit::Quit);
                }
            }
            WindowEvent::Unreadable(detail) => {
                if let Some(running) = window.as_mut() {
                    self.record(window_crash_event(DiagnosticOutcome::Failed, detail));
                    running.kill_because(WindowCrashCause::Unresponsive);
                }
            }
            WindowEvent::Exited(status) => {
                let ended = window.take()?;
                self.status.send_modify(|status| status.running = false);
                match self.after_exit(&ended, status, quick_crashes) {
                    AfterExit::Relaunch => *window = self.launch(state, phase).await,
                    AfterExit::Wait => {}
                    AfterExit::Quit => return Some(SupervisorExit::WindowClosedWithoutTray),
                }
            }
        }
        None
    }

    /// Open the overlay when a game starts and close it when it ends, then
    /// offer it what the main window shows.
    async fn follow_overlay_phase(&self, overlay: &mut Option<OverlayHost>, phase: &PhaseReceiver) {
        let Some(host) = overlay.as_mut() else {
            return;
        };
        let phase = phase.borrow().clone();
        host.follow_phase(&phase, self.collector.diagnostics())
            .await;
        self.offer_overlay_cards(overlay).await;
    }

    /// Offer the overlay the coach panel and the spoken turn the main window
    /// holds now, and send it what to draw.
    async fn offer_overlay_cards(&self, overlay: &mut Option<OverlayHost>) {
        let Some(host) = overlay.as_mut() else {
            return;
        };
        let parts = self.chat.as_ref().map(ChatRelay::subscribe);
        let voice = self
            .voice
            .as_ref()
            .map(|voice| (voice.snapshot(), voice.turn()));
        {
            let parts = parts.as_ref().map(|parts| parts.borrow());
            let voice = voice
                .as_ref()
                .map(|(snapshot, turn)| (snapshot.borrow().state, turn.borrow()));
            host.observe(
                parts.as_deref(),
                voice.as_ref().map(|(state, turn)| (*state, turn.as_ref())),
            );
        }
        host.flush(self.collector.diagnostics()).await;
    }

    /// Show the window, starting it if it is not running. An explicit open
    /// is a fresh start, not a continuation of a crash loop.
    async fn open_window(
        &self,
        window: &mut Option<Window>,
        quick_crashes: &mut u32,
        state: &StateReceiver,
        phase: &PhaseReceiver,
    ) {
        if let Some(running) = window.as_mut() {
            self.deliver(running, &SupervisorMessage::Show).await;
        } else {
            *quick_crashes = 0;
            self.status.send_modify(|status| status.given_up = false);
            *window = self.launch(state, phase).await;
        }
    }

    async fn state_changed(
        &self,
        window: Option<&mut Window>,
        state: &StateReceiver,
        pairing: &mut (bool, bool),
    ) {
        self.observe_upgrade_required(state);
        // A finished pairing (or a disconnect) changes what chat may do, so
        // ask Scout again. A device that approves chat while already paired
        // stays paired, so the end of its pending approval counts too.
        let now = pairing_key(&state.borrow());
        if now != *pairing {
            *pairing = now;
            self.chat_command(ChatCommand::Refresh);
        }
        if let Some(running) = window {
            self.send_state(running, state).await;
        }
    }

    /// A 426 means this build is below the backend's minimum: look for the
    /// release that fixes that right away. Uploads and chat each say so.
    fn observe_upgrade_required(&self, state: &StateReceiver) {
        let refused = state.borrow().upgrade_required.is_some()
            || self.chat.as_ref().is_some_and(ChatRelay::upgrade_required);
        if let Some(updates) = &self.updates {
            updates.observe_upgrade_required(refused);
        }
    }

    fn chat_command(&self, command: ChatCommand) {
        if let Some(chat) = &self.chat {
            chat.send(command);
        }
    }

    /// Let the coach look at the League client and hand the chat relay what
    /// it decides. Nothing runs while Scout says the coach is off for this
    /// player, or with no chat to carry the turns.
    fn drive_coach(&self, coach: &mut CoachDriver, state: &StateReceiver, phase: &PhaseReceiver) {
        let phase = phase.borrow().clone();
        let Some(chat) = self.chat.as_ref().filter(|chat| chat.coach_enabled()) else {
            // A select or game that ends while the coach is off still ends:
            // the next one must not inherit its key or its counts.
            coach.follow_phase(&phase);
            return;
        };
        // Scout cannot start a turn beside one the player has running, typed
        // or spoken; the coach waits and asks once it is over.
        let busy = chat.subscribe().borrow().turn.is_some()
            || self
                .voice
                .as_ref()
                .is_some_and(|voice| voice.snapshot().borrow().state == VoiceState::Thinking);
        let now = Instant::now();
        #[cfg_attr(not(scout_proactive_coach), expect(unused_mut))]
        let mut inputs = {
            let runtime = state.borrow();
            coach.tick(
                now,
                busy,
                &phase,
                runtime.champ_select.as_ref(),
                runtime.live_game.as_ref(),
            )
        };
        #[cfg(scout_proactive_coach)]
        {
            // A turn the coach is starting this tick counts as busy, so the
            // two never race for the conversation.
            let starting = inputs
                .iter()
                .any(|input| matches!(input, scout_explore_client::app_turns::CoachInput::Turn(_)));
            let runtime = state.borrow();
            inputs.extend(self.proactive_turn(
                coach,
                chat,
                now,
                busy || starting,
                &phase,
                runtime.live_game.as_ref(),
            ));
        }
        for input in inputs {
            chat.coach(input);
        }
    }

    /// The proactive turn this frame asks for, if any. Beta profile only.
    #[cfg(scout_proactive_coach)]
    fn proactive_turn(
        &self,
        coach: &mut CoachDriver,
        chat: &ChatRelay,
        now: Instant,
        busy: bool,
        phase: &GameflowPhase,
        live: Option<&scout_client_core::live::snapshot::LiveSnapshot>,
    ) -> Option<scout_explore_client::app_turns::CoachInput> {
        use scout_explore_client::app_turns::CoachInput;
        let catalog = chat.item_catalog()?;
        let input = coach.proactive_tick(now, busy, phase, live, &catalog)?;
        if let CoachInput::Trigger(turn) = &input {
            self.record(
                DiagnosticEvent::new(
                    DiagnosticLevel::Info,
                    DiagnosticCategory::Runtime,
                    PROACTIVE_TRIGGER_OPERATION,
                    DiagnosticOutcome::Succeeded,
                )
                .with_detail(turn.trigger.kind()),
            );
        }
        Some(input)
    }

    /// A command from the window. A question whose composer chip asks for
    /// the live game carries the collector's latest allowlisted snapshot, the
    /// one the window's `live_game` line is drawn from, and a question asked
    /// during champion select carries what the select shows; the window
    /// itself never supplies game data.
    fn window_chat_command(&self, command: ChatCommand) {
        let Some(chat) = &self.chat else { return };
        let (live_game, champ_select) = match &command {
            ChatCommand::Send { live_game, .. } => {
                let state = self.collector.state();
                let runtime = state.borrow();
                (
                    live_game.then(|| runtime.live_game.clone()).flatten(),
                    runtime.champ_select.clone(),
                )
            }
            _ => (None, None),
        };
        chat.send_with_game(command, live_game, champ_select);
    }

    /// Bring the window's chat up to date, sending only the parts that
    /// changed since it last heard.
    async fn send_chat(&self, window: &mut Window) {
        let Some(chat) = &self.chat else {
            return;
        };
        let parts = chat.subscribe().borrow().clone();
        for message in parts.changes_since(window.last_chat.as_ref()) {
            self.deliver(window, &message).await;
        }
        window.last_chat = Some(parts);
    }

    /// Bring the window's voice up to date: the microphone's state and the
    /// spoken turn, each only when it changed since the window last heard.
    async fn send_voice(&self, window: &mut Window) {
        let Some(voice) = &self.voice else {
            return;
        };
        let now = VoiceParts {
            snapshot: voice.snapshot().borrow().clone(),
            turn: voice.turn().borrow().clone(),
        };
        let last = window.last_voice.as_ref();
        if last.map(|last| &last.snapshot) != Some(&now.snapshot) {
            let message = SupervisorMessage::Voice {
                voice: now.snapshot.clone(),
            };
            self.deliver(window, &message).await;
        }
        if window.last_voice.as_ref().map(|last| &last.turn) != Some(&now.turn) {
            let message = SupervisorMessage::VoiceTurn {
                turn: now.turn.clone(),
            };
            self.deliver(window, &message).await;
        }
        window.last_voice = Some(now);
    }

    /// Start a staged update's installer when the app has sat idle. Returns
    /// whether it started, which ends this process.
    fn install_when_idle(&self, window_open: bool, phase: &PhaseReceiver) -> bool {
        let Some(updates) = &self.updates else {
            return false;
        };
        let phase = phase.borrow().clone();
        updates.idle_install_due(window_open, &phase, Instant::now())
            && matches!(updates.install(true, &phase), InstallOutcome::Started(_))
    }

    async fn launch(&self, state: &StateReceiver, phase: &PhaseReceiver) -> Option<Window> {
        let mut child = match self.launcher.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.record(window_crash_event(
                    DiagnosticOutcome::Failed,
                    format!("could not start the window: {error}"),
                ));
                self.report_crash(
                    WindowCrashCause::LaunchFailed,
                    WindowCrashOutcome::NotRelaunched,
                );
                return None;
            }
        };
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                "the window started without piped stdio".to_owned(),
            ));
            self.report_crash(
                WindowCrashCause::LaunchFailed,
                WindowCrashOutcome::NotRelaunched,
            );
            return None;
        };
        self.status.send_modify(|status| {
            status.launches = status.launches.saturating_add(1);
            status.running = true;
        });
        let mut window = Window {
            child,
            stdin: Some(stdin),
            lines: Some(BufReader::new(stdout).lines()),
            started: Instant::now(),
            greeted: false,
            relaunch: true,
            cause: None,
            last_state: None,
            last_live: None,
            last_chat: None,
            last_voice: None,
        };
        self.deliver(
            &mut window,
            &SupervisorMessage::Hello {
                protocol: PROTOCOL_VERSION,
                tray_available: self.tray_available,
            },
        )
        .await;
        self.send_state(&mut window, state).await;
        let message = phase_message(&phase.borrow());
        self.deliver(&mut window, &message).await;
        self.send_update(&mut window).await;
        self.send_chat(&mut window).await;
        self.send_voice(&mut window).await;
        // A window that opens reloads the conversation list.
        self.chat_command(ChatCommand::Refresh);
        Some(window)
    }

    async fn handle(&self, window: &mut Window, message: WindowMessage) -> Handled {
        if let WindowMessage::Hello { protocol } = message {
            if let Err(mismatch) = check_protocol(protocol) {
                // Both ends are this executable, so the binary changed under a
                // running supervisor. Relaunching would only repeat this.
                self.record(window_crash_event(
                    DiagnosticOutcome::Failed,
                    mismatch.to_string(),
                ));
                window.relaunch = false;
                window.kill_because(WindowCrashCause::ProtocolMismatch);
            } else {
                window.greeted = true;
            }
            return Handled::Continue;
        }
        if !window.greeted {
            self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                "the window sent a command before its hello".to_owned(),
            ));
            window.kill_because(WindowCrashCause::Unresponsive);
            return Handled::Continue;
        }
        match message {
            WindowMessage::Hello { .. } => {}
            WindowMessage::Pair => self.collector.start_pairing(),
            WindowMessage::Disconnect => self.collector.disconnect(),
            WindowMessage::SetStartAtLogin { enabled } => {
                self.collector.set_start_at_login(enabled);
            }
            WindowMessage::SetPrivacy {
                send_error_reports,
                send_usage_data,
            } => self.collector.set_privacy_settings(PrivacySettings {
                send_error_reports,
                send_usage_data,
            }),
            WindowMessage::OpenUrl { url } => open_web_page(&url),
            WindowMessage::OpenLogFolder => {
                if let Some(directory) = self.collector.log_directory()
                    && let Err(error) = open::that_detached(directory)
                {
                    tracing::warn!(%error, "could not open the Scout Client log folder");
                }
            }
            WindowMessage::RequestDiagnostics => {
                let text = self.collector.diagnostics().bundle();
                self.deliver(window, &SupervisorMessage::DiagnosticsBundle { text })
                    .await;
            }
            WindowMessage::Chat { command } => self.window_chat_command(command),
            WindowMessage::Voice { command } => {
                if let Some(voice) = &self.voice {
                    voice.send(command);
                }
            }
            WindowMessage::Quit => return Handled::Quit,
        }
        Handled::Continue
    }

    /// With no tray nothing can reopen the window or quit Scout, so a
    /// supervisor that has stopped relaunching must exit instead of waiting.
    fn wait_or_quit(&self) -> AfterExit {
        if self.tray_available {
            AfterExit::Wait
        } else {
            AfterExit::Quit
        }
    }

    fn after_exit(&self, ended: &Window, status: ExitStatus, quick_crashes: &mut u32) -> AfterExit {
        let cause = ended.cause.unwrap_or(WindowCrashCause::Exited);
        if status.success() {
            return if self.tray_available {
                AfterExit::Wait
            } else {
                AfterExit::Quit
            };
        }
        if !ended.relaunch {
            self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                format!("the window exited ({status}); not relaunching"),
            ));
            self.report_crash(cause, WindowCrashOutcome::NotRelaunched);
            return self.wait_or_quit();
        }
        *quick_crashes = quick_crashes_now(*quick_crashes, ended.started.elapsed());
        if *quick_crashes >= MAX_QUICK_CRASHES {
            self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                format!(
                    "the window exited ({status}); not relaunching after {quick_crashes} quick crashes"
                ),
            ));
            self.status.send_modify(|status| status.given_up = true);
            self.report_crash(cause, WindowCrashOutcome::GaveUp);
            return self.wait_or_quit();
        }
        self.record(window_crash_event(
            DiagnosticOutcome::Deferred,
            format!("the window exited ({status}); relaunching it"),
        ));
        self.report_crash(cause, WindowCrashOutcome::Relaunched);
        AfterExit::Relaunch
    }

    async fn send_state(&self, window: &mut Window, state: &StateReceiver) {
        let (snapshot, live) = {
            let runtime = state.borrow();
            (
                snapshot(
                    &runtime,
                    self.collector.diagnostics(),
                    self.collector.log_directory().is_some(),
                    self.overlay_available,
                ),
                live_game_snapshot(&runtime),
            )
        };
        if window.last_live != live {
            self.deliver(window, &SupervisorMessage::LiveGame { live: live.clone() })
                .await;
            window.last_live = live;
        }
        if window.last_state.as_ref() == Some(&snapshot) {
            return;
        }
        self.deliver(
            window,
            &SupervisorMessage::State {
                state: snapshot.clone(),
            },
        )
        .await;
        window.last_state = Some(snapshot);
    }

    async fn send_update(&self, window: &mut Window) {
        if let Some(updates) = &self.updates {
            let update = updates.snapshot();
            self.deliver(window, &SupervisorMessage::Update { update })
                .await;
        }
    }

    /// Write one message. A window that cannot take it is treated as crashed:
    /// it is killed, and its exit is handled like any other.
    async fn deliver(&self, window: &mut Window, message: &SupervisorMessage) {
        // A window that has already exited cannot read, and a write to its
        // pipe can still succeed: the pipe stays open for as long as any
        // process holds its read end, and a window launched concurrently
        // inherits that end between `fork` and `exec`. The exit status is the
        // authority, so consult it before writing instead of the write's result.
        if matches!(window.child.try_wait(), Ok(Some(_))) {
            window.stdin = None;
            return;
        }
        let Some(stdin) = window.stdin.as_mut() else {
            return;
        };
        let line = match encode_line(message) {
            Ok(line) => line,
            Err(error) => {
                self.record(window_crash_event(
                    DiagnosticOutcome::Failed,
                    error.to_string(),
                ));
                return;
            }
        };
        let written = tokio::time::timeout(WRITE_TIMEOUT, async {
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await
        })
        .await;
        match written {
            Ok(Ok(())) => return,
            // A window that is exiting closes its pipe; its exit status, not
            // this write, is the event worth recording. The supervisor did not
            // kill it, so the exit keeps its own cause rather than becoming an
            // unresponsive window, whichever side of the exit the write fell.
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => {
                window.stdin = None;
                return;
            }
            Ok(Err(error)) => self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                format!("could not write to the window: {error}"),
            )),
            Err(_) => self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                "the window stopped reading messages".to_owned(),
            )),
        }
        window.stdin = None;
        window.kill_because(WindowCrashCause::Unresponsive);
    }

    async fn close(&self, mut window: Window) {
        self.deliver(&mut window, &SupervisorMessage::Close).await;
        window.stdin = None;
        if tokio::time::timeout(CLOSE_TIMEOUT, window.child.wait())
            .await
            .is_err()
        {
            window.kill();
            if let Err(error) = window.child.wait().await {
                tracing::warn!(%error, "could not reap the Scout Client window");
            }
        }
    }

    fn record(&self, event: DiagnosticEvent) {
        self.collector.diagnostics().record(event);
    }

    /// The product event for a crash; whether it is sent is the usage-data
    /// switch's decision, made where events are sent.
    fn report_crash(&self, cause: WindowCrashCause, outcome: WindowCrashOutcome) {
        self.collector
            .report_usage(UsageEvent::WindowCrashed { cause, outcome });
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Handled {
    Continue,
    Quit,
}

enum AfterExit {
    Relaunch,
    Wait,
    Quit,
}

struct Window {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Option<Lines<BufReader<ChildStdout>>>,
    started: Instant,
    greeted: bool,
    /// Cleared when relaunching could only repeat the failure.
    relaunch: bool,
    /// Why the supervisor killed it, when it did; otherwise it exited alone.
    cause: Option<WindowCrashCause>,
    last_state: Option<StateSnapshot>,
    /// The live game this window holds. A new window holds none.
    last_live: Option<LiveGameSnapshot>,
    /// The chat parts this window holds, so a change sends only its delta.
    last_chat: Option<ChatParts>,
    /// The voice state and spoken turn this window holds.
    last_voice: Option<VoiceParts>,
}

/// What a window was last told about voice.
#[derive(Debug, Clone, PartialEq, Eq)]
struct VoiceParts {
    snapshot: VoiceSnapshot,
    turn: Option<VoiceTurnView>,
}

/// Both voice subscriptions, so one `select!` branch follows them.
struct VoiceWatch {
    snapshot: watch::Receiver<VoiceSnapshot>,
    turn: watch::Receiver<Option<VoiceTurnView>>,
}

impl VoiceWatch {
    fn new(voice: &VoiceHandle) -> Self {
        Self {
            snapshot: voice.snapshot(),
            turn: voice.turn(),
        }
    }

    /// The next change to either, or pending forever without voice. `false`
    /// once voice has stopped, which happens only as Scout quits.
    async fn changed(watch: &mut Option<Self>) -> bool {
        let Some(watch) = watch.as_mut() else {
            return std::future::pending().await;
        };
        tokio::select! {
            changed = watch.snapshot.changed() => changed.is_ok(),
            changed = watch.turn.changed() => changed.is_ok(),
        }
    }
}

impl Window {
    fn kill_because(&mut self, cause: WindowCrashCause) {
        self.cause.get_or_insert(cause);
        self.kill();
    }

    fn kill(&mut self) {
        if let Err(error) = self.child.start_kill() {
            tracing::warn!(%error, "could not kill the Scout Client window");
        }
    }
}

enum WindowEvent {
    Message(WindowMessage),
    Unreadable(String),
    Exited(ExitStatus),
}

/// The window's next message, or its exit once its stdout closes. Pending
/// forever when no window runs. Both awaited futures are cancel-safe, so a
/// `select!` losing this branch drops nothing.
async fn next_event(window: &mut Option<Window>) -> WindowEvent {
    let Some(window) = window.as_mut() else {
        return std::future::pending().await;
    };
    if let Some(lines) = window.lines.as_mut() {
        match lines.next_line().await {
            Ok(Some(line)) => {
                return match decode_line::<WindowMessage>(&line) {
                    Ok(message) => WindowEvent::Message(message),
                    Err(error) => WindowEvent::Unreadable(error.to_string()),
                };
            }
            Ok(None) => window.lines = None,
            Err(error) => {
                window.lines = None;
                return WindowEvent::Unreadable(format!("could not read the window: {error}"));
            }
        }
    }
    match window.child.wait().await {
        Ok(status) => WindowEvent::Exited(status),
        Err(error) => {
            tracing::warn!(%error, "could not wait for the Scout Client window");
            std::future::pending().await
        }
    }
}

/// The next change to the update state, or pending forever when this build has
/// no updater. `false` if the updater ended, which never happens while the
/// supervisor holds its handle.
async fn update_changed(receiver: &mut Option<watch::Receiver<UpdateSnapshot>>) -> bool {
    match receiver {
        Some(receiver) => receiver.changed().await.is_ok(),
        None => std::future::pending().await,
    }
}

/// Whether the device is paired, and whether an approval is pending.
fn pairing_key(state: &RuntimeState) -> (bool, bool) {
    (state.paired, state.approval_url.is_some())
}

/// The next change to the chat parts, or pending forever without chat.
async fn parts_changed(receiver: &mut Option<watch::Receiver<ChatParts>>) -> bool {
    match receiver {
        Some(receiver) => receiver.changed().await.is_ok(),
        None => std::future::pending().await,
    }
}

fn open_web_page(url: &str) {
    match url::Url::parse(url) {
        Ok(parsed) if matches!(parsed.scheme(), "http" | "https") => {
            if let Err(error) = open::that_detached(parsed.as_str()) {
                tracing::warn!(%error, "could not open a Scout web page");
            }
        }
        _ => tracing::warn!("the window asked to open a URL that is not a web page"),
    }
}

/// The window's view of the runtime. `overlay_available` is whether this
/// supervisor runs the in-game overlay, which decides whether exclusive
/// fullscreen is worth a warning.
#[must_use]
pub fn snapshot(
    state: &RuntimeState,
    diagnostics: &Diagnostics,
    log_folder_available: bool,
    overlay_available: bool,
) -> StateSnapshot {
    StateSnapshot {
        league_connected: state.league_connected,
        gameflow_phase: state.gameflow_phase.clone(),
        account_label: state.account_label.clone(),
        paired: state.paired,
        start_at_login: state.start_at_login,
        privacy: PrivacySnapshot {
            send_error_reports: state.privacy.send_error_reports,
            send_usage_data: state.privacy.send_usage_data,
        },
        pairing_status: state.pairing_status.clone(),
        approval_url: state.approval_url.clone(),
        pairing_match_code: state.pairing_match_code.clone(),
        pending_observations: u64::try_from(state.pending_observations).unwrap_or(u64::MAX),
        last_upload_at: state.last_upload_at.clone(),
        last_error: state.last_error.clone(),
        overlay_warning: (overlay_available
            && state.game_window_mode == Some(GameWindowMode::Fullscreen))
        .then_some(OverlayWarning::ExclusiveFullscreen),
        diagnostics: DiagnosticsSnapshot {
            log_folder_available,
            counters: diagnostics
                .counters()
                .readings()
                .into_iter()
                .map(|(name, value)| CounterReading {
                    name: name.to_owned(),
                    value,
                })
                .collect(),
            recent_events: diagnostics
                .recent(RECENT_EVENT_ROWS)
                .iter()
                .map(DiagnosticEvent::summary)
                .collect(),
        },
    }
}

/// The window's one-line view of the game in progress. It reads the local
/// player out of the allowlisted snapshot; nothing else of it is forwarded.
fn live_game_snapshot(state: &RuntimeState) -> Option<LiveGameSnapshot> {
    let live = state.live_game.as_ref()?;
    let local = live.local()?;
    Some(LiveGameSnapshot {
        game_time_secs: live.game.game_time_secs,
        champion: local.champion.clone(),
        level: local.level,
        kills: local.kills,
        deaths: local.deaths,
        assists: local.assists,
        creep_score: local.creep_score,
    })
}

fn phase_message(phase: &GameflowPhase) -> SupervisorMessage {
    use scout_desktop_ipc::GameflowPhase as Wire;
    let phase = match phase {
        GameflowPhase::Disconnected => Wire::Disconnected,
        GameflowPhase::None => Wire::None,
        GameflowPhase::Lobby => Wire::Lobby,
        GameflowPhase::Matchmaking => Wire::Matchmaking,
        GameflowPhase::CheckedIntoTournament => Wire::CheckedIntoTournament,
        GameflowPhase::ReadyCheck => Wire::ReadyCheck,
        GameflowPhase::ChampSelect => Wire::ChampSelect,
        GameflowPhase::GameStart => Wire::GameStart,
        GameflowPhase::FailedToLaunch => Wire::FailedToLaunch,
        GameflowPhase::InProgress => Wire::InProgress,
        GameflowPhase::Reconnect => Wire::Reconnect,
        GameflowPhase::WaitingForStats => Wire::WaitingForStats,
        GameflowPhase::PreEndOfGame => Wire::PreEndOfGame,
        GameflowPhase::EndOfGame => Wire::EndOfGame,
        GameflowPhase::TerminatedInError => Wire::TerminatedInError,
        GameflowPhase::Unrecognized(label) => Wire::Unrecognized(label.clone()),
    };
    SupervisorMessage::Phase { phase }
}

fn review_event(
    level: DiagnosticLevel,
    outcome: DiagnosticOutcome,
    detail: String,
) -> DiagnosticEvent {
    DiagnosticEvent::new(level, DiagnosticCategory::Runtime, "coach_review", outcome)
        .with_detail(detail)
}

/// The review poller, its source, and the channel answers come back on.
struct Reviews {
    poller: ReviewPoller,
    source: Box<dyn ReviewSource>,
    done: mpsc::UnboundedSender<ReviewFetch>,
    answers: mpsc::UnboundedReceiver<ReviewFetch>,
}

impl Reviews {
    fn new(source: Box<dyn ReviewSource>) -> Self {
        let (done, answers) = mpsc::unbounded_channel();
        Self {
            poller: ReviewPoller::default(),
            source,
            done,
            answers,
        }
    }

    /// Follow the newest finished game and ask about its review when due.
    fn tick(&mut self, state: &RuntimeState) {
        let now = Instant::now();
        self.poller.follow(review::finished_match_id(state), now);
        if let Some(match_id) = self.poller.due(now) {
            self.source.fetch(match_id, self.done.clone());
        }
    }

    fn settle(&mut self, match_id: &str, answer: review::ReviewAnswer) -> Option<ReviewEvent> {
        self.poller.settle(match_id, answer, Instant::now())
    }

    /// The next answer, or pending forever without reviews. Cancel-safe.
    async fn next(reviews: &mut Option<Self>) -> Option<ReviewFetch> {
        match reviews.as_mut() {
            Some(reviews) => reviews.answers.recv().await,
            None => std::future::pending().await,
        }
    }
}

fn window_crash_event(outcome: DiagnosticOutcome, detail: String) -> DiagnosticEvent {
    DiagnosticEvent::new(
        DiagnosticLevel::Critical,
        DiagnosticCategory::Runtime,
        "window_crash",
        outcome,
    )
    .with_detail(detail)
}

mod coach;
mod overlay;
#[cfg(scout_proactive_coach)]
mod proactive;
mod review;
#[cfg(test)]
mod tests;
