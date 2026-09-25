#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Scout Client native entry point.

mod runtime;
mod startup;
mod ui;

use std::sync::Arc;

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
    let backend_origin = backend_origin(&arguments);
    let runtime = ClientRuntime::start(backend_origin);
    install_panic_hook(Arc::clone(runtime.diagnostics()));
    let viewport = egui::ViewportBuilder::default()
        .with_app_id(APP_ID)
        .with_title("Scout Client")
        .with_visible(!background)
        .with_inner_size([760.0, 520.0])
        .with_min_inner_size([620.0, 420.0]);
    let options = eframe::NativeOptions {
        viewport,
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
