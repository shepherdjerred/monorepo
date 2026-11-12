use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use scout_client_core::diagnostics::Diagnostics;
use scout_client_runtime::instance::{InstanceLock, InstanceLockError};
use scout_client_runtime::runtime::{GameflowPhase, PhaseReceiver, RuntimeState, StateReceiver};
use tokio::sync::{mpsc, watch};

use super::{
    Collector, Control, MAX_QUICK_CRASHES, STABLE_RUN, Supervisor, SupervisorExit, WindowLauncher,
    WindowStatus, quick_crashes_now,
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
    state: watch::Sender<RuntimeState>,
    phase: watch::Sender<GameflowPhase>,
    diagnostics: Arc<Diagnostics>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl FakeCollector {
    fn new() -> (Self, Arc<Mutex<Vec<String>>>, Arc<Diagnostics>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let diagnostics = Arc::new(Diagnostics::in_memory());
        let collector = Self {
            state: watch::channel(RuntimeState::default()).0,
            phase: watch::channel(GameflowPhase::default()).0,
            diagnostics: Arc::clone(&diagnostics),
            calls: Arc::clone(&calls),
        };
        (collector, calls, diagnostics)
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
        r#"printf '{{"type":"hello","protocol":1}}\n'
{before}
while IFS= read -r line; do
  case "$line" in *'"type":"close"'*) exit 0 ;; esac
done
exit 0"#
    )
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
    diagnostics: Arc<Diagnostics>,
    directory: PathBuf,
}

fn start(
    launcher: WindowLauncher,
    tray_available: bool,
    open_window: bool,
) -> Result<Harness, Box<dyn std::error::Error>> {
    let directory = scratch_directory()?;
    let lock = InstanceLock::acquire_in(&directory)?;
    let (collector, calls, diagnostics) = FakeCollector::new();
    let (control, receiver) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        lock,
        collector,
        launcher,
        receiver,
        tray_available,
        open_window,
    );
    let status = supervisor.status();
    let run = tokio::spawn(supervisor.run());
    Ok(Harness {
        control,
        status,
        run,
        calls,
        diagnostics,
        directory,
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
    let mut harness = start(
        sh("printf '{\"type\":\"hello\",\"protocol\":1}\\n'", &[]),
        true,
        true,
    )?;
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
    let harness = start(
        sh("printf '{\"type\":\"hello\",\"protocol\":1}\\n'", &[]),
        false,
        false,
    )?;
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
    let script = r#"printf '{"type":"hello","protocol":1}\n{"type":"format_disk"}\n'; while read -r line; do :; done"#;
    let mut harness = start(sh(script, &[]), true, true)?;
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
