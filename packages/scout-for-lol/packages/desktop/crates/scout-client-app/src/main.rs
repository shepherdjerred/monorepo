#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Scout Client native entry point.

mod runtime;
mod startup;
mod ui;

use std::panic::AssertUnwindSafe;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use eframe::egui;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use tracing_subscriber::EnvFilter;

use crate::runtime::ClientRuntime;
use crate::ui::ScoutApp;

const APP_ID: &str = "com.scout-for-lol.client";
const DEFAULT_BACKEND_ORIGIN: &str = "https://beta.scout-for-lol.com";

fn backend_origin(arguments: &[String]) -> String {
    arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("--server=").map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_BACKEND_ORIGIN.to_owned())
}

/// Install the console logger.
///
/// The release Windows build is a GUI-subsystem binary with no valid stdout
/// handle, so this reaches a human only under `cargo run`. The durable record
/// is the JSONL log the runtime writes; see `scout_client_core::diagnostics`.
/// The filter defaults to `info` because an unset `RUST_LOG` otherwise silences
/// everything below `error`, including the warnings worth seeing.
fn install_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
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

fn main() -> eframe::Result {
    install_logging();

    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let background = arguments.iter().any(|argument| argument == "--background");
    let runtime = Rc::new(ClientRuntime::start(backend_origin(&arguments)));
    let diagnostics = Arc::clone(runtime.diagnostics());
    install_panic_hook(Arc::clone(&diagnostics));
    let started = Instant::now();
    // The window is the client's most fragile part: glow and wgpu both panic
    // on Windows when the GPU context is lost (sleep/resume, a driver reset, a
    // hybrid-GPU switch). A panic must not take collection down with it.
    let window = std::panic::catch_unwind(AssertUnwindSafe(|| {
        run_window(background, Rc::clone(&runtime))
    }));
    let Err(_) = window else {
        return window.unwrap_or(Ok(()));
    };
    // The window is gone, but its collector still runs; stop it so the
    // relaunched client is the only one reading and sending the outbox.
    if let Some(runtime) = Rc::into_inner(runtime) {
        runtime.stop();
    } else {
        diagnostics.record(window_crash_event(
            DiagnosticOutcome::Failed,
            "the crashed window still held the collector".to_owned(),
        ));
    }
    let quick_restarts = quick_restarts(&arguments);
    let Some(next) = next_quick_restarts(quick_restarts, started.elapsed()) else {
        diagnostics.record(window_crash_event(
            DiagnosticOutcome::Failed,
            format!("not restarting after {quick_restarts} quick window crashes"),
        ));
        std::process::exit(1);
    };
    let relaunch = std::env::current_exe().and_then(|executable| {
        std::process::Command::new(executable)
            .args(relaunch_arguments(&arguments, next))
            .spawn()
    });
    diagnostics.record(match relaunch {
        Ok(_) => window_crash_event(
            DiagnosticOutcome::Deferred,
            "relaunched the client".to_owned(),
        ),
        Err(error) => window_crash_event(
            DiagnosticOutcome::Failed,
            format!("could not relaunch the client: {error}"),
        ),
    });
    std::process::exit(1);
}

/// How many times in a row the window has crashed soon after starting.
const QUICK_RESTARTS_ARGUMENT: &str = "--quick-restarts=";
/// A crash after this long is a fresh incident, not part of a crash loop.
const STABLE_RUN: Duration = Duration::from_mins(10);
/// Consecutive quick crashes after which the client stops relaunching.
const MAX_QUICK_RESTARTS: u32 = 3;

fn quick_restarts(arguments: &[String]) -> u32 {
    arguments
        .iter()
        .find_map(|argument| argument.strip_prefix(QUICK_RESTARTS_ARGUMENT))
        .and_then(|count| count.parse().ok())
        .unwrap_or(0)
}

/// The quick-crash count to relaunch with, or `None` to stop relaunching.
fn next_quick_restarts(previous: u32, ran_for: Duration) -> Option<u32> {
    let previous = if ran_for >= STABLE_RUN { 0 } else { previous };
    (previous < MAX_QUICK_RESTARTS).then_some(previous + 1)
}

/// The same arguments, with the quick-crash count replaced.
fn relaunch_arguments(arguments: &[String], quick_restarts: u32) -> Vec<String> {
    arguments
        .iter()
        .filter(|argument| !argument.starts_with(QUICK_RESTARTS_ARGUMENT))
        .cloned()
        .chain([format!("{QUICK_RESTARTS_ARGUMENT}{quick_restarts}")])
        .collect()
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

/// Run the window. glow is the renderer: it ran for days at a time here, and
/// wgpu panicked within a minute on the same hybrid-GPU machine.
fn run_window(background: bool, runtime: Rc<ClientRuntime>) -> eframe::Result {
    let viewport = egui::ViewportBuilder::default()
        .with_app_id(APP_ID)
        .with_title("Scout Client")
        .with_visible(!background)
        .with_inner_size([760.0, 520.0])
        .with_min_inner_size([620.0, 420.0]);
    let options = eframe::NativeOptions {
        viewport,
        renderer: eframe::Renderer::Glow,
        ..Default::default()
    };
    eframe::run_native(
        "Scout Client",
        options,
        Box::new(move |context| Ok(Box::new(ScoutApp::new(context, runtime)))),
    )
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        DEFAULT_BACKEND_ORIGIN, MAX_QUICK_RESTARTS, STABLE_RUN, backend_origin,
        next_quick_restarts, quick_restarts, relaunch_arguments,
    };

    #[test]
    fn a_crash_loop_stops_relaunching() {
        let soon = Duration::from_secs(30);
        assert_eq!(next_quick_restarts(0, soon), Some(1));
        assert_eq!(
            next_quick_restarts(MAX_QUICK_RESTARTS - 1, soon),
            Some(MAX_QUICK_RESTARTS)
        );
        assert_eq!(next_quick_restarts(MAX_QUICK_RESTARTS, soon), None);
    }

    #[test]
    fn a_crash_after_a_stable_run_starts_the_count_over() {
        assert_eq!(next_quick_restarts(MAX_QUICK_RESTARTS, STABLE_RUN), Some(1));
    }

    #[test]
    fn a_relaunch_keeps_its_arguments_and_replaces_the_count() {
        let arguments = [
            "--background".to_owned(),
            "--quick-restarts=1".to_owned(),
            "--server=https://beta.scout-for-lol.com".to_owned(),
        ];
        assert_eq!(quick_restarts(&arguments), 1);
        assert_eq!(
            relaunch_arguments(&arguments, 2),
            [
                "--background",
                "--server=https://beta.scout-for-lol.com",
                "--quick-restarts=2",
            ]
        );
        assert_eq!(quick_restarts(&["--background".to_owned()]), 0);
    }

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
