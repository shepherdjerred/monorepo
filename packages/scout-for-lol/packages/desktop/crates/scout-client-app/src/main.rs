#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Scout Client native entry point.

mod runtime;
mod startup;
mod ui;

use eframe::egui;
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

fn main() -> eframe::Result {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let background = arguments.iter().any(|argument| argument == "--background");
    let backend_origin = backend_origin(&arguments);
    let runtime = ClientRuntime::start(backend_origin);
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
