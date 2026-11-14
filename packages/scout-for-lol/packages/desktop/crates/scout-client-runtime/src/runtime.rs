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
    BugsinkSink, ReportingGuard, reporting_environment, reporting_status, start_error_reporting,
};
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

pub(crate) use paths::data_directory;
pub use state::{GameflowPhase, RuntimeState};

/// Latest-value subscription to the UI snapshot.
pub type StateReceiver = watch::Receiver<RuntimeState>;
/// Latest-value subscription to the typed gameflow phase.
pub type PhaseReceiver = watch::Receiver<GameflowPhase>;

use collector::run_collector;
use paths::log_directory;
use state::{StateHub, set_error};

enum RuntimeCommand {
    StartPairing,
    Disconnect,
    SetStartAtLogin(bool),
}

/// Handle owned by the desktop application.
pub struct ClientRuntime {
    state: Arc<StateHub>,
    diagnostics: Arc<Diagnostics>,
    log_directory: Option<PathBuf>,
    /// Flushes queued error reports when the runtime is dropped.
    _reporting: Option<ReportingGuard>,
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
        // Only when this build has somewhere to report to; the guard must
        // outlive the process, so it is held here.
        let reporting = start_error_reporting(reporting_environment(&backend_origin));
        if reporting.is_some() {
            diagnostics = diagnostics.with_sink(Box::new(BugsinkSink));
        }
        let diagnostics = Arc::new(diagnostics);
        diagnostics.record(reporting_status());
        let (shutdown, shutdown_receiver) = watch::channel(false);
        let (commands, command_receiver) = mpsc::unbounded_channel();
        let worker_state = Arc::clone(&state);
        let worker_diagnostics = Arc::clone(&diagnostics);
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
            ));
        });
        Self {
            state,
            diagnostics,
            log_directory,
            _reporting: reporting,
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
