//! The background update loop and the handle the supervisor uses.
//!
//! One task checks the channel after [`UpdateConfig::first_check_delay`], then
//! every [`UpdateConfig::check_interval`], and immediately when the backend
//! refuses this build with HTTP 426. A newer release is downloaded and
//! verified in the same task and then waits, staged, for the supervisor to
//! install it on quit or at idle. The supervisor asks; this never installs on
//! its own.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_runtime::runtime::GameflowPhase;
use scout_desktop_ipc::{UpdateSnapshot, UpdateStatus};
use semver::Version;
use tokio::sync::{Notify, watch};

use super::policy::{UpdateConfig, install_allowed};
use super::{AvailableUpdate, StagedUpdate, UpdateError, Updater};

type InstallFn = dyn Fn(&StagedUpdate, bool) -> Result<(), UpdateError> + Send + Sync;

/// What asking for an install did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallOutcome {
    /// The installer was started; this process should end.
    Started(Version),
    /// Nothing is downloaded and verified.
    NothingStaged,
    /// A game phase is live, so nothing was started. The update stays staged.
    Deferred,
    /// The installer could not be started; the staged update was discarded.
    Failed,
}

struct Shared {
    status: watch::Sender<UpdateSnapshot>,
    staged: Mutex<Option<StagedUpdate>>,
    trigger: Notify,
    upgrade_required: AtomicBool,
    /// Whether "nothing is published" has been logged since the channel last
    /// answered otherwise; a channel with no release yet is said once.
    unpublished_logged: AtomicBool,
    idle_since: Mutex<Option<Instant>>,
    config: UpdateConfig,
    diagnostics: Arc<Diagnostics>,
    install: Box<InstallFn>,
}

impl Shared {
    fn staged(&self) -> MutexGuard<'_, Option<StagedUpdate>> {
        self.staged.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn idle_since(&self) -> MutexGuard<'_, Option<Instant>> {
        self.idle_since
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn set(&self, status: UpdateStatus, version: Option<&Version>, required: bool) {
        self.status.send_replace(UpdateSnapshot {
            status,
            version: version.map(ToString::to_string),
            required,
        });
    }

    fn record(
        &self,
        operation: &'static str,
        level: DiagnosticLevel,
        outcome: DiagnosticOutcome,
        detail: impl AsRef<str>,
    ) {
        self.diagnostics.record(
            DiagnosticEvent::new(level, DiagnosticCategory::Runtime, operation, outcome)
                .with_detail(detail),
        );
    }
}

/// The supervisor's side of the updater.
#[derive(Clone)]
pub struct UpdateHandle {
    shared: Arc<Shared>,
}

/// Starts the update loop.
pub struct UpdateService;

impl UpdateService {
    /// Start checking `updater` for releases newer than `current`.
    ///
    /// Spawns onto the current tokio runtime, so call it from inside one.
    pub fn start<U: Updater>(
        updater: Arc<U>,
        config: UpdateConfig,
        current: Version,
        diagnostics: Arc<Diagnostics>,
    ) -> UpdateHandle {
        let installer = Arc::clone(&updater);
        let shared = Arc::new(Shared {
            status: watch::channel(UpdateSnapshot {
                status: UpdateStatus::Idle,
                version: None,
                required: false,
            })
            .0,
            staged: Mutex::new(None),
            trigger: Notify::new(),
            upgrade_required: AtomicBool::new(false),
            unpublished_logged: AtomicBool::new(false),
            idle_since: Mutex::new(None),
            config,
            diagnostics,
            install: Box::new(move |staged, restart| installer.install(staged, restart)),
        });
        tokio::spawn(run(updater, Arc::clone(&shared), current));
        UpdateHandle { shared }
    }
}

impl UpdateHandle {
    /// Follow the update state for the window.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<UpdateSnapshot> {
        self.shared.status.subscribe()
    }

    /// The update state right now.
    #[must_use]
    pub fn snapshot(&self) -> UpdateSnapshot {
        self.shared.status.borrow().clone()
    }

    /// Tell the updater whether the backend currently refuses this build with
    /// HTTP 426. The moment it starts to, the channel is checked immediately.
    pub fn observe_upgrade_required(&self, refused: bool) {
        let was = self.shared.upgrade_required.swap(refused, Ordering::SeqCst);
        if refused && !was {
            self.shared.trigger.notify_one();
        }
    }

    /// Whether the supervisor should install now, because the app has sat idle.
    ///
    /// Idle means the window is closed and no game phase is in the way, for
    /// [`UpdateConfig::idle_install_after`] (not at all, for a required
    /// update). Anything else resets the clock.
    #[must_use]
    pub fn idle_install_due(&self, window_open: bool, phase: &GameflowPhase, now: Instant) -> bool {
        let staged_required = self.shared.staged().as_ref().map(|staged| staged.required);
        let Some(required) = staged_required else {
            *self.shared.idle_since() = None;
            return false;
        };
        if window_open || !install_allowed(phase) {
            *self.shared.idle_since() = None;
            return false;
        }
        let mut idle_since = self.shared.idle_since();
        let since = *idle_since.get_or_insert(now);
        let wait = if required {
            std::time::Duration::ZERO
        } else {
            self.shared.config.idle_install_after
        };
        now.saturating_duration_since(since) >= wait
    }

    /// Start the staged installer, unless a game phase forbids it.
    ///
    /// The phase is checked here, at the moment of installing, so a decision
    /// made earlier never outlives a change of phase. With `restart` the new
    /// version starts when the installer finishes; without it Scout stays
    /// closed, as a user who quit expects.
    pub fn install(&self, restart: bool, phase: &GameflowPhase) -> InstallOutcome {
        let Some(staged) = self.shared.staged().clone() else {
            return InstallOutcome::NothingStaged;
        };
        if !install_allowed(phase) {
            self.shared.record(
                "update_install",
                DiagnosticLevel::Info,
                DiagnosticOutcome::Skipped,
                "a game phase is live",
            );
            return InstallOutcome::Deferred;
        }
        match (self.shared.install)(&staged, restart) {
            Ok(()) => {
                self.shared.record(
                    "update_install",
                    DiagnosticLevel::Info,
                    DiagnosticOutcome::Succeeded,
                    format!("started the installer for {}", staged.version),
                );
                InstallOutcome::Started(staged.version)
            }
            Err(error) => {
                // A file that fails verification or will not start is not
                // retried as-is; the next check downloads it again.
                self.shared.staged().take();
                self.shared.set(UpdateStatus::Failed, None, false);
                self.shared.record(
                    "update_install",
                    DiagnosticLevel::Error,
                    DiagnosticOutcome::Failed,
                    error.to_string(),
                );
                InstallOutcome::Failed
            }
        }
    }
}

async fn run<U: Updater>(updater: Arc<U>, shared: Arc<Shared>, current: Version) {
    let mut wait = shared.config.first_check_delay;
    loop {
        tokio::select! {
            () = tokio::time::sleep(wait) => {}
            () = shared.trigger.notified() => {}
        }
        cycle(updater.as_ref(), &shared, &current).await;
        wait = shared.config.check_interval;
    }
}

async fn cycle<U: Updater>(updater: &U, shared: &Shared, current: &Version) {
    let previous = shared.status.borrow().clone();
    shared.set(UpdateStatus::Checking, None, previous.required);
    let update = match updater.check(current).await {
        Ok(update) => update,
        // The channel has no manifest yet: nothing has been released on it,
        // which is the normal state before a first publication, not a fault.
        Err(UpdateError::Status(404)) => {
            shared.staged().take();
            shared.set(UpdateStatus::UpToDate, None, false);
            if !shared.unpublished_logged.swap(true, Ordering::SeqCst) {
                shared.record(
                    "update_check",
                    DiagnosticLevel::Info,
                    DiagnosticOutcome::Skipped,
                    "no release is published on this channel yet",
                );
            }
            return;
        }
        Err(error) => {
            shared.unpublished_logged.store(false, Ordering::SeqCst);
            shared.record(
                "update_check",
                DiagnosticLevel::Warn,
                DiagnosticOutcome::Deferred,
                error.to_string(),
            );
            restore_after_failure(shared, previous);
            return;
        }
    };
    shared.unpublished_logged.store(false, Ordering::SeqCst);
    // The updater never offers a release at or below the running version; a
    // misbehaving one is held to the same rule here.
    let Some(update) = update.filter(|update| update.version > *current) else {
        shared.staged().take();
        shared.set(UpdateStatus::UpToDate, None, false);
        shared.record(
            "update_check",
            DiagnosticLevel::Info,
            DiagnosticOutcome::Succeeded,
            "up to date",
        );
        return;
    };
    shared.record(
        "update_check",
        DiagnosticLevel::Info,
        DiagnosticOutcome::Succeeded,
        format!("{} is available", update.version),
    );
    stage(updater, shared, update).await;
}

async fn stage<U: Updater>(updater: &U, shared: &Shared, update: AvailableUpdate) {
    let already = shared
        .staged()
        .as_ref()
        .is_some_and(|staged| staged.version == update.version);
    if already {
        shared.set(UpdateStatus::Ready, Some(&update.version), update.required);
        return;
    }
    shared.set(
        UpdateStatus::Downloading,
        Some(&update.version),
        update.required,
    );
    match updater.download(&update).await {
        Ok(staged) => {
            shared.record(
                "update_download",
                DiagnosticLevel::Info,
                DiagnosticOutcome::Succeeded,
                format!("{} downloaded and verified", staged.version),
            );
            shared.set(UpdateStatus::Ready, Some(&staged.version), staged.required);
            *shared.staged() = Some(staged);
        }
        Err(error) => {
            shared.record(
                "update_download",
                DiagnosticLevel::Warn,
                DiagnosticOutcome::Deferred,
                error.to_string(),
            );
            shared.set(UpdateStatus::Failed, Some(&update.version), update.required);
        }
    }
}

/// A failed check leaves a verified, staged update installable, so the window
/// keeps saying so; with nothing staged it says the check failed.
fn restore_after_failure(shared: &Shared, previous: UpdateSnapshot) {
    if previous.status == UpdateStatus::Ready {
        shared.status.send_replace(previous);
    } else {
        shared.set(UpdateStatus::Failed, None, false);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use scout_client_core::diagnostics::{DiagnosticLevel, DiagnosticOutcome, Diagnostics};
    use scout_client_runtime::runtime::GameflowPhase;
    use scout_desktop_ipc::{UpdateSnapshot, UpdateStatus};

    use super::{InstallOutcome, UpdateHandle, UpdateService};
    use crate::updater::policy::UpdateConfig;
    use crate::updater::testing::{FakeUpdater, available, version};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const PROMPT: UpdateConfig = UpdateConfig {
        first_check_delay: Duration::ZERO,
        check_interval: Duration::from_hours(6),
        idle_install_after: Duration::from_mins(10),
    };

    const NEVER: UpdateConfig = UpdateConfig {
        first_check_delay: Duration::from_hours(24),
        check_interval: Duration::from_hours(24),
        idle_install_after: Duration::from_mins(10),
    };

    fn start(updater: &Arc<FakeUpdater>, config: UpdateConfig, current: &str) -> UpdateHandle {
        UpdateService::start(
            Arc::clone(updater),
            config,
            version(current),
            Arc::new(Diagnostics::in_memory()),
        )
    }

    async fn until(
        handle: &UpdateHandle,
        wanted: impl FnMut(&UpdateSnapshot) -> bool,
    ) -> Result<UpdateSnapshot, Box<dyn std::error::Error>> {
        let mut status = handle.subscribe();
        let seen = tokio::time::timeout(Duration::from_secs(10), status.wait_for(wanted)).await??;
        Ok(seen.clone())
    }

    #[tokio::test]
    async fn a_newer_release_is_checked_downloaded_and_staged_on_start() -> TestResult {
        let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
        let handle = start(&updater, PROMPT, "0.1.0");
        let ready = until(&handle, |status| status.status == UpdateStatus::Ready).await?;
        assert_eq!(ready.version.as_deref(), Some("0.2.0"));
        assert!(!ready.required);
        assert_eq!(
            updater.downloads.load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        // Downloading is not installing.
        assert_eq!(updater.install_count(), 0);
        Ok(())
    }

    #[tokio::test]
    async fn a_current_build_stays_up_to_date_and_downloads_nothing() -> TestResult {
        let updater = FakeUpdater::offering(None);
        let handle = start(&updater, PROMPT, "0.2.0");
        until(&handle, |status| status.status == UpdateStatus::UpToDate).await?;
        assert_eq!(
            updater.downloads.load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_release_at_or_below_the_running_version_is_never_staged() -> TestResult {
        for offered in ["0.1.0", "0.0.9"] {
            let updater = FakeUpdater::offering(Some(available(offered, false)));
            let handle = start(&updater, PROMPT, "0.1.0");
            until(&handle, |status| status.status == UpdateStatus::UpToDate).await?;
            assert_eq!(
                updater.downloads.load(std::sync::atomic::Ordering::SeqCst),
                0,
                "{offered}"
            );
            assert_eq!(
                handle.install(false, &GameflowPhase::None),
                InstallOutcome::NothingStaged
            );
        }
        Ok(())
    }

    #[tokio::test]
    async fn a_failed_check_is_reported() -> TestResult {
        let updater = FakeUpdater::offering(None);
        updater.failing_checks();
        let handle = start(&updater, PROMPT, "0.1.0");
        until(&handle, |status| status.status == UpdateStatus::Failed).await?;
        Ok(())
    }

    #[tokio::test]
    async fn an_unpublished_channel_is_up_to_date_and_said_once() -> TestResult {
        let updater = FakeUpdater::offering(None);
        updater.unpublished();
        let diagnostics = Arc::new(Diagnostics::in_memory());
        let handle = UpdateService::start(
            Arc::clone(&updater),
            UpdateConfig {
                first_check_delay: Duration::ZERO,
                check_interval: Duration::from_millis(5),
                idle_install_after: Duration::from_mins(10),
            },
            version("0.1.0"),
            Arc::clone(&diagnostics),
        );
        until(&handle, |status| status.status == UpdateStatus::UpToDate).await?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while updater.checks() < 4 {
            assert!(Instant::now() < deadline, "the updater stopped checking");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let checks: Vec<_> = diagnostics
            .events()
            .into_iter()
            .filter(|event| event.operation == "update_check")
            .collect();
        assert_eq!(checks.len(), 1, "{checks:?}");
        assert_eq!(checks[0].level, DiagnosticLevel::Info);
        assert_eq!(checks[0].outcome, DiagnosticOutcome::Skipped);
        assert_eq!(handle.snapshot().status, UpdateStatus::UpToDate);
        Ok(())
    }

    #[tokio::test]
    async fn a_426_checks_immediately_instead_of_waiting_for_the_interval() -> TestResult {
        let updater = FakeUpdater::offering(Some(available("0.2.0", true)));
        let handle = start(&updater, NEVER, "0.1.0");
        // Nothing runs on its own for a day.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(updater.checks(), 0);

        handle.observe_upgrade_required(true);
        let ready = until(&handle, |status| status.status == UpdateStatus::Ready).await?;
        assert!(ready.required);
        assert_eq!(updater.checks(), 1);

        // Still refused: no new edge, no new check.
        handle.observe_upgrade_required(true);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(updater.checks(), 1);

        // Refused again after a success: a new edge checks again.
        handle.observe_upgrade_required(false);
        handle.observe_upgrade_required(true);
        let deadline = Instant::now() + Duration::from_secs(10);
        while updater.checks() < 2 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(updater.checks(), 2);
        Ok(())
    }

    #[tokio::test]
    async fn no_install_starts_while_a_game_phase_is_live() -> TestResult {
        let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
        let handle = start(&updater, PROMPT, "0.1.0");
        until(&handle, |status| status.status == UpdateStatus::Ready).await?;

        for phase in [
            GameflowPhase::ChampSelect,
            GameflowPhase::GameStart,
            GameflowPhase::InProgress,
        ] {
            assert_eq!(handle.install(false, &phase), InstallOutcome::Deferred);
            assert_eq!(handle.install(true, &phase), InstallOutcome::Deferred);
        }
        assert_eq!(updater.install_count(), 0);

        // The update stays staged, and installs once the game is over.
        assert_eq!(
            handle.install(false, &GameflowPhase::None),
            InstallOutcome::Started(version("0.2.0"))
        );
        assert_eq!(updater.installs(), [(version("0.2.0"), false)]);
        Ok(())
    }

    #[tokio::test]
    async fn an_idle_install_waits_for_a_closed_window_and_a_quiet_phase() -> TestResult {
        let updater = FakeUpdater::offering(Some(available("0.2.0", false)));
        let handle = start(&updater, PROMPT, "0.1.0");
        let start_time = Instant::now();
        // Nothing staged yet: never due.
        assert!(!handle.idle_install_due(false, &GameflowPhase::None, start_time));
        until(&handle, |status| status.status == UpdateStatus::Ready).await?;

        let idle_after = PROMPT.idle_install_after;
        // The clock starts at the first idle tick, not before.
        assert!(!handle.idle_install_due(false, &GameflowPhase::None, start_time));
        assert!(!handle.idle_install_due(false, &GameflowPhase::None, start_time + idle_after / 2));
        // A game phase resets it, and so does an open window.
        assert!(!handle.idle_install_due(
            false,
            &GameflowPhase::ChampSelect,
            start_time + idle_after
        ));
        assert!(!handle.idle_install_due(true, &GameflowPhase::None, start_time + idle_after));
        let restarted = start_time + idle_after * 2;
        assert!(!handle.idle_install_due(false, &GameflowPhase::None, restarted));
        assert!(handle.idle_install_due(false, &GameflowPhase::None, restarted + idle_after));
        Ok(())
    }

    #[tokio::test]
    async fn a_required_update_installs_as_soon_as_the_window_is_closed_and_idle() -> TestResult {
        let updater = FakeUpdater::offering(Some(available("0.2.0", true)));
        let handle = start(&updater, PROMPT, "0.1.0");
        until(&handle, |status| status.status == UpdateStatus::Ready).await?;
        let now = Instant::now();
        assert!(handle.idle_install_due(false, &GameflowPhase::Lobby, now));
        // Still never over a game.
        assert!(!handle.idle_install_due(false, &GameflowPhase::InProgress, now));
        Ok(())
    }
}
