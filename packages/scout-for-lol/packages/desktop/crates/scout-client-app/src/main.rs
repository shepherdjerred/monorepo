#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

//! Scout Client native entry point.
//!
//! One executable, three processes. Started normally it is the supervisor: it
//! owns the instance lock and the collector, never touches the GPU, and runs
//! the window as a child (`--window`) that it relaunches when it crashes.
//! The window renders with egui unless `SCOUT_DESKTOP_UI=gpui` or `--ui=gpui`
//! selects the gpui-kit window (`scout-desktop-ui`). With the gpui window, the
//! supervisor also runs chat and, on Windows and macOS, voice: it owns the
//! microphone and the global keys, and the window only shows them. On Windows
//! and macOS it also runs the in-game overlay as a second child (`--overlay`)
//! while a game is in progress.

#[cfg_attr(
    not(any(target_os = "windows", target_os = "macos")),
    expect(
        dead_code,
        reason = "Linux builds have no microphone, so the voice service is never started"
    )
)]
mod hotkeys;
mod supervisor;
mod toolkit;
mod tray;
mod ui;
mod updater;
#[cfg_attr(
    not(any(target_os = "windows", target_os = "macos")),
    expect(
        dead_code,
        reason = "Linux builds have no microphone, so the voice service is never started"
    )
)]
mod voice;
mod window;

use std::panic::AssertUnwindSafe;
use std::process::ExitCode;
use std::sync::Arc;

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::profile::ReleaseProfile;
use scout_client_core::reporting::{
    ReportingProcess, reporting_environment, start_error_reporting,
};
use scout_client_runtime::instance::InstanceLock;
use scout_client_runtime::runtime::ClientRuntime;
use scout_explore_client::relay::ChatRelay;
use tokio::sync::mpsc;
use tracing_subscriber::EnvFilter;

use crate::supervisor::{Supervisor, SupervisorExit, WindowLauncher};
use crate::toolkit::{UI_ENVIRONMENT, WindowToolkit};
use crate::voice::VoiceInputs;

/// The argument that makes this executable the window process.
const WINDOW_ARGUMENT: &str = "--window";
/// The argument that makes this executable the in-game overlay process.
const OVERLAY_ARGUMENT: &str = "--overlay";

fn backend_origin(arguments: &[String]) -> String {
    arguments
        .iter()
        .find_map(|argument| argument.strip_prefix("--server=").map(str::to_owned))
        .unwrap_or_else(|| ReleaseProfile::compiled().backend_origin.to_owned())
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
    if arguments
        .iter()
        .any(|argument| argument == OVERLAY_ARGUMENT)
    {
        return run_overlay(&arguments);
    }
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

/// Run as the in-game overlay. It reports its own panics like the window.
fn run_overlay(arguments: &[String]) -> ExitCode {
    let gates = scout_client_runtime::runtime::load_privacy_gates();
    let _reporting = start_error_reporting(
        reporting_environment(&backend_origin(arguments)),
        ReportingProcess::Overlay,
        gates.error_reports,
    );
    #[cfg(any(windows, target_os = "macos"))]
    return scout_desktop_ui::run_overlay();
    // The supervisor starts the overlay only where the build contains it.
    #[cfg(not(any(windows, target_os = "macos")))]
    return ExitCode::from(2);
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
    // Both children label their error reports beta or production.
    let server = format!("--server={}", backend_origin(arguments));
    let launcher = WindowLauncher::new(
        executable.clone(),
        vec![
            WINDOW_ARGUMENT.to_owned(),
            toolkit.argument().to_owned(),
            server.clone(),
        ],
    );
    let overlay_launcher =
        WindowLauncher::new(executable, vec![OVERLAY_ARGUMENT.to_owned(), server]);
    let origin = backend_origin(arguments);
    let (control, control_receiver) = mpsc::unbounded_channel();
    let (hotkey_events, hotkey_receiver) = mpsc::unbounded_channel();
    let voice_control = control.clone();
    let server_overridden = arguments
        .iter()
        .any(|argument| argument.starts_with("--server="));
    let exit = tray::run(
        control,
        hotkey_events,
        Box::new(move |tray| {
            let diagnostics = Arc::clone(runtime.diagnostics());
            let voice_inputs = VoiceInputs {
                phase: runtime.gameflow_phase(),
                state: runtime.state(),
                hotkeys: hotkey_receiver,
                chat: None,
                control: voice_control,
            };
            let supervisor = Supervisor::new(
                instance_lock,
                runtime,
                launcher,
                control_receiver,
                tray.tray_available,
                !background,
            );
            // A supervisor panic must end the process rather than leave a
            // tray with nothing behind it; the panic hook has recorded it.
            std::panic::catch_unwind(AssertUnwindSafe(|| {
                async_runtime.block_on(async move {
                    // The updater's task lives on this runtime, off the tray's
                    // event loop.
                    let supervisor =
                        match updater::start_for_this_build(server_overridden, diagnostics) {
                            Some(updates) => supervisor.with_updates(updates),
                            None => supervisor,
                        };
                    // The overlay's cards come from chat and voice, which
                    // only the gpui window's supervisor runs.
                    let supervisor = if toolkit == WindowToolkit::Gpui {
                        with_chat_and_voice(supervisor, origin, tray.hotkeys, voice_inputs)
                            .with_overlay(overlay_launcher, tray.overlay_keys)
                    } else {
                        supervisor
                    };
                    supervisor.run().await
                })
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

/// Only the gpui window renders chat and voice. The relay holds the device
/// credential in the supervisor, and voice holds the microphone there, never
/// in the window process. Call on the supervisor's runtime.
fn with_chat_and_voice(
    supervisor: Supervisor<ClientRuntime>,
    origin: String,
    hotkeys: Option<Box<dyn hotkeys::HotkeyPort>>,
    voice_inputs: VoiceInputs,
) -> Supervisor<ClientRuntime> {
    let chat = ChatRelay::spawn(
        origin.clone(),
        scout_client_runtime::runtime::explore_cache_directory(),
    );
    let supervisor = supervisor
        .with_chat(chat.clone())
        .with_reviews(Box::new(supervisor::ScoutReviews::new(origin.clone())));
    let inputs = VoiceInputs {
        chat: Some(chat),
        ..voice_inputs
    };
    match start_voice(origin, hotkeys, inputs) {
        Some(voice) => supervisor.with_voice(voice),
        None => supervisor,
    }
}

/// Start voice with the default microphone and speaker, the models beside
/// the executable or in the data directory, and the settings file.
#[cfg(any(target_os = "windows", target_os = "macos"))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "the Linux build of this function has no voice to return"
)]
fn start_voice(
    origin: String,
    hotkeys: Option<Box<dyn hotkeys::HotkeyPort>>,
    inputs: VoiceInputs,
) -> Option<voice::VoiceHandle> {
    let ports = voice::VoicePorts {
        engine: Box::new(voice::device::ModelEngine::new(
            std::env::current_exe().ok(),
            scout_client_runtime::runtime::data_directory(),
        )),
        #[cfg(scout_proactive_coach)]
        proactive: Box::new(voice::ScoutProactiveSpeech::new(origin.clone())),
        turns: Box::new(voice::turns::ScoutTurns::new(origin)),
        speaker: Box::new(scout_voice::playback::device::CpalSpeaker::default()),
        store: Box::new(voice::FileStore(
            scout_client_runtime::runtime::settings_store(),
        )),
        hotkeys,
    };
    Some(voice::spawn(ports, inputs))
}

/// Linux builds have no microphone support, so no voice.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn start_voice(
    _origin: String,
    _hotkeys: Option<Box<dyn hotkeys::HotkeyPort>>,
    _inputs: VoiceInputs,
) -> Option<voice::VoiceHandle> {
    None
}

#[cfg(test)]
mod tests {
    use scout_client_core::profile::{BETA, ReleaseProfile, STABLE};
    use scout_client_core::reporting::reporting_environment;

    use super::backend_origin;

    #[test]
    fn the_packaged_build_targets_its_profile_backend() {
        assert_eq!(
            backend_origin(&[]),
            ReleaseProfile::compiled().backend_origin
        );
    }

    #[test]
    fn stable_reports_as_production_and_beta_as_beta() {
        assert_eq!(reporting_environment(STABLE.backend_origin), "production");
        assert_eq!(reporting_environment(BETA.backend_origin), "beta");
    }

    #[test]
    fn explicit_server_overrides_the_packaged_origin() {
        assert_eq!(
            backend_origin(&["--server=http://127.0.0.1:3000".to_owned()]),
            "http://127.0.0.1:3000"
        );
    }
}
