//! The gpui-kit window process: renders what the supervisor sends and sends
//! every action back as a command.

use std::io::{Stdout, Write};
use std::process::ExitCode;
use std::rc::Rc;

use std::path::PathBuf;

use scout_desktop_ipc::{ChatCommand, WindowMessage};

use crate::chat_model::{
    ChatScreen, ChatUi, SidebarModel, UiAction, edit_message, edit_target_shown, send_message,
};
use crate::chat_view::{self, ChatControls, TAB_SIDEBAR};
use crate::kit::prelude::{App, Context, IntoElement, Render, Subscription, Task, Window};
use crate::kit::{
    self, ComposerState, ControlHandler, Handler, NavItem, NavSection, Shell, TranscriptState,
};
use crate::link::{Effect, Incoming, Outbound, WindowState, read_lines};
use crate::view_model::{
    ActivityModel, BuildInfo, DiagnosticsModel, OverviewModel, PageId, SettingsModel,
    should_quit_on_close,
};
use crate::views;
use crate::voice_model::{ConsentDialog, MicIndicator, VoiceSettingsModel, VoiceTurnModel};

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
    composer: ComposerState,
    transcript: TranscriptState,
    /// What only this window knows about the chat page.
    ui: ChatUi,
    /// Share was clicked: copy the link when the supervisor reports it.
    copy_share_link: bool,
    _composer_events: Subscription,
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
        let (composer, composer_events) =
            ComposerState::new(window, cx, |this: &mut Self, window, cx| {
                this.submit(window, cx);
            });
        // Chat is the main screen, and its composer is first in the keyboard
        // order, so the window opens ready to type.
        composer.focus(window, cx);
        Self {
            privacy_listener: None,
            link: WindowState::default(),
            outbound,
            page: PageId::default(),
            closing: false,
            build,
            transcript: TranscriptState::new(cx),
            ui: ChatUi::default(),
            copy_share_link: false,
            composer,
            _composer_events: composer_events,
            _listener: listener,
        }
    }

    /// What only this window knows, with whether a game is live.
    fn chat_ui(&self) -> ChatUi {
        ChatUi {
            live_game: self.link.live_game.is_some(),
            ..self.ui
        }
    }

    /// The chat screen for the latest parts.
    fn chat_screen(&self) -> ChatScreen {
        ChatScreen::with_ui(
            &self.link.chat,
            &self.link.state,
            &self.link.update,
            self.chat_ui(),
        )
    }

    /// Keep the transcript's virtual list in step with the rows it renders.
    fn sync_transcript(&mut self, cx: &mut App) {
        let keys = match self.chat_screen() {
            ChatScreen::Conversation(model) => model.rows.into_iter().map(|row| row.key).collect(),
            ChatScreen::Loading | ChatScreen::Gate(_) => Vec::new(),
        };
        self.transcript.sync(keys, cx);
    }

    /// Send what the composer holds, when the chat can take a question.
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ChatScreen::Conversation(model) = self.chat_screen() else {
            return;
        };
        if !model.composer.can_send {
            return;
        }
        let text = self.composer.text(cx);
        // While a question is being edited, sending adds a version of that
        // turn instead of asking a new question.
        let editing = model.composer.editing.is_some().then_some(self.ui.editing);
        let message = match editing.flatten() {
            Some(message_id) => edit_message(message_id, &text),
            None => send_message(
                &text,
                model
                    .composer
                    .live_game
                    .as_ref()
                    .is_some_and(|chip| chip.on),
            ),
        };
        let Some(message) = message else {
            return;
        };
        if self.outbound.send(&message) {
            self.composer.clear(window, cx);
            self.ui.editing = None;
            cx.notify();
        } else {
            // The supervisor is gone; the close handler exits with the crash
            // status.
            kit::close_window(window);
        }
    }

    /// Cancel an edit whose question is no longer on screen, as Cancel does:
    /// otherwise its text stays in the composer and sends as a new question
    /// to whatever is open now.
    fn drop_stale_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(message_id) = self.ui.editing
            && !edit_target_shown(&self.link.chat, message_id)
        {
            self.ui.editing = None;
            self.composer.clear(window, cx);
        }
    }

    /// Copy the share link once the supervisor reports it, if the user
    /// just asked for one.
    fn copy_new_share_link(&mut self, cx: &mut Context<Self>) {
        if !self.copy_share_link {
            return;
        }
        let link = self
            .link
            .chat
            .transcript
            .as_ref()
            .and_then(|transcript| transcript.share_url.clone());
        if let Some(link) = link {
            self.copy_share_link = false;
            kit::copy_to_clipboard(cx, link);
        }
    }

    /// Do what a chat button asked.
    fn perform(&mut self, action: &UiAction, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            UiAction::Send(message) => {
                if !self.outbound.send(message) {
                    // The supervisor is gone; the close handler exits with
                    // the crash status.
                    kit::close_window(window);
                    return;
                }
                match message {
                    WindowMessage::Chat {
                        command: ChatCommand::Share,
                    } => self.copy_share_link = true,
                    WindowMessage::Chat {
                        command: ChatCommand::ChooseModel { .. },
                    } => self.ui.picker_open = false,
                    _ => {}
                }
            }
            UiAction::Edit { message_id, text } => {
                self.ui.editing = Some(*message_id);
                self.composer.set_text(text, window, cx);
            }
            UiAction::CancelEdit => {
                self.ui.editing = None;
                self.composer.clear(window, cx);
            }
            UiAction::TogglePicker => self.ui.picker_open = !self.ui.picker_open,
            UiAction::ToggleLiveGame => self.ui.live_game_off = !self.ui.live_game_off,
            UiAction::PickImage => {
                let attach = self.attach_files();
                kit::pick_images(cx, move |paths| attach(paths));
            }
            UiAction::CopyLink(url) => kit::copy_to_clipboard(cx, url.clone()),
        }
        cx.notify();
    }

    /// Sends one attach command per image file: for the file picker and for
    /// pasted pictures.
    fn attach_files(&self) -> Rc<dyn Fn(Vec<PathBuf>)> {
        let outbound = self.outbound.clone();
        Rc::new(move |paths| {
            for path in paths {
                let _delivered = outbound.send(&WindowMessage::Chat {
                    command: ChatCommand::Attach {
                        path: path.to_string_lossy().into_owned(),
                    },
                });
            }
        })
    }

    /// Whether the composer has the keyboard, for the offscreen test.
    #[doc(hidden)]
    pub fn composer_focused(&self, window: &Window, cx: &App) -> bool {
        self.composer.is_focused(window, cx)
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
                    self.drop_stale_edit(window, cx);
                    self.sync_transcript(cx);
                    self.copy_new_share_link(cx);
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
        let submit = {
            let submit =
                cx.listener(|this: &mut Self, (): &(), window, cx| this.submit(window, cx));
            Rc::new(move |window: &mut Window, cx: &mut App| submit(&(), window, cx)) as Handler
        };
        let send = self.sender();
        let perform = Rc::new(cx.listener(
            |this: &mut Self, action: &UiAction, window: &mut Window, cx: &mut Context<Self>| {
                this.perform(action, window, cx);
            },
        ));
        let handler: ControlHandler = Rc::new(move |action: &UiAction| -> Handler {
            let action = action.clone();
            let perform = Rc::clone(&perform);
            Rc::new(move |window: &mut Window, cx: &mut App| perform(&action, window, cx))
        });
        let chat = ChatControls {
            composer: &self.composer,
            transcript: &self.transcript,
            submit,
            send: &send,
            handler,
            on_images: self.attach_files(),
            voice_turn: VoiceTurnModel::new(self.link.voice_turn.as_ref()),
        };
        frame(
            self.page,
            &self.link,
            self.build,
            self.chat_ui(),
            chat,
            &navigate,
        )
    }
}

/// Both handlers, in order: a sidebar entry that sends a chat command also
/// shows the chat page.
fn both(first: Handler, second: Handler) -> Handler {
    Rc::new(move |window, cx| {
        first(window, cx);
        second(window, cx);
    })
}

/// The sidebar: New chat and the conversations, then the status pages.
fn sidebar(
    current: PageId,
    link: &WindowState,
    send: &views::Send,
    navigate: &dyn Fn(PageId) -> Handler,
) -> (NavSection, NavSection) {
    let model = SidebarModel::new(&link.chat, current == PageId::Chat);
    let mut tab = TAB_SIDEBAR;
    let mut next_tab = || {
        let index = tab;
        tab += 1;
        index
    };
    let mut conversations = vec![
        NavItem::new(
            model.new_chat.id,
            model.new_chat.label,
            model.new_chat_selected,
            both(send(model.new_chat.message.clone()), navigate(PageId::Chat)),
        )
        .tab_index(next_tab()),
    ];
    conversations.extend(model.conversations.into_iter().map(|entry| {
        NavItem::new(
            format!("conversation-{}", entry.id),
            entry.title,
            entry.selected,
            both(send(entry.message), navigate(PageId::Chat)),
        )
        .tab_index(next_tab())
    }));
    let status = PageId::STATUS
        .into_iter()
        .map(|page| {
            NavItem::new(page.label(), page.label(), page == current, navigate(page))
                .tab_index(next_tab())
        })
        .collect();
    (
        NavSection::new("Chats", conversations),
        NavSection::new("Status", status),
    )
}

/// The whole window for `current`: the sidebar and the page, from the
/// supervisor's state.
fn frame(
    current: PageId,
    link: &WindowState,
    build: BuildInfo,
    ui: ChatUi,
    chat: ChatControls<'_>,
    navigate: &dyn Fn(PageId) -> Handler,
) -> Shell {
    let send = chat.send;
    let (conversations, status) = sidebar(current, link, send, navigate);
    let state = &link.state;
    let page = match current {
        PageId::Chat => chat_view::chat_page(
            ChatScreen::with_ui(&link.chat, state, &link.update, ui),
            chat,
        )
        .into_any_element(),
        PageId::Overview => views::overview(
            OverviewModel::new(state)
                .with_update(&link.update)
                .with_live_game(link.live_game.as_ref()),
        )
        .into_any_element(),
        PageId::Activity => views::activity(ActivityModel::new(state)).into_any_element(),
        PageId::Settings => views::settings(
            &SettingsModel::new(state),
            VoiceSettingsModel::new(&link.voice),
            send,
        )
        .into_any_element(),
        PageId::Diagnostics => {
            views::diagnostics(DiagnosticsModel::new(state, &link.phase, build), send)
                .into_any_element()
        }
    };
    Shell::new("Scout", conversations, status, page)
        .status(views::mic_pill(MicIndicator::new(&link.voice), send))
        .overlay(views::consent_dialog(ConsentDialog::new(&link.voice), send))
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
