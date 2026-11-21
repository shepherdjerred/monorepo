use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::settings::PrivacySettings;
use scout_client_core::telemetry::{UsageEvent, WindowCrashCause, WindowCrashOutcome};
use scout_client_runtime::instance::{InstanceLock, InstanceLockError};
use scout_client_runtime::runtime::{GameflowPhase, PhaseReceiver, RuntimeState, StateReceiver};
use scout_desktop_ipc::{ChatCommand, ChatTurn, PROTOCOL_VERSION, SupervisorMessage};
use scout_explore_client::app_turns::CoachInput;
use scout_explore_client::relay::{ChatRelay, DetachedRelay, RelayCommand};
use tokio::sync::{mpsc, watch};

use crate::updater::policy::UpdateConfig;
use crate::updater::service::{UpdateHandle, UpdateService};
use crate::updater::testing::{FakeUpdater, available, version};

use super::{
    Collector, Control, MAX_QUICK_CRASHES, STABLE_RUN, Supervisor, SupervisorExit, Window,
    WindowLauncher, WindowStatus, quick_crashes_now,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const PATIENCE: Duration = Duration::from_secs(20);

#[test]
fn the_third_quick_crash_is_the_last() {
    // A window started without a count crashes, relaunches, crashes,
    // relaunches, and stops on its third crash.
    let soon = Duration::from_secs(30);
    let first = quick_crashes_now(0, soon);
    let second = quick_crashes_now(first, soon);
    let third = quick_crashes_now(second, soon);
    assert_eq!([first, second, third], [1, 2, MAX_QUICK_CRASHES]);
    assert!(second < MAX_QUICK_CRASHES);
}

#[test]
fn a_crash_after_a_stable_run_starts_the_count_over() {
    assert_eq!(quick_crashes_now(MAX_QUICK_CRASHES - 1, STABLE_RUN), 1);
}

/// A collector that records what the supervisor asked of it.
struct FakeCollector {
    state: Arc<watch::Sender<RuntimeState>>,
    phase: Arc<watch::Sender<GameflowPhase>>,
    diagnostics: Arc<Diagnostics>,
    calls: Arc<Mutex<Vec<String>>>,
    usage: Arc<Mutex<Vec<UsageEvent>>>,
}

type Collected = (
    FakeCollector,
    Arc<Mutex<Vec<String>>>,
    Arc<Diagnostics>,
    Arc<Mutex<Vec<UsageEvent>>>,
);

impl FakeCollector {
    fn new() -> Collected {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let usage = Arc::new(Mutex::new(Vec::new()));
        let diagnostics = Arc::new(Diagnostics::in_memory());
        let collector = Self {
            state: Arc::new(watch::channel(RuntimeState::default()).0),
            phase: Arc::new(watch::channel(GameflowPhase::default()).0),
            diagnostics: Arc::clone(&diagnostics),
            calls: Arc::clone(&calls),
            usage: Arc::clone(&usage),
        };
        (collector, calls, diagnostics, usage)
    }

    fn senders(
        &self,
    ) -> (
        Arc<watch::Sender<RuntimeState>>,
        Arc<watch::Sender<GameflowPhase>>,
    ) {
        (Arc::clone(&self.state), Arc::clone(&self.phase))
    }

    fn call(&self, name: &str) {
        self.calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(name.to_owned());
    }
}

impl Collector for FakeCollector {
    fn state(&self) -> StateReceiver {
        self.state.subscribe()
    }
    fn gameflow_phase(&self) -> PhaseReceiver {
        self.phase.subscribe()
    }
    fn diagnostics(&self) -> &Arc<Diagnostics> {
        &self.diagnostics
    }
    fn log_directory(&self) -> Option<&Path> {
        None
    }
    fn start_pairing(&self) {
        self.call("pair");
    }
    fn disconnect(&self) {
        self.call("disconnect");
    }
    fn set_start_at_login(&self, enabled: bool) {
        self.call(&format!("start_at_login={enabled}"));
    }
    fn set_privacy_settings(&self, settings: PrivacySettings) {
        self.call(&format!(
            "privacy=errors:{},usage:{}",
            settings.send_error_reports, settings.send_usage_data
        ));
    }
    fn report_usage(&self, event: UsageEvent) {
        self.usage
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(event);
    }
    fn stop(self) {
        self.call("stop");
    }
}

fn calls(calls: &Mutex<Vec<String>>) -> Vec<String> {
    calls.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

fn crash_details(diagnostics: &Diagnostics) -> Vec<String> {
    diagnostics
        .events()
        .iter()
        .map(scout_client_core::diagnostics::DiagnosticEvent::summary)
        .filter(|summary| summary.contains("window_crash"))
        .collect()
}

/// A window stub: greets, then waits for `close` (or a closed stdin) and exits
/// cleanly. `before` runs between the greeting and the wait.
fn window_script(before: &str) -> String {
    format!(
        r#"printf '{{"type":"hello","protocol":{PROTOCOL_VERSION}}}\n'
{before}
while IFS= read -r line; do
  case "$line" in *'"type":"close"'*) exit 0 ;; esac
done
exit 0"#
    )
}

/// A window stub that greets and exits cleanly.
fn hello_only() -> String {
    format!(r#"printf '{{"type":"hello","protocol":{PROTOCOL_VERSION}}}\n'"#)
}

fn sh(script: &str, extra: &[&str]) -> WindowLauncher {
    let mut arguments = vec!["-c".to_owned(), script.to_owned(), "sh".to_owned()];
    arguments.extend(extra.iter().map(|argument| (*argument).to_owned()));
    WindowLauncher::new(PathBuf::from("sh"), arguments)
}

fn scratch_directory() -> Result<PathBuf, std::io::Error> {
    let directory = std::env::temp_dir().join(format!("scout-supervisor-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory)?;
    Ok(directory)
}

struct Harness {
    control: mpsc::UnboundedSender<Control>,
    status: watch::Receiver<WindowStatus>,
    run: tokio::task::JoinHandle<SupervisorExit>,
    calls: Arc<Mutex<Vec<String>>>,
    usage: Arc<Mutex<Vec<UsageEvent>>>,
    diagnostics: Arc<Diagnostics>,
    directory: PathBuf,
    runtime_state: Arc<watch::Sender<RuntimeState>>,
    phase: Arc<watch::Sender<GameflowPhase>>,
}

fn start(
    launcher: WindowLauncher,
    tray_available: bool,
    open_window: bool,
) -> Result<Harness, Box<dyn std::error::Error>> {
    start_with(
        launcher,
        tray_available,
        open_window,
        None,
        GameflowPhase::default(),
    )
}

fn start_with(
    launcher: WindowLauncher,
    tray_available: bool,
    open_window: bool,
    updates: Option<UpdateHandle>,
    phase: GameflowPhase,
) -> Result<Harness, Box<dyn std::error::Error>> {
    start_configured(
        launcher,
        tray_available,
        open_window,
        phase,
        |supervisor| match updates {
            Some(updates) => supervisor.with_updates(updates),
            None => supervisor,
        },
    )
}

fn start_configured(
    launcher: WindowLauncher,
    tray_available: bool,
    open_window: bool,
    phase: GameflowPhase,
    configure: impl FnOnce(Supervisor<FakeCollector>) -> Supervisor<FakeCollector>,
) -> Result<Harness, Box<dyn std::error::Error>> {
    let directory = scratch_directory()?;
    let lock = InstanceLock::acquire_in(&directory)?;
    let (collector, calls, diagnostics, usage) = FakeCollector::new();
    let (runtime_state, phase_sender) = collector.senders();
    phase_sender.send_replace(phase);
    let (control, receiver) = mpsc::unbounded_channel();
    let supervisor = configure(Supervisor::new(
        lock,
        collector,
        launcher,
        receiver,
        tray_available,
        open_window,
    ));
    let status = supervisor.status();
    let run = tokio::spawn(supervisor.run());
    Ok(Harness {
        control,
        status,
        run,
        calls,
        usage,
        diagnostics,
        directory,
        runtime_state,
        phase: phase_sender,
    })
}

impl Harness {
    async fn wait_for(
        &mut self,
        condition: impl FnMut(&WindowStatus) -> bool,
    ) -> Result<WindowStatus, Box<dyn std::error::Error>> {
        let status = tokio::time::timeout(PATIENCE, self.status.wait_for(condition)).await??;
        Ok(*status)
    }

    async fn finish(
        self,
    ) -> Result<(SupervisorExit, Vec<String>, Arc<Diagnostics>, PathBuf), Box<dyn std::error::Error>>
    {
        let exit = tokio::time::timeout(PATIENCE, self.run).await??;
        Ok((exit, calls(&self.calls), self.diagnostics, self.directory))
    }
}

#[cfg(unix)]
#[tokio::test]
async fn an_abnormal_exit_relaunches_the_window() -> TestResult {
    let scratch = scratch_directory()?;
    let marker = scratch.join("crashed-once");
    let marker = marker.to_str().ok_or("scratch path is not Unicode")?;
    // The first window crashes; the relaunched one behaves.
    let script = format!(
        "if [ -e \"$1\" ]; then\n{}\nelse : > \"$1\"; exit 9; fi",
        window_script("")
    );
    let mut harness = start(sh(&script, &[marker]), true, true)?;

    let status = harness
        .wait_for(|status| status.launches == 2 && status.running)
        .await?;
    assert!(!status.given_up);
    assert!(
        !harness.run.is_finished(),
        "a window crash never ends the supervisor"
    );

    harness.control.send(Control::Quit)?;
    let (exit, calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(calls, ["stop"]);
    let crashes = crash_details(&diagnostics);
    assert_eq!(crashes.len(), 1, "{crashes:?}");
    assert!(crashes[0].contains("relaunching it"), "{crashes:?}");
    std::fs::remove_dir_all(directory)?;
    std::fs::remove_dir_all(scratch)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn quick_crashes_stop_relaunching_after_the_limit() -> TestResult {
    let mut harness = start(sh("exit 3", &[]), true, true)?;

    let status = harness.wait_for(|status| status.given_up).await?;
    assert_eq!(status.launches, MAX_QUICK_CRASHES);
    assert!(!status.running);
    // Giving up on the window is not giving up on collection.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!harness.run.is_finished());
    assert_eq!(harness.status.borrow().launches, MAX_QUICK_CRASHES);
    let crashes = crash_details(&harness.diagnostics);
    assert_eq!(
        crashes.len(),
        usize::try_from(MAX_QUICK_CRASHES)?,
        "{crashes:?}"
    );
    assert!(
        crashes
            .iter()
            .any(|crash| crash.contains("not relaunching after 3 quick crashes")),
        "{crashes:?}"
    );

    // Opening from the tray is a fresh start.
    harness.control.send(Control::OpenWindow)?;
    harness
        .wait_for(|status| status.launches > MAX_QUICK_CRASHES)
        .await?;

    harness.control.send(Control::Quit)?;
    let (exit, calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(calls, ["stop"]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

fn crash_events(usage: &Mutex<Vec<UsageEvent>>) -> Vec<UsageEvent> {
    usage.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

#[cfg(unix)]
#[tokio::test]
async fn window_crashes_become_bounded_usage_events() -> TestResult {
    // Three quick exits: relaunched twice, then given up on.
    let mut harness = start(sh("exit 3", &[]), true, true)?;
    harness.wait_for(|status| status.given_up).await?;
    let events = crash_events(&harness.usage);
    let crash = |outcome| UsageEvent::WindowCrashed {
        cause: WindowCrashCause::Exited,
        outcome,
    };
    assert_eq!(
        events,
        [
            crash(WindowCrashOutcome::Relaunched),
            crash(WindowCrashOutcome::Relaunched),
            crash(WindowCrashOutcome::GaveUp),
        ]
    );
    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// Greets a window whose process has already exited and been waited for, and
/// returns the window to inspect. Waiting for the exit first makes the "after
/// the exit" side of the greeting race certain.
#[cfg(unix)]
async fn greet_an_exited_window() -> Result<Window, Box<dyn std::error::Error>> {
    let directory = scratch_directory()?;
    let (collector, _calls, _diagnostics, _usage) = FakeCollector::new();
    let launcher = sh("exit 3", &[]);
    let mut child = launcher.spawn()?;
    let stdin = child.stdin.take();
    child.wait().await?;
    let mut window = Window {
        child,
        stdin,
        lines: None,
        started: Instant::now(),
        greeted: false,
        relaunch: true,
        cause: None,
        last_state: None,
        last_live: None,
        last_chat: None,
        last_voice: None,
    };
    let (_control, receiver) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        InstanceLock::acquire_in(&directory)?,
        collector,
        launcher,
        receiver,
        true,
        true,
    );
    supervisor
        .deliver(
            &mut window,
            &SupervisorMessage::Hello {
                protocol: PROTOCOL_VERSION,
                tray_available: true,
            },
        )
        .await;
    drop(supervisor);
    std::fs::remove_dir_all(directory)?;
    Ok(window)
}

#[cfg(unix)]
#[tokio::test]
async fn a_write_to_a_window_that_already_exited_does_not_blame_the_supervisor() -> TestResult {
    // Whether the greeting lands before or after a quick exit is a race the
    // supervisor cannot win, so it must not change the crash's cause.
    let window = greet_an_exited_window().await?;
    assert!(window.stdin.is_none());
    assert_eq!(window.cause, None);
    Ok(())
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_exited_window_is_recognised_while_other_processes_launch() -> TestResult {
    // A process forked elsewhere inherits every open pipe until it execs, so an
    // exited window's pipe can keep a reader and accept a write. Launching
    // processes continuously around the greeting makes that overlap routine;
    // the exit status, not the write, must decide.
    let launching = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let launcher = {
        let launching = Arc::clone(&launching);
        std::thread::spawn(move || {
            while launching.load(std::sync::atomic::Ordering::Relaxed) {
                if let Ok(mut child) = std::process::Command::new("true")
                    .stdin(std::process::Stdio::piped())
                    .spawn()
                {
                    let _ = child.wait();
                }
            }
        })
    };
    let mut outcome = Ok(());
    for _ in 0..500 {
        let window = greet_an_exited_window().await?;
        if window.stdin.is_some() || window.cause.is_some() {
            outcome = Err("a window that had exited kept its pipe or a cause");
            break;
        }
    }
    launching.store(false, std::sync::atomic::Ordering::Relaxed);
    launcher
        .join()
        .map_err(|_| "the launching thread panicked")?;
    outcome?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn a_protocol_mismatch_is_reported_with_its_own_cause() -> TestResult {
    let script =
        "printf '{\"type\":\"hello\",\"protocol\":999}\\n'; while read -r line; do :; done";
    let mut harness = start(sh(script, &[]), true, true)?;
    harness
        .wait_for(|status| status.launches == 1 && !status.running)
        .await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        crash_events(&harness.usage),
        [UsageEvent::WindowCrashed {
            cause: WindowCrashCause::ProtocolMismatch,
            outcome: WindowCrashOutcome::NotRelaunched,
        }]
    );
    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn the_window_can_change_the_privacy_switches() -> TestResult {
    let script = window_script(
        r#"printf '{"type":"set_privacy","send_error_reports":false,"send_usage_data":true}\n'
printf '{"type":"quit"}\n'"#,
    );
    let harness = start(sh(&script, &[]), true, true)?;
    let (exit, calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(calls, ["privacy=errors:false,usage:true", "stop"]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn quick_crashes_without_a_tray_exit_instead_of_waiting() -> TestResult {
    // With no tray nothing could reopen the window or quit, and the instance
    // lock would keep a second launch out.
    let harness = start(sh("exit 3", &[]), false, true)?;
    let (exit, calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::WindowClosedWithoutTray);
    assert_eq!(calls, ["stop"]);
    assert!(
        crash_details(&diagnostics)
            .iter()
            .any(|crash| crash.contains("not relaunching after 3 quick crashes"))
    );
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn quit_from_the_window_stops_everything() -> TestResult {
    let script = window_script(
        r#"printf '{"type":"pair"}\n'
printf '{"type":"set_start_at_login","enabled":true}\n'
printf '{"type":"quit"}\n'"#,
    );
    let harness = start(sh(&script, &[]), true, true)?;

    let (exit, calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(calls, ["pair", "start_at_login=true", "stop"]);
    assert_eq!(crash_details(&diagnostics), Vec::<String>::new());
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn quit_from_the_tray_closes_the_window() -> TestResult {
    let mut harness = start(sh(&window_script(""), &[]), true, true)?;
    harness.wait_for(|status| status.running).await?;

    harness.control.send(Control::Quit)?;
    let mut status = harness.status.clone();
    let (exit, calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(calls, ["stop"]);
    assert!(!status.borrow_and_update().running);
    assert!(
        crash_details(&diagnostics).is_empty(),
        "the window closed when asked"
    );
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn closing_the_window_keeps_collecting_while_a_tray_can_reopen_it() -> TestResult {
    // The stub greets and exits cleanly, as a window does when its close
    // button is pressed.
    let mut harness = start(sh(&hello_only(), &[]), true, true)?;
    harness
        .wait_for(|status| status.launches == 1 && !status.running)
        .await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!harness.run.is_finished());
    assert_eq!(
        harness.status.borrow().launches,
        1,
        "a clean exit is not relaunched"
    );

    harness.control.send(Control::OpenWindow)?;
    harness.wait_for(|status| status.launches == 2).await?;
    harness.control.send(Control::Quit)?;
    let (exit, _calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(crash_details(&diagnostics), Vec::<String>::new());
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn closing_the_only_window_without_a_tray_quits() -> TestResult {
    // `--background` is ignored without a tray: nothing else could open it.
    let harness = start(sh(&hello_only(), &[]), false, false)?;
    let (exit, calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::WindowClosedWithoutTray);
    assert_eq!(calls, ["stop"]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn background_starts_without_a_window_until_the_tray_opens_one() -> TestResult {
    let mut harness = start(sh(&window_script(""), &[]), true, false)?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(harness.status.borrow().launches, 0);

    harness.control.send(Control::OpenWindow)?;
    harness.wait_for(|status| status.running).await?;
    // "Open" on a running window shows it rather than starting a second.
    harness.control.send(Control::OpenWindow)?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(harness.status.borrow().launches, 1);

    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn a_protocol_mismatch_is_not_relaunched() -> TestResult {
    let script =
        "printf '{\"type\":\"hello\",\"protocol\":999}\\n'; while read -r line; do :; done";
    let mut harness = start(sh(script, &[]), true, true)?;
    harness
        .wait_for(|status| status.launches == 1 && !status.running)
        .await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(harness.status.borrow().launches, 1);
    let crashes = crash_details(&harness.diagnostics);
    assert!(
        crashes
            .iter()
            .any(|crash| crash.contains("protocol mismatch")),
        "{crashes:?}"
    );
    assert!(
        crashes
            .iter()
            .any(|crash| crash.contains("not relaunching")),
        "{crashes:?}"
    );

    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn an_unknown_message_is_treated_as_a_crash() -> TestResult {
    let script = format!(
        r#"printf '{{"type":"hello","protocol":{PROTOCOL_VERSION}}}\n{{"type":"format_disk"}}\n'; while read -r line; do :; done"#
    );
    let mut harness = start(sh(&script, &[]), true, true)?;
    let status = harness.wait_for(|status| status.given_up).await?;
    assert_eq!(status.launches, MAX_QUICK_CRASHES);
    let crashes = crash_details(&harness.diagnostics);
    assert!(
        crashes
            .iter()
            .any(|crash| crash.contains("invalid Scout desktop IPC message")),
        "{crashes:?}"
    );

    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn the_supervisor_holds_the_instance_lock_for_its_life() -> TestResult {
    let mut harness = start(sh(&window_script(""), &[]), true, true)?;
    harness.wait_for(|status| status.running).await?;

    let second = InstanceLock::acquire_in(&harness.directory);
    assert!(matches!(second, Err(InstanceLockError::AlreadyRunning(_))));

    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    // Tests in this binary spawn children in parallel, and a child forked by
    // another test holds every descriptor (this lock included) until it
    // execs. That window is brief; a lock still held after it is a real leak.
    let mut again = InstanceLock::acquire_in(&directory);
    for _ in 0..50 {
        if again.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        again = InstanceLock::acquire_in(&directory);
    }
    assert!(
        again.is_ok(),
        "the lock is released when the supervisor ends: {again:?}"
    );
    drop(again);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// An update that is checked at once, and installed as soon as the app is idle.
const IMMEDIATE: UpdateConfig = UpdateConfig {
    first_check_delay: Duration::ZERO,
    check_interval: Duration::from_hours(6),
    idle_install_after: Duration::ZERO,
};

/// An updater that does nothing until it is told to.
const WAITING: UpdateConfig = UpdateConfig {
    first_check_delay: Duration::from_hours(24),
    check_interval: Duration::from_hours(24),
    idle_install_after: Duration::ZERO,
};

fn updates(updater: &Arc<FakeUpdater>, config: UpdateConfig) -> UpdateHandle {
    UpdateService::start(
        Arc::clone(updater),
        config,
        version("0.1.0"),
        Arc::new(Diagnostics::in_memory()),
    )
}

async fn staged(handle: &UpdateHandle) -> TestResult {
    let mut status = handle.subscribe();
    tokio::time::timeout(
        PATIENCE,
        status.wait_for(|status| status.status == scout_desktop_ipc::UpdateStatus::Ready),
    )
    .await??;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn a_426_from_the_backend_triggers_an_update_check_at_once() -> TestResult {
    let updater = FakeUpdater::offering(Some(available("0.2.0", true)));
    let handle = updates(&updater, WAITING);
    let mut harness = start_with(
        sh(&window_script(""), &[]),
        true,
        true,
        Some(handle.clone()),
        GameflowPhase::default(),
    )?;
    harness.wait_for(|status| status.running).await?;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(updater.checks(), 0, "nothing is due for a day");

    harness
        .runtime_state
        .send_modify(|state| state.upgrade_required = Some("0.2.0".to_owned()));
    staged(&handle).await?;
    assert_eq!(updater.checks(), 1);

    harness.control.send(Control::Quit)?;
    let (_exit, _calls, _diagnostics, directory) = harness.finish().await?;
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn an_idle_supervisor_installs_a_staged_update_and_hands_over() -> TestResult {
    let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
    let handle = updates(&updater, IMMEDIATE);
    staged(&handle).await?;
    // The window is closed: tray-only, nothing in the way.
    let harness = start_with(
        sh(&window_script(""), &[]),
        true,
        false,
        Some(handle),
        GameflowPhase::default(),
    )?;

    let (exit, calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Updating);
    assert_eq!(
        calls,
        ["stop"],
        "collection stops cleanly before the handover"
    );
    assert_eq!(updater.installs(), [(version("0.2.0"), true)]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn an_open_window_keeps_an_idle_install_waiting() -> TestResult {
    let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
    let handle = updates(&updater, IMMEDIATE);
    staged(&handle).await?;
    let mut harness = start_with(
        sh(&window_script(""), &[]),
        true,
        true,
        Some(handle),
        GameflowPhase::default(),
    )?;
    harness.wait_for(|status| status.running).await?;

    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(!harness.run.is_finished());
    assert_eq!(updater.install_count(), 0);

    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    // A quit is the other way an update installs, and it does not restart.
    assert_eq!(updater.installs(), [(version("0.2.0"), false)]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn no_install_runs_while_the_game_is_in_champ_select_or_in_game() -> TestResult {
    let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
    let handle = updates(&updater, IMMEDIATE);
    staged(&handle).await?;
    let harness = start_with(
        sh(&window_script(""), &[]),
        true,
        false,
        Some(handle),
        GameflowPhase::ChampSelect,
    )?;

    // Several refresh ticks pass: the idle path is due but the phase forbids it.
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(!harness.run.is_finished());
    assert_eq!(updater.install_count(), 0);

    harness.phase.send_replace(GameflowPhase::InProgress);
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    assert_eq!(updater.install_count(), 0);

    // Quitting mid-game does not install either; the update stays staged.
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert_eq!(updater.install_count(), 0);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn the_install_waits_for_the_game_to_end() -> TestResult {
    let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
    let handle = updates(&updater, IMMEDIATE);
    staged(&handle).await?;
    let harness = start_with(
        sh(&window_script(""), &[]),
        true,
        false,
        Some(handle),
        GameflowPhase::InProgress,
    )?;
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    assert_eq!(updater.install_count(), 0);

    harness.phase.send_replace(GameflowPhase::None);
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Updating);
    assert_eq!(updater.installs(), [(version("0.2.0"), true)]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

async fn next_relayed(
    commands: &mut mpsc::UnboundedReceiver<RelayCommand>,
) -> Result<RelayCommand, Box<dyn std::error::Error>> {
    tokio::time::timeout(PATIENCE, commands.recv())
        .await?
        .ok_or_else(|| "the chat relay's command channel closed".into())
}

async fn next_command(
    commands: &mut mpsc::UnboundedReceiver<RelayCommand>,
) -> Result<ChatCommand, Box<dyn std::error::Error>> {
    Ok(next_relayed(commands).await?.command)
}

#[cfg(unix)]
#[tokio::test]
async fn chat_commands_reach_the_relay_and_only_changed_parts_reach_the_window() -> TestResult {
    let scratch = scratch_directory()?;
    let received = scratch.join("received");
    // The window asks a question, records every line it is sent, and quits
    // once the streamed answer arrives.
    let script = format!(
        r#"printf '{{"type":"hello","protocol":{PROTOCOL_VERSION}}}\n'
printf '{{"type":"chat","command":{{"action":"send","question":"Who wins?","live_game":true}}}}\n'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$1"
  case "$line" in
    *'"answer":"Jinx"'*) printf '{{"type":"quit"}}\n' ;;
    *'"type":"close"'*) exit 0 ;;
  esac
done
exit 0"#
    );
    let (relay, mut commands, parts) = ChatRelay::detached();
    let received_path = received.to_str().ok_or("scratch path is not UTF-8")?;
    let harness = start_configured(
        sh(&script, &[received_path]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    // Opening the window reloads the list; the window's question follows,
    // with no game attached while none is live.
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    assert_eq!(
        next_relayed(&mut commands).await?,
        RelayCommand {
            command: ChatCommand::Send {
                question: "Who wins?".to_owned(),
                live_game: true,
            },
            live_game: None,
            champ_select: None,
        }
    );
    parts.send_modify(|parts| {
        parts.turn = Some(ChatTurn {
            answer: Some("Jinx".to_owned()),
            ..ChatTurn::default()
        });
    });
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    let lines = std::fs::read_to_string(&received)?;
    let count = |kind: &str| {
        lines
            .lines()
            .filter(|line| line.starts_with(&format!("{{\"type\":\"{kind}\"")))
            .count()
    };
    // Launch sends every part once; the answer re-sends only the turn.
    assert_eq!(
        [
            count("chat_status"),
            count("chat_conversations"),
            count("chat_transcript"),
            count("chat_turn"),
        ],
        [1, 1, 1, 2],
        "{lines}"
    );
    std::fs::remove_dir_all(directory)?;
    std::fs::remove_dir_all(scratch)?;
    Ok(())
}

#[tokio::test]
async fn a_finished_pairing_asks_chat_to_check_again() -> TestResult {
    let (relay, mut commands, _parts) = ChatRelay::detached();
    let mut harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    harness.wait_for(|status| status.running).await?;
    // The window's launch asked once; the pairing asks again.
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    // A device paired before chat asks for approval while still paired...
    harness.runtime_state.send_modify(|state| {
        state.paired = true;
        state.approval_url = Some("https://beta.scout-for-lol.com/pair/abc".to_owned());
    });
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    // ...and the approval ending, with the device still paired, asks again.
    harness
        .runtime_state
        .send_modify(|state| state.approval_url = None);
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// A game in progress: Ahri, the local player, against Zed.
fn live_snapshot() -> scout_client_core::live::snapshot::LiveSnapshot {
    use scout_client_core::live::snapshot::{
        LiveGameInfo, LiveParticipant, LiveSnapshot, OwnStats, Team,
    };

    let participant = |champion: &str, is_self: bool, kills: u32| LiveParticipant {
        team: Team::Order,
        is_self,
        champion: champion.to_owned(),
        level: 9,
        kills,
        deaths: 1,
        assists: 2,
        creep_score: 70,
        items: Vec::new(),
        summoner_spells: ["Flash".to_owned(), "Heal".to_owned()],
        keystone: None,
    };
    LiveSnapshot {
        game: LiveGameInfo {
            mode: "CLASSIC".to_owned(),
            map: "Map11".to_owned(),
            game_time_secs: 600,
        },
        own: OwnStats {
            gold: 0,
            max_health: 1.0,
            health: 1.0,
            resource: "MANA".to_owned(),
            max_resource: 1.0,
            current_resource: 1.0,
            armor: 0.0,
            magic_resist: 0.0,
            attack_damage: 0.0,
            ability_power: 0.0,
            attack_speed: 1.0,
            move_speed: 340.0,
            crit_chance: 0.0,
        },
        participants: vec![participant("Zed", false, 9), participant("Ahri", true, 3)],
        event_count: 0,
        latest_event: None,
    }
}

#[test]
fn the_window_gets_only_the_local_players_line() {
    let mut state = RuntimeState::default();
    assert_eq!(super::live_game_snapshot(&state), None);
    state.live_game = Some(live_snapshot());
    let line = super::live_game_snapshot(&state).map(|live| live.summary());
    assert_eq!(line.as_deref(), Some("Ahri, level 9, 3/1/2, 70 CS, 10:00"));
}

#[cfg(unix)]
#[tokio::test]
async fn a_question_using_the_live_game_carries_the_supervisors_snapshot() -> TestResult {
    // Once the window hears of a live game, it asks twice: with the chip on,
    // then with it off.
    let script = window_script(
        r#"while IFS= read -r line; do
  case "$line" in *'"type":"live_game","live":{'*) break ;; esac
done
printf '{"type":"chat","command":{"action":"send","question":"What next?","live_game":true}}\n'
printf '{"type":"chat","command":{"action":"send","question":"And now?","live_game":false}}\n'"#,
    );
    let (relay, mut commands, _parts) = ChatRelay::detached();
    let harness = start_configured(
        sh(&script, &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    harness
        .runtime_state
        .send_modify(|state| state.live_game = Some(live_snapshot()));
    assert_eq!(
        next_relayed(&mut commands).await?,
        RelayCommand {
            command: ChatCommand::Send {
                question: "What next?".to_owned(),
                live_game: true,
            },
            live_game: Some(live_snapshot()),
            champ_select: None,
        }
    );
    assert_eq!(
        next_relayed(&mut commands).await?,
        RelayCommand {
            command: ChatCommand::Send {
                question: "And now?".to_owned(),
                live_game: false,
            },
            live_game: None,
            champ_select: None,
        }
    );
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// What champion select shows: the local player on Ahri against Zed.
fn champ_select_snapshot() -> scout_client_core::live::champ_select::ChampSelectSnapshot {
    use scout_client_core::live::champ_select::{AllySlot, ChampSelectSnapshot, EnemySlot};

    ChampSelectSnapshot {
        phase: Some("BAN_PICK".to_owned()),
        local_cell_id: 0,
        my_team: vec![AllySlot {
            cell_id: 0,
            champion_id: 103,
            assigned_position: Some("middle".to_owned()),
        }],
        their_team: vec![EnemySlot {
            cell_id: 5,
            champion_id: 238,
        }],
        my_bans: vec![157],
        their_bans: Vec::new(),
    }
}

async fn next_coach(
    coach: &mut mpsc::UnboundedReceiver<CoachInput>,
) -> Result<CoachInput, Box<dyn std::error::Error>> {
    tokio::time::timeout(PATIENCE, coach.recv())
        .await?
        .ok_or_else(|| "the coach channel closed".into())
}

#[tokio::test]
async fn a_select_that_holds_still_is_advised_once_and_the_panel_clears_after_the_game()
-> TestResult {
    let DetachedRelay {
        relay, mut coach, ..
    } = ChatRelay::detached_coach();
    let harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| {
            supervisor
                .with_chat(relay)
                .with_coach_debounce(Duration::from_millis(20))
        },
    )?;
    harness
        .runtime_state
        .send_modify(|state| state.champ_select = Some(champ_select_snapshot()));
    harness.phase.send_replace(GameflowPhase::ChampSelect);

    let CoachInput::Turn(turn) = next_coach(&mut coach).await? else {
        return Err("the first input is a turn".into());
    };
    assert_eq!(
        turn.initiation,
        scout_client_core::desktop_api::AppInitiation::AppChampSelect
    );
    assert!(turn.context.live.is_none(), "never live state");
    let select = turn.context.champ_select.ok_or("the select")?;
    assert_eq!(select.my_team[0].champion_id, 103);

    // An unchanged screen is not asked about again; leaving the game takes
    // the panel down.
    harness.phase.send_replace(GameflowPhase::EndOfGame);
    assert_eq!(next_coach(&mut coach).await?, CoachInput::Clear);
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[tokio::test]
async fn a_select_turn_waits_for_the_players_turn_and_goes_when_it_ends() -> TestResult {
    let DetachedRelay {
        relay,
        mut coach,
        parts,
        ..
    } = ChatRelay::detached_coach();
    let running = scout_desktop_ipc::ChatParts {
        turn: Some(scout_desktop_ipc::ChatTurn::default()),
        ..scout_desktop_ipc::ChatParts::default()
    };
    parts.send_replace(running);
    let harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| {
            supervisor
                .with_chat(relay)
                .with_coach_debounce(Duration::from_millis(20))
        },
    )?;
    harness
        .runtime_state
        .send_modify(|state| state.champ_select = Some(champ_select_snapshot()));
    harness.phase.send_replace(GameflowPhase::ChampSelect);
    // Several refresh ticks pass while the player's own turn runs.
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(coach.try_recv().is_err(), "nothing is started beside it");
    parts.send_replace(scout_desktop_ipc::ChatParts::default());
    let CoachInput::Turn(turn) = next_coach(&mut coach).await? else {
        return Err("the deferred input is a turn".into());
    };
    assert_eq!(
        turn.initiation,
        scout_client_core::desktop_api::AppInitiation::AppChampSelect
    );
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[tokio::test]
async fn a_coach_that_is_off_is_not_asked() -> TestResult {
    let DetachedRelay {
        relay,
        mut coach,
        coach_enabled,
        ..
    } = ChatRelay::detached_coach();
    coach_enabled.store(false, std::sync::atomic::Ordering::Relaxed);
    let harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| {
            supervisor
                .with_chat(relay)
                .with_coach_debounce(Duration::from_millis(20))
        },
    )?;
    harness
        .runtime_state
        .send_modify(|state| state.champ_select = Some(champ_select_snapshot()));
    harness.phase.send_replace(GameflowPhase::ChampSelect);
    // Several refresh ticks pass with a select that would be advised.
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(coach.try_recv().is_err(), "nothing is started");
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn a_question_asked_in_champion_select_carries_the_select_and_never_a_game() -> TestResult {
    let script = window_script(
        r#"while IFS= read -r line; do
  case "$line" in *'"type":"phase","phase":"champ_select"'*) break ;; esac
done
printf '{"type":"chat","command":{"action":"send","question":"Who counters Zed?","live_game":false}}\n'"#,
    );
    let (relay, mut commands, _parts) = ChatRelay::detached();
    let harness = start_configured(
        sh(&script, &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    harness
        .runtime_state
        .send_modify(|state| state.champ_select = Some(champ_select_snapshot()));
    harness.phase.send_replace(GameflowPhase::ChampSelect);
    assert_eq!(
        next_relayed(&mut commands).await?,
        RelayCommand {
            command: ChatCommand::Send {
                question: "Who counters Zed?".to_owned(),
                live_game: false,
            },
            live_game: None,
            champ_select: Some(champ_select_snapshot()),
        }
    );
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// A frame of a game well past its plan, from the recorded `allgamedata`.
#[cfg(scout_proactive_coach)]
fn game_frame(
    secs: u32,
) -> Result<scout_client_core::live::snapshot::LiveSnapshot, Box<dyn std::error::Error>> {
    let data: scout_client_core::live::model::AllGameData = serde_json::from_str(include_str!(
        "../../../scout-client-core/testdata/live/allgamedata.json"
    ))?;
    let mut snapshot = scout_client_core::live::snapshot::project(&data)?;
    snapshot.game.game_time_secs = secs;
    Ok(snapshot)
}

#[cfg(scout_proactive_coach)]
#[tokio::test]
async fn a_scoreboard_change_asks_scout_once_and_is_recorded() -> TestResult {
    use scout_client_core::desktop_api::CoachTrigger;
    use scout_client_core::live::detectors::ItemCatalog;

    let DetachedRelay {
        relay,
        mut coach,
        items,
        ..
    } = ChatRelay::detached_coach();
    items.send_replace(Some(Arc::new(ItemCatalog::default())));
    let harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    let before = game_frame(600)?;
    harness
        .runtime_state
        .send_modify(|state| state.live_game = Some(before.clone()));
    harness.phase.send_replace(GameflowPhase::InProgress);
    // Let a refresh tick see the first frame.
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    let mut after = before.clone();
    after.game.game_time_secs = 640;
    for player in &mut after.participants {
        if player.is_self {
            player.deaths += 3;
        }
    }
    harness
        .runtime_state
        .send_modify(|state| state.live_game = Some(after.clone()));

    let CoachInput::Trigger(turn) = next_coach(&mut coach).await? else {
        return Err("the input is a proactive turn".into());
    };
    assert!(matches!(
        turn.trigger,
        CoachTrigger::DeathStreak {
            deaths_without_takedown: 3,
            ..
        }
    ));
    assert_eq!(turn.snapshot, after);
    // The same frame on later ticks asks nothing more.
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(coach.try_recv().is_err(), "one detection, one request");

    harness.control.send(Control::Quit)?;
    let (exit, _calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert!(
        diagnostics.events().iter().any(|event| event.operation
            == super::PROACTIVE_TRIGGER_OPERATION
            && event.detail.as_deref() == Some("death_streak")),
        "the request is in the diagnostics"
    );
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[cfg(scout_proactive_coach)]
#[tokio::test]
async fn nothing_is_asked_without_item_facts() -> TestResult {
    let DetachedRelay {
        relay, mut coach, ..
    } = ChatRelay::detached_coach();
    let harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::default(),
        |supervisor| supervisor.with_chat(relay),
    )?;
    let before = game_frame(600)?;
    harness
        .runtime_state
        .send_modify(|state| state.live_game = Some(before.clone()));
    harness.phase.send_replace(GameflowPhase::InProgress);
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    harness.runtime_state.send_modify(|state| {
        if let Some(live) = state.live_game.as_mut() {
            live.game.game_time_secs = 640;
            for player in &mut live.participants {
                if player.is_self {
                    player.deaths += 3;
                }
            }
        }
    });
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert!(coach.try_recv().is_err(), "no catalog, no detectors");
    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// An overlay stub: greets, reports `report` (a JSON line, or nothing), then
/// appends every line it is sent to `$1` until `close` or a closed stdin.
fn overlay_script(report: &str) -> String {
    format!(
        r#"printf '{{"type":"hello","protocol":{PROTOCOL_VERSION}}}\n'
{report}
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$1"
  case "$line" in *'"type":"close"'*) exit 0 ;; esac
done
exit 0"#
    )
}

/// Wait until the file at `path` holds `needle`.
async fn file_gains(path: &Path, needle: &str) -> Result<(), Box<dyn std::error::Error>> {
    tokio::time::timeout(PATIENCE, async {
        while !std::fs::read_to_string(path)
            .unwrap_or_default()
            .contains(needle)
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await?;
    Ok(())
}

/// What the overlay stub was sent so far.
fn overlay_lines(log: &Path) -> Vec<scout_desktop_ipc::OverlayCommand> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| scout_desktop_ipc::decode_line(line).ok())
        .collect()
}

/// Wait until the overlay stub has been sent a line `matches` accepts.
async fn overlay_sent(
    log: &Path,
    matches: impl Fn(&scout_desktop_ipc::OverlayCommand) -> bool,
) -> Result<(), Box<dyn std::error::Error>> {
    tokio::time::timeout(PATIENCE, async {
        while !overlay_lines(log).iter().any(&matches) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await?;
    Ok(())
}

fn shows(kind: scout_overlay::CardKind) -> impl Fn(&scout_desktop_ipc::OverlayCommand) -> bool {
    move |command| {
        matches!(
            command,
            scout_desktop_ipc::OverlayCommand::Frame { frame: Some(frame) } if frame.card.kind == kind
        )
    }
}

#[cfg(unix)]
#[tokio::test]
async fn the_overlay_runs_for_the_game_shows_its_plan_and_takes_its_keys() -> TestResult {
    use scout_desktop_ipc::{ChatCoachKind, OverlayCommand};

    let scratch = scratch_directory()?;
    let log = scratch.join("overlay.log");
    let log_argument = log.to_str().ok_or("scratch path is not Unicode")?;
    let DetachedRelay { relay, parts, .. } = ChatRelay::detached_coach();
    let overlay = sh(
        &overlay_script(r#"printf '{"type":"ready"}\n'"#),
        &[log_argument],
    );
    let mut harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::ChampSelect,
        |supervisor| supervisor.with_chat(relay).with_overlay(overlay, None),
    )?;
    harness.wait_for(|status| status.running).await?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!log.exists(), "no overlay before the game is in progress");

    harness.phase.send_replace(GameflowPhase::InProgress);
    overlay_sent(&log, |command| {
        matches!(command, OverlayCommand::Hello { protocol } if *protocol == PROTOCOL_VERSION)
    })
    .await?;
    parts.send_replace(super::overlay::tests::parts_with_coach(
        ChatCoachKind::Pregame,
        "- Farm bot side\n- Ward river at 3:00\n- Group for dragon",
    ));
    overlay_sent(&log, shows(scout_overlay::CardKind::PregamePlan)).await?;
    let Some(OverlayCommand::Frame { frame: Some(frame) }) = overlay_lines(&log)
        .into_iter()
        .find(shows(scout_overlay::CardKind::PregamePlan))
    else {
        return Err("the plan frame".into());
    };
    assert_eq!(frame.card.title, "Your game plan");
    assert_eq!(frame.card.lines.len(), 3);
    assert!(!frame.expanded);
    assert_eq!(frame.keys.dismiss, "F7");

    harness
        .control
        .send(Control::OverlayKey(crate::hotkeys::OverlayKey::Expand))?;
    overlay_sent(
        &log,
        |command| matches!(command, OverlayCommand::Frame { frame: Some(frame) } if frame.expanded),
    )
    .await?;
    harness
        .control
        .send(Control::OverlayKey(crate::hotkeys::OverlayKey::Dismiss))?;
    overlay_sent(&log, |command| {
        matches!(command, OverlayCommand::Frame { frame: None })
    })
    .await?;

    // A dismissed plan is not offered again while the panel still shows it.
    parts.send_modify(|parts| parts.status.reconnecting = true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        overlay_lines(&log)
            .iter()
            .filter(|command| shows(scout_overlay::CardKind::PregamePlan)(command))
            .count(),
        2,
        "the plan, then the plan expanded"
    );

    harness.phase.send_replace(GameflowPhase::EndOfGame);
    overlay_sent(&log, |command| matches!(command, OverlayCommand::Close)).await?;

    harness.control.send(Control::Quit)?;
    let (exit, _calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert!(
        diagnostics
            .events()
            .iter()
            .any(|event| event.summary().contains("click-through")),
        "the overlay's readiness is recorded"
    );
    std::fs::remove_dir_all(directory)?;
    std::fs::remove_dir_all(scratch)?;
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn an_unavailable_overlay_stays_down_for_the_game_and_the_window_keeps_running() -> TestResult
{
    use scout_desktop_ipc::ChatCoachKind;

    let scratch = scratch_directory()?;
    let log = scratch.join("overlay.log");
    let log_argument = log.to_str().ok_or("scratch path is not Unicode")?;
    let DetachedRelay { relay, parts, .. } = ChatRelay::detached_coach();
    let overlay = sh(
        &format!(
            "{}\nexit 0",
            overlay_script(r#"printf '{"type":"unavailable","reason":"no click-through"}\n'"#)
                .lines()
                .take(2)
                .collect::<Vec<_>>()
                .join("\n")
        ),
        &[log_argument],
    );
    let mut harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::InProgress,
        |supervisor| supervisor.with_chat(relay).with_overlay(overlay, None),
    )?;
    harness.wait_for(|status| status.running).await?;
    tokio::time::timeout(PATIENCE, async {
        while !harness
            .diagnostics
            .events()
            .iter()
            .any(|event| event.summary().contains("no click-through"))
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await?;
    parts.send_replace(super::overlay::tests::parts_with_coach(
        ChatCoachKind::Pregame,
        "Farm bot side",
    ));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!log.exists(), "nothing is drawn once the overlay is down");
    assert!(
        harness.status.borrow().running,
        "the main window is untouched"
    );

    harness.control.send(Control::Quit)?;
    let (exit, _calls, _diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    std::fs::remove_dir_all(scratch)?;
    Ok(())
}

/// The real overlay on this screen, driven by the real supervisor through a
/// mock gameflow: champion select, then `InProgress` with the game plan (and,
/// in the beta build, what Scout noticed), the overlay keys, then the end of
/// the game. It needs a display and the built `scout-client` beside the test
/// binary (`cargo build -p scout-client-app` first), so it is not part of the
/// suite; it is how the PR's recording is made:
/// `cargo test -p scout-client-app overlay_on_screen -- --ignored --nocapture`.
/// `SCOUT_OVERLAY_DEMO_STEP_MS` sets the pause between steps.
#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "opens the real overlay window on screen for a recording"]
async fn overlay_on_screen() -> TestResult {
    use crate::hotkeys::OverlayKey;
    use scout_desktop_ipc::ChatCoachKind;

    let step = Duration::from_millis(
        std::env::var("SCOUT_OVERLAY_DEMO_STEP_MS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3_000),
    );
    let binary = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .ok_or("the test binary has no target directory")?
        .join("scout-client");
    if !binary.exists() {
        return Err(format!("build {} first", binary.display()).into());
    }
    let DetachedRelay { relay, parts, .. } = ChatRelay::detached_coach();
    let overlay = WindowLauncher::new(binary, vec!["--overlay".to_owned()]);
    let mut harness = start_configured(
        sh(&window_script(""), &[]),
        true,
        true,
        GameflowPhase::ChampSelect,
        |supervisor| supervisor.with_chat(relay).with_overlay(overlay, None),
    )?;
    harness.wait_for(|status| status.running).await?;
    println!("gameflow: InProgress");
    harness.phase.send_replace(GameflowPhase::InProgress);
    parts.send_replace(super::overlay::tests::parts_with_coach(
        ChatCoachKind::Pregame,
        "## Plan\n- Farm bot side until your first item\n- Ward the river brush at 3:00\n- Group for the first dragon at 5:00\n- Their jungler starts top: track him",
    ));
    tokio::time::sleep(step).await;
    #[cfg(scout_proactive_coach)]
    {
        println!("beta: Scout noticed");
        let mut noticed = super::overlay::tests::parts_with_coach(
            ChatCoachKind::Proactive,
            "Their Jinx just finished Infinity Edge.\nBuild armor next.",
        );
        if let Some(coach) = noticed.coach.as_mut() {
            coach.message_id = uuid::Uuid::from_u128(3);
        }
        if let Some(message) = noticed
            .transcript
            .as_mut()
            .and_then(|transcript| transcript.messages.first_mut())
        {
            message.id = uuid::Uuid::from_u128(3);
        }
        parts.send_replace(noticed);
        tokio::time::sleep(step).await;
    }
    for key in [
        OverlayKey::Expand,
        OverlayKey::Next,
        OverlayKey::Next,
        OverlayKey::Dismiss,
    ] {
        println!("key: {key:?}");
        harness.control.send(Control::OverlayKey(key))?;
        tokio::time::sleep(step).await;
    }
    println!("gameflow: EndOfGame");
    harness.phase.send_replace(GameflowPhase::EndOfGame);
    tokio::time::sleep(step).await;
    harness.control.send(Control::Quit)?;
    let (exit, _calls, diagnostics, directory) = harness.finish().await?;
    for event in diagnostics.events() {
        println!("{}", event.summary());
    }
    assert_eq!(exit, SupervisorExit::Quit);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

/// Answers every review request with what `answers` holds next, and counts
/// the requests.
struct FakeReviews {
    answers: Mutex<Vec<super::review::ReviewAnswer>>,
    asked: Arc<Mutex<Vec<scout_client_core::desktop_api::CoachReviewRequest>>>,
}

impl super::ReviewSource for FakeReviews {
    fn fetch(
        &self,
        target: super::review::ReviewTarget,
        done: mpsc::UnboundedSender<super::review::ReviewFetch>,
    ) {
        if let Ok(request) = target.request() {
            self.asked
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(request);
        }
        let mut answers = self.answers.lock().unwrap_or_else(PoisonError::into_inner);
        let answer = if answers.len() > 1 {
            answers.remove(0)
        } else {
            answers
                .first()
                .cloned()
                .unwrap_or(super::review::ReviewAnswer::NotYet)
        };
        let _ = done.send((target.game_id, answer));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_ready_review_opens_in_the_window_and_its_card_opens_it_next_game() -> TestResult {
    use super::review::ReviewAnswer;
    use scout_desktop_ipc::OverlayCommand;

    let scratch = scratch_directory()?;
    let log = scratch.join("overlay.log");
    let log_argument = log.to_str().ok_or("scratch path is not Unicode")?;
    let DetachedRelay {
        relay,
        mut commands,
        ..
    } = ChatRelay::detached_coach();
    let review = uuid::Uuid::from_u128(0x5eed);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let reviews = FakeReviews {
        answers: Mutex::new(vec![
            ReviewAnswer::NotYet,
            ReviewAnswer::Pending,
            ReviewAnswer::Ready {
                match_id: "NA1_5654104474".to_owned(),
                conversation_id: review,
            },
        ]),
        asked: Arc::clone(&asked),
    };
    let overlay = sh(
        &overlay_script(r#"printf '{"type":"ready"}\n'"#),
        &[log_argument],
    );
    // A window stub that logs what it is sent, to see it asked for chat.
    let window_log = scratch.join("window.log");
    let window_log_argument = window_log.to_str().ok_or("scratch path is not Unicode")?;
    let mut harness = start_configured(
        sh(&overlay_script(""), &[window_log_argument]),
        true,
        true,
        GameflowPhase::EndOfGame,
        |supervisor| {
            supervisor
                .with_chat(relay)
                .with_overlay(overlay, None)
                .with_immediate_reviews(Box::new(reviews))
        },
    )?;
    harness.wait_for(|status| status.running).await?;
    // The collector saw game 5654104474 end, an end-of-game-only game the
    // match history never lists, so it is asked for by game id.
    harness.runtime_state.send_modify(|state| {
        state.ended_game_id = Some("5654104474".to_owned());
        state.recent_match_ids = vec!["NA1_5654104475".to_owned()];
    });
    // Not yet, pending, then ready: one request per refresh, then none.
    loop {
        if next_command(&mut commands).await?
            == (ChatCommand::Open {
                conversation_id: review,
            })
        {
            break;
        }
    }
    assert_eq!(next_command(&mut commands).await?, ChatCommand::Refresh);
    // The running window is told to show its chat page, not only to come up.
    file_gains(&window_log, r#"{"type":"show_chat"}"#).await?;
    tokio::time::sleep(Duration::from_millis(2_500)).await;
    assert_eq!(
        asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_slice(),
        vec![scout_client_core::desktop_api::CoachReviewRequest::Game("5654104474".to_owned()); 3]
            .as_slice(),
        "asked by game id until ready, then stopped"
    );
    assert!(!log.exists(), "no overlay outside a game");

    // The next game raises the card; its expand key opens the review.
    harness.phase.send_replace(GameflowPhase::InProgress);
    overlay_sent(&log, shows(scout_overlay::CardKind::ReviewReady)).await?;
    harness
        .control
        .send(Control::OverlayKey(crate::hotkeys::OverlayKey::Expand))?;
    loop {
        if next_command(&mut commands).await?
            == (ChatCommand::Open {
                conversation_id: review,
            })
        {
            break;
        }
    }
    overlay_sent(&log, |command| {
        matches!(command, OverlayCommand::Frame { frame: None })
    })
    .await?;

    harness.control.send(Control::Quit)?;
    let (exit, _calls, diagnostics, directory) = harness.finish().await?;
    assert_eq!(exit, SupervisorExit::Quit);
    assert!(diagnostics.events().iter().any(|event| {
        event
            .summary()
            .contains("review of NA1_5654104474 is ready")
    }));
    std::fs::remove_dir_all(directory)?;
    std::fs::remove_dir_all(scratch)?;
    Ok(())
}
