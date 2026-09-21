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

fn main() -> eframe::Result {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let background = arguments.iter().any(|argument| argument == "--background");
    let backend_origin = arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("--server=").map(str::to_owned))
        .unwrap_or_else(|| "https://scout-for-lol.com".to_owned());
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
