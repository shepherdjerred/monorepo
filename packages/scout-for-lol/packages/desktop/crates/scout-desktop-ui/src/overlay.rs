//! The in-game overlay process: one click-through card window over the game.
//!
//! The supervisor starts this as `scout-client --overlay` when a game reaches
//! `InProgress` and sends [`OverlayCommand`]s on stdin: what to draw, and when
//! to close. This process sends its hello and then either
//! [`OverlayReport::Ready`] once the window is open and lets clicks through,
//! or [`OverlayReport::Unavailable`] and exits, so a window that would take the
//! player's clicks is never left on screen. The overlay takes no input; the
//! supervisor owns the hotkeys.

use std::cell::RefCell;
use std::io::Write as _;
use std::process::ExitCode;
use std::rc::Rc;

use scout_desktop_ipc::{
    OverlayCommand, OverlayFrame, OverlayReport, PROTOCOL_VERSION, check_protocol, decode_line,
    encode_line,
};

use crate::kit::prelude::{
    Context, IntoElement, ParentElement as _, Render, Styled as _, Task, Window,
};
use crate::kit::{self, column};
use crate::link::{Incoming, read_lines};
use crate::native;
use crate::overlay_model::{OverlayCardModel, window_bounds};

/// The exit status for a broken link; the supervisor treats it like a crash.
const LINK_BROKEN: i32 = 3;

/// Write one report to the supervisor. `false` when it is gone.
fn report(message: &OverlayReport) -> bool {
    let Ok(line) = encode_line(message) else {
        return false;
    };
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(line.as_bytes())
        .and_then(|()| stdout.flush())
        .is_ok()
}

/// Report that the overlay cannot be drawn and end the process.
fn unavailable(reason: String) -> ! {
    eprintln!("Scout overlay: {reason}");
    let _delivered = report(&OverlayReport::Unavailable { reason });
    std::process::exit(0);
}

/// End the process for a broken link.
fn broken(failure: &str) -> ! {
    eprintln!("Scout overlay: {failure}");
    std::process::exit(LINK_BROKEN);
}

/// Run the overlay until the supervisor closes it.
pub fn run_overlay() -> ExitCode {
    if !report(&OverlayReport::Hello {
        protocol: PROTOCOL_VERSION,
    }) {
        eprintln!("Scout overlay: the supervisor is not listening");
        return ExitCode::from(3);
    }
    let (sender, receiver) = async_channel::unbounded();
    std::thread::spawn(move || {
        read_lines(std::io::stdin().lock(), |incoming| {
            sender.send_blocking(incoming).is_ok()
        });
    });
    kit::run_application(move |cx| {
        kit::stay_in_background(cx);
        let Some(display) = kit::primary_display(cx) else {
            unavailable("there is no display to draw on".to_owned());
        };
        let bounds = match window_bounds(display) {
            Ok(bounds) => bounds,
            Err(error) => unavailable(format!("no place for the overlay: {error}")),
        };
        let click_through: Rc<RefCell<Option<Result<String, String>>>> = Rc::default();
        let applied = Rc::clone(&click_through);
        let opened = kit::open_overlay_window(cx, bounds, move |window, cx| {
            *applied.borrow_mut() = Some(native::make_click_through(window));
            OverlayWindow::new(window, cx, receiver)
        });
        if let Err(error) = opened {
            unavailable(format!("could not open the overlay window: {error}"));
        }
        match click_through.borrow_mut().take() {
            Some(Ok(probe)) => {
                // What the platform reports back about the window, for the
                // log: proof the styles held, not just that they were asked.
                eprintln!("Scout overlay: {probe}");
                if !report(&OverlayReport::Ready) {
                    broken("the supervisor stopped listening");
                }
            }
            Some(Err(reason)) => unavailable(reason),
            None => unavailable("the overlay window was never built".to_owned()),
        }
    });
    ExitCode::SUCCESS
}

/// The overlay's root view: the current card, or nothing. The offscreen render
/// test drives it with the same IPC lines the supervisor sends.
pub struct OverlayWindow {
    greeted: bool,
    frame: Option<OverlayFrame>,
    _listener: Task<()>,
}

impl OverlayWindow {
    /// A view that draws what arrives on `receiver`.
    pub fn new(
        window: &mut Window,
        cx: &mut Context<Self>,
        receiver: async_channel::Receiver<Incoming>,
    ) -> Self {
        let listener = cx.spawn_in(window, async move |this, cx| {
            while let Ok(incoming) = receiver.recv().await {
                let keep_listening = this
                    .update_in(cx, |this, window, cx| this.incoming(incoming, window, cx))
                    .unwrap_or(false);
                if !keep_listening {
                    break;
                }
            }
        });
        Self {
            greeted: false,
            frame: None,
            _listener: listener,
        }
    }

    /// Apply one event from the supervisor. Returns whether to keep
    /// listening.
    fn incoming(
        &mut self,
        incoming: Incoming,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let line = match incoming {
            Incoming::Line(line) => line,
            Incoming::Closed(None) => {
                // The supervisor closed our stdin: it quit or died.
                kit::close_window(window);
                kit::quit(cx);
                return false;
            }
            Incoming::Closed(Some(failure)) => broken(&failure),
        };
        match decode_line::<OverlayCommand>(&line) {
            Ok(OverlayCommand::Hello { protocol }) => {
                if let Err(mismatch) = check_protocol(protocol) {
                    broken(&mismatch.to_string());
                }
                self.greeted = true;
                true
            }
            Ok(_) if !self.greeted => broken("the supervisor sent a command before its hello"),
            Ok(OverlayCommand::Frame { frame }) => {
                self.frame = frame;
                cx.notify();
                true
            }
            Ok(OverlayCommand::Close) => {
                kit::close_window(window);
                kit::quit(cx);
                false
            }
            Err(error) => broken(&error.to_string()),
        }
    }
}

impl Render for OverlayWindow {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        column().size_full().children(
            self.frame
                .as_ref()
                .map(|frame| kit::overlay_card(OverlayCardModel::new(frame))),
        )
    }
}
