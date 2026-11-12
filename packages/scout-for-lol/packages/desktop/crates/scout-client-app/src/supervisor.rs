//! The GPU-free supervisor: owns collection and runs the window as a child.
//!
//! Graphics devices get lost on Windows (sleep/resume, a driver reset, a
//! hybrid-GPU switch), and that can abort the process outright rather than
//! unwind. So the process that reads the League client and holds the outbox
//! never renders: it spawns this same executable with `--window`, talks to it
//! over the child's stdio in `scout-desktop-ipc` JSON lines, and relaunches it
//! when it dies.

use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_runtime::runtime::{
    ClientRuntime, GameflowPhase, PhaseReceiver, RuntimeState, StateReceiver,
};
use scout_desktop_ipc::{
    CounterReading, DiagnosticsSnapshot, PROTOCOL_VERSION, StateSnapshot, SupervisorMessage,
    WindowMessage, check_protocol, decode_line, encode_line,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, watch};

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
            _instance_lock: instance_lock,
        }
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
        let mut refresh = tokio::time::interval(REFRESH);
        refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let exit = loop {
            tokio::select! {
                control = self.control.recv() => match control {
                    Some(Control::OpenWindow) => {
                        if let Some(running) = window.as_mut() {
                            self.deliver(running, &SupervisorMessage::Show).await;
                        } else {
                            // An explicit open is a fresh start, not a
                            // continuation of a crash loop.
                            quick_crashes = 0;
                            self.status.send_modify(|status| status.given_up = false);
                            window = self.launch(&state, &phase).await;
                        }
                    }
                    Some(Control::Quit) => break SupervisorExit::Quit,
                    None => break SupervisorExit::ControlClosed,
                },
                event = next_event(&mut window) => match event {
                    WindowEvent::Message(message) => {
                        if let Some(running) = window.as_mut()
                            && self.handle(running, message).await == Handled::Quit
                        {
                            break SupervisorExit::Quit;
                        }
                    }
                    WindowEvent::Unreadable(detail) => {
                        if let Some(running) = window.as_mut() {
                            self.record(window_crash_event(DiagnosticOutcome::Failed, detail));
                            running.kill();
                        }
                    }
                    WindowEvent::Exited(status) => {
                        let Some(ended) = window.take() else { continue };
                        self.status.send_modify(|status| status.running = false);
                        match self.after_exit(&ended, status, &mut quick_crashes) {
                            AfterExit::Relaunch => window = self.launch(&state, &phase).await,
                            AfterExit::Wait => {}
                            AfterExit::Quit => break SupervisorExit::WindowClosedWithoutTray,
                        }
                    }
                },
                Ok(()) = state.changed() => {
                    if let Some(running) = window.as_mut() {
                        self.send_state(running, &state).await;
                    }
                }
                Ok(()) = phase.changed() => {
                    if let Some(running) = window.as_mut() {
                        let message = phase_message(&phase.borrow_and_update());
                        self.deliver(running, &message).await;
                    }
                }
                _ = refresh.tick() => {
                    if let Some(running) = window.as_mut() {
                        self.send_state(running, &state).await;
                    }
                }
            }
        };
        if let Some(running) = window.take() {
            self.close(running).await;
        }
        self.status.send_modify(|status| status.running = false);
        self.collector.stop();
        exit
    }

    async fn launch(&self, state: &StateReceiver, phase: &PhaseReceiver) -> Option<Window> {
        let mut child = match self.launcher.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.record(window_crash_event(
                    DiagnosticOutcome::Failed,
                    format!("could not start the window: {error}"),
                ));
                return None;
            }
        };
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            self.record(window_crash_event(
                DiagnosticOutcome::Failed,
                "the window started without piped stdio".to_owned(),
            ));
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
            last_state: None,
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
                window.kill();
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
            window.kill();
            return Handled::Continue;
        }
        match message {
            WindowMessage::Hello { .. } => {}
            WindowMessage::Pair => self.collector.start_pairing(),
            WindowMessage::Disconnect => self.collector.disconnect(),
            WindowMessage::SetStartAtLogin { enabled } => {
                self.collector.set_start_at_login(enabled);
            }
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
            WindowMessage::Quit => return Handled::Quit,
        }
        Handled::Continue
    }

    fn after_exit(&self, ended: &Window, status: ExitStatus, quick_crashes: &mut u32) -> AfterExit {
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
            return AfterExit::Wait;
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
            return AfterExit::Wait;
        }
        self.record(window_crash_event(
            DiagnosticOutcome::Deferred,
            format!("the window exited ({status}); relaunching it"),
        ));
        AfterExit::Relaunch
    }

    async fn send_state(&self, window: &mut Window, state: &StateReceiver) {
        let snapshot = snapshot(
            &state.borrow(),
            self.collector.diagnostics(),
            self.collector.log_directory().is_some(),
        );
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

    /// Write one message. A window that cannot take it is treated as crashed:
    /// it is killed, and its exit is handled like any other.
    async fn deliver(&self, window: &mut Window, message: &SupervisorMessage) {
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
            // this write, is the event worth recording.
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => {}
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
        window.kill();
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
    last_state: Option<StateSnapshot>,
}

impl Window {
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

/// The window's view of the runtime.
#[must_use]
pub fn snapshot(
    state: &RuntimeState,
    diagnostics: &Diagnostics,
    log_folder_available: bool,
) -> StateSnapshot {
    StateSnapshot {
        league_connected: state.league_connected,
        gameflow_phase: state.gameflow_phase.clone(),
        account_label: state.account_label.clone(),
        paired: state.paired,
        start_at_login: state.start_at_login,
        pairing_status: state.pairing_status.clone(),
        approval_url: state.approval_url.clone(),
        pending_observations: u64::try_from(state.pending_observations).unwrap_or(u64::MAX),
        last_upload_at: state.last_upload_at.clone(),
        last_error: state.last_error.clone(),
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

fn window_crash_event(outcome: DiagnosticOutcome, detail: String) -> DiagnosticEvent {
    DiagnosticEvent::new(
        DiagnosticLevel::Critical,
        DiagnosticCategory::Runtime,
        "window_crash",
        outcome,
    )
    .with_detail(detail)
}

#[cfg(test)]
mod tests;
