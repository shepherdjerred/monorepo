//! The window process: today's egui UI, fed by the supervisor over stdio.
//!
//! This process holds no collector, outbox or instance lock. It reads
//! [`SupervisorMessage`]s from stdin on a background thread and writes
//! [`WindowMessage`]s to stdout. Logging goes to stderr so it never mixes with
//! the protocol.

use std::io::{BufRead, Write};
use std::process::ExitCode;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use eframe::egui;
use scout_desktop_ipc::{
    GameflowPhase, PROTOCOL_VERSION, StateSnapshot, SupervisorMessage, WindowMessage,
    check_protocol, decode_line, encode_line,
};

use crate::ui::ScoutApp;

const APP_ID: &str = "com.scout-for-lol.client";

/// Run the window until it closes. A clean close exits 0; a broken link to the
/// supervisor exits 3, which the supervisor treats like a crash.
pub fn run() -> ExitCode {
    let link = SupervisorLink::default();
    if !link.send(&WindowMessage::Hello {
        protocol: PROTOCOL_VERSION,
    }) {
        eprintln!("Scout Client window: the supervisor is not listening");
        return ExitCode::from(3);
    }
    let result = run_native(link.clone());
    if let Some(failure) = link.failure() {
        eprintln!("Scout Client window: {failure}");
        return ExitCode::from(3);
    }
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Scout Client window: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Run the window. glow is the renderer: it ran for days at a time here, and
/// wgpu panicked within a minute on the same hybrid-GPU machine.
fn run_native(link: SupervisorLink) -> eframe::Result {
    let viewport = egui::ViewportBuilder::default()
        .with_app_id(APP_ID)
        .with_title("Scout Client")
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
        Box::new(move |context| Ok(Box::new(ScoutApp::new(context, link)))),
    )
}

/// What the supervisor has said since the last frame.
#[derive(Debug, Default)]
struct Inbox {
    tray_available: Option<bool>,
    state: StateSnapshot,
    phase: GameflowPhase,
    bundle: Option<String>,
    show: bool,
    close: bool,
    failure: Option<String>,
}

/// One frame's view of the inbox.
#[derive(Debug)]
pub struct Updates {
    /// Whether a tray can reopen the window; `false` until the supervisor
    /// says otherwise, so closing never strands a user with no way back.
    pub tray_available: bool,
    /// The latest runtime snapshot.
    pub state: StateSnapshot,
    /// The latest gameflow phase.
    pub phase: GameflowPhase,
    /// A diagnostics bundle to copy, once.
    pub bundle: Option<String>,
    /// Bring the window to the front, once.
    pub show: bool,
    /// Close the window: Scout is quitting or the supervisor is gone.
    pub close: bool,
}

/// The window's end of the stdio link.
#[derive(Debug, Clone, Default)]
pub struct SupervisorLink {
    inbox: Arc<Mutex<Inbox>>,
}

impl SupervisorLink {
    fn inbox(&self) -> MutexGuard<'_, Inbox> {
        self.inbox.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Read the supervisor's messages on a background thread, repainting
    /// `context` after each.
    pub fn listen(&self, context: egui::Context) {
        let inbox = Arc::clone(&self.inbox);
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                let failure = match line {
                    Ok(line) => receive(&inbox, &line).err(),
                    Err(error) => Some(format!("could not read the supervisor: {error}")),
                };
                if let Some(failure) = failure {
                    let mut inbox = inbox.lock().unwrap_or_else(PoisonError::into_inner);
                    inbox.failure = Some(failure);
                    inbox.close = true;
                    context.request_repaint();
                    return;
                }
                context.request_repaint();
            }
            // The supervisor closed our stdin: it quit or died.
            inbox.lock().unwrap_or_else(PoisonError::into_inner).close = true;
            context.request_repaint();
        });
    }

    /// Send one message. Returns `false`, and closes the window, when the
    /// supervisor is gone.
    pub fn send(&self, message: &WindowMessage) -> bool {
        let written = encode_line(message)
            .map_err(|error| error.to_string())
            .and_then(|line| {
                let mut stdout = std::io::stdout().lock();
                stdout
                    .write_all(line.as_bytes())
                    .and_then(|()| stdout.flush())
                    .map_err(|error| format!("could not write to the supervisor: {error}"))
            });
        match written {
            Ok(()) => true,
            Err(failure) => {
                let mut inbox = self.inbox();
                inbox.failure = Some(failure);
                inbox.close = true;
                false
            }
        }
    }

    /// Take this frame's updates.
    pub fn updates(&self) -> Updates {
        let mut inbox = self.inbox();
        Updates {
            tray_available: inbox.tray_available.unwrap_or(false),
            state: inbox.state.clone(),
            phase: inbox.phase.clone(),
            bundle: inbox.bundle.take(),
            show: std::mem::take(&mut inbox.show),
            close: inbox.close,
        }
    }

    fn failure(&self) -> Option<String> {
        self.inbox().failure.clone()
    }
}

fn receive(inbox: &Mutex<Inbox>, line: &str) -> Result<(), String> {
    let message = decode_line::<SupervisorMessage>(line).map_err(|error| error.to_string())?;
    let mut inbox = inbox.lock().unwrap_or_else(PoisonError::into_inner);
    match message {
        SupervisorMessage::Hello {
            protocol,
            tray_available,
        } => {
            check_protocol(protocol).map_err(|mismatch| mismatch.to_string())?;
            inbox.tray_available = Some(tray_available);
        }
        SupervisorMessage::State { state } => inbox.state = state,
        SupervisorMessage::Phase { phase } => inbox.phase = phase,
        SupervisorMessage::DiagnosticsBundle { text } => inbox.bundle = Some(text),
        SupervisorMessage::Show => inbox.show = true,
        SupervisorMessage::Close => inbox.close = true,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use scout_desktop_ipc::{GameflowPhase, PROTOCOL_VERSION, SupervisorMessage, encode_line};

    use super::{Inbox, receive};

    fn line(message: &SupervisorMessage) -> Result<String, scout_desktop_ipc::CodecError> {
        encode_line(message)
    }

    #[test]
    fn supervisor_messages_update_the_inbox() -> Result<(), Box<dyn std::error::Error>> {
        let inbox = Mutex::new(Inbox::default());
        receive(
            &inbox,
            &line(&SupervisorMessage::Hello {
                protocol: PROTOCOL_VERSION,
                tray_available: true,
            })?,
        )?;
        receive(
            &inbox,
            &line(&SupervisorMessage::Phase {
                phase: GameflowPhase::Lobby,
            })?,
        )?;
        receive(&inbox, &line(&SupervisorMessage::Show)?)?;
        let inbox = inbox.into_inner()?;
        assert_eq!(inbox.tray_available, Some(true));
        assert_eq!(inbox.phase, GameflowPhase::Lobby);
        assert!(inbox.show);
        assert!(!inbox.close);
        Ok(())
    }

    #[test]
    fn a_mismatched_or_unknown_message_breaks_the_link() -> Result<(), Box<dyn std::error::Error>> {
        let inbox = Mutex::new(Inbox::default());
        let hello = line(&SupervisorMessage::Hello {
            protocol: PROTOCOL_VERSION + 1,
            tray_available: true,
        })?;
        assert!(receive(&inbox, &hello).is_err());
        assert!(receive(&inbox, "{\"type\":\"reformat\"}").is_err());
        Ok(())
    }
}
