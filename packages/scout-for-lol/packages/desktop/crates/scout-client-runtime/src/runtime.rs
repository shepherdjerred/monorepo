//! Background League observation, pairing, and upload runtime.
//!
//! [`ClientRuntime`] owns the collector thread. The collector is split by
//! concern: `collector` drives the tick loop, `pairing` and `upload` talk to
//! the backend, `gameflow`, `profile`, `history` and `clash` read the League
//! client, `replay` captures replay files, `observe` turns reads into outbox
//! entries, `state` publishes the snapshot, and `paths` locates local files.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics, FileSink,
};
use scout_client_core::reporting::{
    BugsinkSink, ReportingGuard, ReportingProcess, reporting_environment, reporting_status,
    start_error_reporting,
};
use scout_client_core::settings::{PrivacyGates, PrivacySettings, SettingsStore};
use scout_client_core::telemetry::UsageEvent;
use tokio::runtime::Runtime;
use tokio::sync::{mpsc, watch};
use tracing::info;

mod clash;
mod collection;
mod collector;
mod gameflow;
mod history;
mod observe;
mod pairing;
mod paths;
mod profile;
mod replay;
mod state;
mod upload;
mod usage;

pub(crate) use paths::data_directory;
pub use state::{GameflowPhase, RuntimeState};

/// Latest-value subscription to the UI snapshot.
pub type StateReceiver = watch::Receiver<RuntimeState>;
/// Latest-value subscription to the typed gameflow phase.
pub type PhaseReceiver = watch::Receiver<GameflowPhase>;

use collector::run_collector;
use paths::log_directory;
use state::{StateHub, set_error, update_state};
use usage::{UsageChannel, UsageQueue};

enum RuntimeCommand {
    StartPairing,
    Disconnect,
    SetStartAtLogin(bool),
}

/// Where the settings file lives, when there is a per-user data directory.
fn settings_store() -> Option<SettingsStore> {
    data_directory().map(|directory| SettingsStore::in_directory(&directory))
}

/// The stored privacy choice, and why it could not be read.
///
/// Fails closed: with no settings folder or a damaged file nothing is sent,
/// because the only thing worse than a lost report is one the user had turned
/// off.
fn load_privacy(store: Option<&SettingsStore>) -> (PrivacySettings, Option<String>) {
    match store.map(SettingsStore::load) {
        Some(Ok(settings)) => (settings, None),
        Some(Err(error)) => (PrivacySettings::all_off(), Some(error.to_string())),
        None => (
            PrivacySettings::all_off(),
            Some("there is no settings folder".to_owned()),
        ),
    }
}

fn record_settings_problem(diagnostics: &Diagnostics, operation: &'static str, problem: &str) {
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Runtime,
            operation,
            DiagnosticOutcome::Failed,
        )
        .with_detail(format!(
            "{problem}; error reports and usage data stay off until Settings is saved"
        )),
    );
}

/// `app_started`, and `update_applied` when this is the first run of a new
/// version. They wait in the queue for the first check-in.
fn queue_startup_events(
    settings: Option<&SettingsStore>,
    diagnostics: &Diagnostics,
    usage: &UsageQueue,
) {
    usage.push(UsageEvent::AppStarted);
    match settings.map(|store| store.note_run_version(env!("CARGO_PKG_VERSION"))) {
        Some(Ok(Some(_previous))) => usage.push(UsageEvent::UpdateApplied),
        Some(Err(error)) => {
            record_settings_problem(diagnostics, "note_run_version", &error.to_string());
        }
        Some(Ok(None)) | None => {}
    }
}

/// The privacy gates for a process that does not own the runtime, such as the
/// window. They start from the stored choice and fail closed.
#[must_use]
pub fn load_privacy_gates() -> PrivacyGates {
    PrivacyGates::new(load_privacy(settings_store().as_ref()).0)
}

/// Handle owned by the desktop application.
pub struct ClientRuntime {
    state: Arc<StateHub>,
    diagnostics: Arc<Diagnostics>,
    log_directory: Option<PathBuf>,
    /// Flushes queued error reports when the runtime is dropped.
    _reporting: Option<ReportingGuard>,
    settings: Option<SettingsStore>,
    gates: PrivacyGates,
    usage: UsageQueue,
    commands: mpsc::UnboundedSender<RuntimeCommand>,
    shutdown: watch::Sender<bool>,
    thread: std::thread::JoinHandle<()>,
}

impl ClientRuntime {
    /// Spawn the async collector on a dedicated thread.
    #[must_use]
    pub fn start(backend_origin: String) -> Self {
        let state = Arc::new(StateHub::default());
        let log_directory = log_directory();
        let mut diagnostics = Diagnostics::in_memory();
        if let Some(sink) = log_directory.clone().and_then(FileSink::new) {
            diagnostics = diagnostics.with_sink(Box::new(sink));
        }
        let settings = settings_store();
        let (privacy, privacy_problem) = load_privacy(settings.as_ref());
        let gates = PrivacyGates::new(privacy);
        // Only when this build has somewhere to report to; the guard must
        // outlive the process, so it is held here. The reporter is installed
        // even while reports are off, because the switch can be flipped back
        // on without a restart; the gate is what stops sends meanwhile.
        let reporting = start_error_reporting(
            reporting_environment(&backend_origin),
            ReportingProcess::Supervisor,
            gates.error_reports.clone(),
        );
        if reporting.is_some() {
            diagnostics =
                diagnostics.with_sink(Box::new(BugsinkSink::new(gates.error_reports.clone())));
        }
        let diagnostics = Arc::new(diagnostics);
        diagnostics.record(reporting_status(&gates.error_reports));
        if let Some(problem) = privacy_problem {
            record_settings_problem(&diagnostics, "load_settings", &problem);
        }
        let usage = UsageQueue::default();
        queue_startup_events(settings.as_ref(), &diagnostics, &usage);
        update_state(&state, |snapshot| snapshot.privacy = privacy);
        let (shutdown, shutdown_receiver) = watch::channel(false);
        let (commands, command_receiver) = mpsc::unbounded_channel();
        let worker_state = Arc::clone(&state);
        let worker_diagnostics = Arc::clone(&diagnostics);
        let usage_channel = UsageChannel::new(usage.clone(), gates.usage_data.clone());
        let thread = std::thread::spawn(move || {
            let runtime = match Runtime::new() {
                Ok(runtime) => runtime,
                Err(error) => {
                    worker_diagnostics.record(
                        DiagnosticEvent::new(
                            DiagnosticLevel::Critical,
                            DiagnosticCategory::Runtime,
                            "start_collector",
                            DiagnosticOutcome::Failed,
                        )
                        .with_detail(error.to_string()),
                    );
                    set_error(
                        &worker_state,
                        format!("Could not start background runtime: {error}"),
                    );
                    return;
                }
            };
            runtime.block_on(run_collector(
                worker_state,
                worker_diagnostics,
                shutdown_receiver,
                command_receiver,
                backend_origin,
                usage_channel,
            ));
        });
        Self {
            state,
            diagnostics,
            log_directory,
            _reporting: reporting,
            settings,
            gates,
            usage,
            commands,
            shutdown,
            thread,
        }
    }

    /// Subscribe to the UI snapshot. The receiver always holds the latest
    /// value and wakes when the collector publishes a change.
    #[must_use]
    pub fn state(&self) -> StateReceiver {
        self.state.subscribe()
    }

    /// Subscribe to the typed gameflow phase, for consumers (an overlay, a
    /// coach) that react to phase changes and need nothing else.
    #[must_use]
    pub fn gameflow_phase(&self) -> PhaseReceiver {
        self.state.subscribe_phase()
    }

    /// The diagnostics this client is accumulating.
    #[must_use]
    pub fn diagnostics(&self) -> &Arc<Diagnostics> {
        &self.diagnostics
    }

    /// Where JSONL records are being written, when a file sink opened.
    #[must_use]
    pub fn log_directory(&self) -> Option<&Path> {
        self.log_directory.as_deref()
    }

    /// Begin a new browser pairing request.
    pub fn start_pairing(&self) {
        if self.commands.send(RuntimeCommand::StartPairing).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Delete the local credential and stop uploading until re-paired.
    pub fn disconnect(&self) {
        if self.commands.send(RuntimeCommand::Disconnect).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Change the current-user start-at-login registration.
    pub fn set_start_at_login(&self, enabled: bool) {
        if self
            .commands
            .send(RuntimeCommand::SetStartAtLogin(enabled))
            .is_err()
        {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Change the two privacy switches.
    ///
    /// The gates close or open first, so an opt-out takes effect for the very
    /// next report or event even if the choice cannot be written to disk; the
    /// failure to persist is then shown to the user.
    pub fn set_privacy_settings(&self, settings: PrivacySettings) {
        self.gates.apply(settings);
        update_state(&self.state, |snapshot| snapshot.privacy = settings);
        let saved = self.settings.as_ref().map_or_else(
            || Err("there is no settings folder to save to".to_owned()),
            |store| store.save(settings).map_err(|error| error.to_string()),
        );
        if let Err(error) = saved {
            set_error(
                &self.state,
                format!(
                    "Could not save privacy settings; they apply until Scout restarts: {error}"
                ),
            );
        }
    }

    /// Queue a product event; the collector sends it unless the user has
    /// turned usage data off.
    pub fn report_usage(&self, event: UsageEvent) {
        self.usage.push(event);
    }

    /// Request graceful background shutdown.
    pub fn shutdown(&self) {
        if self.shutdown.send(true).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Shut the collector down and wait for its thread to finish, so another
    /// collector can take over the outbox.
    pub fn stop(self) {
        self.shutdown();
        if self.thread.join().is_err() {
            info!("Scout Client collector thread had panicked");
        }
    }
}
