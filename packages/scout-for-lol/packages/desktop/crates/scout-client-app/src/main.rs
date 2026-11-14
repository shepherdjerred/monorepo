#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Scout Client native entry point.
//!
//! One executable, two processes. Started normally it is the supervisor: it
//! owns the instance lock and the collector, never touches the GPU, and runs
//! the window as a child (`--window`) that it relaunches when it crashes.
//! The window renders with egui unless `SCOUT_DESKTOP_UI=gpui` or `--ui=gpui`
//! selects the gpui-kit window (`scout-desktop-ui`).

mod supervisor;
mod toolkit;
mod tray;
mod ui;
mod window;

use std::panic::AssertUnwindSafe;
use std::process::ExitCode;
use std::sync::Arc;

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::reporting::{
    ReportingProcess, reporting_environment, start_error_reporting,
};
use scout_client_runtime::instance::InstanceLock;
use scout_client_runtime::runtime::ClientRuntime;
use tokio::sync::mpsc;
use tracing_subscriber::EnvFilter;

use crate::supervisor::{Supervisor, SupervisorExit, WindowLauncher};
use crate::toolkit::{UI_ENVIRONMENT, WindowToolkit};

const DEFAULT_BACKEND_ORIGIN: &str = "https://beta.scout-for-lol.com";
/// The argument that makes this executable the window process.
const WINDOW_ARGUMENT: &str = "--window";

fn backend_origin(arguments: &[String]) -> String {
    arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("--server=").map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_BACKEND_ORIGIN.to_owned())
}

/// Install the console logger, on stderr: the window process's stdout carries
/// the supervisor protocol.
///
/// The release Windows build is a GUI-subsystem binary with no valid stderr
/// handle, so this reaches a human only under `cargo run`. The durable record
/// is the JSONL log the runtime writes; see `scout_client_core::diagnostics`.
/// The filter defaults to `info` because an unset `RUST_LOG` otherwise silences
/// everything below `error`, including the warnings worth seeing.
fn install_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(std::io::stderr)
        .compact()
        .init();
}

/// Record a panic before the process unwinds.
///
/// A crash is the one failure a user can always see and never report usefully,
/// so it must survive in the same file as everything else.
fn install_panic_hook(diagnostics: Arc<Diagnostics>) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // The payload can carry arbitrary text; the location is bounded and is
        // what actually identifies the fault.
        let detail = info
            .location()
            .map_or_else(|| "unknown location".to_owned(), ToString::to_string);
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Critical,
                DiagnosticCategory::Runtime,
                "panic",
                DiagnosticOutcome::Failed,
            )
            .with_detail(detail),
        );
        previous(info);
    }));
}

fn main() -> ExitCode {
    install_logging();
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let environment = std::env::var(UI_ENVIRONMENT).ok();
    let toolkit = match WindowToolkit::select(&arguments, environment.as_deref()) {
        Ok(toolkit) if toolkit.available() => toolkit,
        Ok(toolkit) => {
            eprintln!(
                "Scout Client: {} is built only for Windows and macOS",
                toolkit.argument()
            );
            return ExitCode::from(2);
        }
        Err(error) => {
            eprintln!("Scout Client: {error}");
            return ExitCode::from(2);
        }
    };
    if arguments.iter().any(|argument| argument == WINDOW_ARGUMENT) {
        return run_window(toolkit, &arguments);
    }
    supervise(&arguments, toolkit)
}

/// Run as the window process with the toolkit the supervisor chose.
///
/// The window reports its own panics, so it starts its own error reporter.
/// Its gate begins as the stored choice and then follows every snapshot the
/// supervisor sends. A GPU abort that kills the process outright cannot report
/// itself; the supervisor reports that as a `window_crash`.
fn run_window(toolkit: WindowToolkit, arguments: &[String]) -> ExitCode {
    let gates = scout_client_runtime::runtime::load_privacy_gates();
    let error_gate = gates.error_reports;
    let _reporting = start_error_reporting(
        reporting_environment(&backend_origin(arguments)),
        ReportingProcess::Window,
        error_gate.clone(),
    );
    match toolkit {
        WindowToolkit::Egui => window::run(error_gate),
        #[cfg(any(windows, target_os = "macos"))]
        WindowToolkit::Gpui => scout_desktop_ui::run(
            scout_desktop_ui::BuildInfo {
                client_version: env!("CARGO_PKG_VERSION"),
                protocol_version: scout_client_core::protocol::PROTOCOL_VERSION,
            },
            move |allowed| error_gate.set(allowed),
        ),
        // `main` refuses a toolkit this build does not contain.
        #[cfg(not(any(windows, target_os = "macos")))]
        WindowToolkit::Gpui => ExitCode::from(2),
    }
}

/// Run as the supervisor: own the instance lock and the collector, and run the
/// window as a child process.
fn supervise(arguments: &[String], toolkit: WindowToolkit) -> ExitCode {
    let background = arguments.iter().any(|argument| argument == "--background");
    // Held until the supervisor ends, so a second launch never reads the same
    // outbox. The window process never takes it.
    let instance_lock = match InstanceLock::acquire() {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("{error}");
            tracing::error!(%error, "another Scout Client instance is running");
            return ExitCode::from(2);
        }
    };
    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            eprintln!("Scout Client cannot locate its own executable: {error}");
            return ExitCode::FAILURE;
        }
    };
    let async_runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Scout Client could not start its supervisor: {error}");
            return ExitCode::FAILURE;
        }
    };
    let runtime = ClientRuntime::start(backend_origin(arguments));
    install_panic_hook(Arc::clone(runtime.diagnostics()));
    tracing::info!(?toolkit, "Scout Client window toolkit");
    let launcher = WindowLauncher::new(
        executable,
        vec![
            WINDOW_ARGUMENT.to_owned(),
            toolkit.argument().to_owned(),
            // The window labels its error reports beta or production.
            format!("--server={}", backend_origin(arguments)),
        ],
    );
    let (control, control_receiver) = mpsc::unbounded_channel();
    let exit = tray::run(
        control,
        Box::new(move |tray_available| {
            let supervisor = Supervisor::new(
                instance_lock,
                runtime,
                launcher,
                control_receiver,
                tray_available,
                !background,
            );
            // A supervisor panic must end the process rather than leave a
            // tray with nothing behind it; the panic hook has recorded it.
            std::panic::catch_unwind(AssertUnwindSafe(|| {
                async_runtime.block_on(supervisor.run())
            }))
            .unwrap_or(SupervisorExit::Panicked)
        }),
    );
    tracing::info!(?exit, "Scout Client stopped");
    if exit == SupervisorExit::Panicked {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_BACKEND_ORIGIN, backend_origin};

    #[test]
    fn packaged_preview_targets_the_beta_backend() {
        assert_eq!(backend_origin(&[]), DEFAULT_BACKEND_ORIGIN);
    }

    #[test]
    fn explicit_server_overrides_the_packaged_origin() {
        assert_eq!(
            backend_origin(&["--server=http://127.0.0.1:3000".to_owned()]),
            "http://127.0.0.1:3000"
        );
    }
}
