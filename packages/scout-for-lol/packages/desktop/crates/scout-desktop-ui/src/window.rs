//! The gpui-kit window process: renders what the supervisor sends and sends
//! every action back as a command.

use std::io::{Stdout, Write};
use std::process::ExitCode;
use std::rc::Rc;

use scout_desktop_ipc::WindowMessage;

use crate::kit::prelude::{App, Context, IntoElement, Render, Task, Window};
use crate::kit::{self, Handler, NavItem, Shell};
use crate::link::{Effect, Incoming, Outbound, WindowState, read_lines};
use crate::view_model::{
    ActivityModel, BuildInfo, DiagnosticsModel, OverviewModel, PageId, SettingsModel,
    should_quit_on_close,
};
use crate::views;

/// The exit status for a broken link. The supervisor treats it like a crash.
const LINK_BROKEN: u8 = 3;

/// Run the window until it closes. A clean close exits 0; a broken link to
/// the supervisor exits 3, which the supervisor treats like a crash.
///
/// `on_error_reports` is told the user's "Send error reports" choice each time
/// the supervisor's snapshot arrives, so an opt-out reaches this process's own
/// error reporter without a restart.
#[must_use]
pub fn run(build: BuildInfo, on_error_reports: impl Fn(bool) + 'static) -> ExitCode {
    let outbound = Outbound::new(std::io::stdout());
    if !outbound.hello() {
        eprintln!("Scout Client window: the supervisor is not listening");
        return ExitCode::from(LINK_BROKEN);
    }
    let (sender, receiver) = async_channel::unbounded();
    std::thread::spawn(move || {
        read_lines(std::io::stdin().lock(), |incoming| {
            sender.send_blocking(incoming).is_ok()
        });
    });

    let app_outbound = outbound.clone();
    let privacy_listener: PrivacyListener = Rc::new(on_error_reports);
    kit::run_application(move |cx| {
        let closed_outbound = app_outbound.clone();
        kit::on_window_closed(cx, move |cx| exit_after_close(&closed_outbound, cx));
        let opened = kit::open_main_window(cx, "Scout Client", move |window, cx| {
            ScoutWindow::new(window, cx, receiver, app_outbound, build)
                .with_privacy_listener(privacy_listener)
        });
        if let Err(error) = opened {
            eprintln!("Scout Client window: could not open a window: {error}");
            std::process::exit(1);
        }
    });
    exit_status(&outbound)
}

/// The window is gone, so the process ends. A broken link exits with a crash
/// status before the platform's own quit, which on macOS ends the process
/// with status 0.
fn exit_after_close(outbound: &Outbound<Stdout>, cx: &App) {
    if let Some(failure) = outbound.failure() {
        eprintln!("Scout Client window: {failure}");
        std::process::exit(i32::from(LINK_BROKEN));
    }
    kit::quit(cx);
}

fn exit_status(outbound: &Outbound<Stdout>) -> ExitCode {
    match outbound.failure() {
        Some(failure) => {
            eprintln!("Scout Client window: {failure}");
            ExitCode::from(LINK_BROKEN)
        }
        None => ExitCode::SUCCESS,
    }
}

/// Told whether error reports are allowed, after every snapshot.
type PrivacyListener = Rc<dyn Fn(bool)>;

/// The root view. Production writes to stdout; the render test writes to a
/// buffer.
pub struct ScoutWindow<W> {
    privacy_listener: Option<PrivacyListener>,
    link: WindowState,
    outbound: Outbound<W>,
    page: PageId,
    closing: bool,
    build: BuildInfo,
    _listener: Task<()>,
}

impl<W: Write + 'static> ScoutWindow<W> {
    /// A window that renders what arrives on `receiver` and sends commands
    /// through `outbound`.
    pub fn new(
        window: &mut Window,
        cx: &mut Context<Self>,
        receiver: async_channel::Receiver<Incoming>,
        outbound: Outbound<W>,
        build: BuildInfo,
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
        let this = cx.weak_entity();
        kit::on_close_requested(window, cx, move |_, cx| {
            let _ = this.update(cx, |this, _| this.close_requested());
        });
        Self {
            privacy_listener: None,
            link: WindowState::default(),
            outbound,
            page: PageId::default(),
            closing: false,
            build,
            _listener: listener,
        }
    }

    /// Follow the user's error-report choice from every snapshot.
    #[must_use]
    fn with_privacy_listener(mut self, listener: PrivacyListener) -> Self {
        self.privacy_listener = Some(listener);
        self
    }

    /// Handle one event from the supervisor. Returns whether to keep
    /// listening.
    fn incoming(
        &mut self,
        incoming: Incoming,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match incoming {
            Incoming::Line(line) => match self.link.receive(&line) {
                Ok(Effect::Render) => {
                    if self.link.state_received
                        && let Some(listener) = &self.privacy_listener
                    {
                        listener(self.link.state.privacy.send_error_reports);
                    }
                    cx.notify();
                    true
                }
                Ok(Effect::CopyBundle(text)) => {
                    kit::copy_to_clipboard(cx, text);
                    true
                }
                Ok(Effect::Show) => {
                    kit::bring_to_front(window);
                    true
                }
                Ok(Effect::Close) => {
                    self.close(window);
                    false
                }
                Err(failure) => {
                    self.outbound.fail(failure);
                    self.close(window);
                    false
                }
            },
            Incoming::Closed(failure) => {
                // The supervisor closed our stdin: it quit or died.
                if let Some(failure) = failure {
                    self.outbound.fail(failure);
                }
                self.close(window);
                false
            }
        }
    }

    fn close(&mut self, window: &mut Window) {
        if !self.closing {
            self.closing = true;
            kit::close_window(window);
        }
    }

    /// The user closed the window.
    fn close_requested(&mut self) {
        if should_quit_on_close(self.closing, self.link.tray_available()) {
            // Nothing else could reopen the window, so closing it quits Scout.
            let _delivered = self.outbound.send(&WindowMessage::Quit);
        }
        self.closing = true;
    }

    fn sender(&self) -> impl Fn(WindowMessage) -> Handler + use<W> {
        let outbound = self.outbound.clone();
        move |message: WindowMessage| -> Handler {
            let outbound = outbound.clone();
            Rc::new(move |window: &mut Window, _: &mut App| {
                if !outbound.send(&message) {
                    // The supervisor is gone; the close handler exits with
                    // the crash status.
                    kit::close_window(window);
                }
            })
        }
    }
}

impl<W: Write + 'static> Render for ScoutWindow<W> {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let navigate = |page: PageId| -> Handler {
            let select = cx.listener(move |this: &mut Self, (): &(), _, cx| {
                this.page = page;
                cx.notify();
            });
            Rc::new(move |window, cx| select(&(), window, cx))
        };
        frame(self.page, &self.link, self.build, &self.sender(), &navigate)
    }
}

/// The whole window for `current`: navigation and the page, from the
/// supervisor's state.
fn frame(
    current: PageId,
    link: &WindowState,
    build: BuildInfo,
    send: &views::Send,
    navigate: &dyn Fn(PageId) -> Handler,
) -> Shell {
    let navigation = PageId::ALL
        .into_iter()
        .map(|page| NavItem::new(page.label(), page.label(), page == current, navigate(page)))
        .collect();
    let state = &link.state;
    let page = match current {
        PageId::Overview => views::overview(OverviewModel::new(state)).into_any_element(),
        PageId::Activity => views::activity(ActivityModel::new(state)).into_any_element(),
        PageId::Settings => views::settings(&SettingsModel::new(state), send).into_any_element(),
        PageId::Diagnostics => {
            views::diagnostics(DiagnosticsModel::new(state, &link.phase, build), send)
                .into_any_element()
        }
    };
    Shell::new("Scout", navigation, page)
}

/// The pieces the offscreen render test drives the real window with.
#[doc(hidden)]
pub mod preview {
    pub use super::ScoutWindow;
    use crate::kit::prelude::App;
    pub use crate::link::{Incoming, Outbound};

    /// Initialize gpui-kit and install the Scout theme.
    pub fn prepare(cx: &mut App) {
        crate::kit::prepare(cx);
    }
}
