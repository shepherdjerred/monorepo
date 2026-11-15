//! The chat page, rendered from its view model with the Scout kit.
//!
//! Keyboard order on this page: the composer, Send, Stop, Attach, the model
//! picker, then the sidebar (New chat, each conversation, the status pages).
//! [`TAB_COMPOSER`] and the constants after it fix that order; the sidebar
//! starts at [`TAB_SIDEBAR`].

use std::path::PathBuf;
use std::rc::Rc;

use crate::chat_model::{
    ChatScreen, ComposerModel, ConversationModel, EMPTY_HINT, GateModel, RECONNECTING_LABEL,
};
use crate::kit::prelude::{IntoElement, ParentElement as _, Styled as _};
use crate::kit::{
    ButtonStyle, ComposerState, ControlHandler, Handler, Page, ScoutButton, Transcript,
    TranscriptState, action_row, body_text, column, control_button, draft_strip, error_notice,
    note_text, row, section_heading, status_line,
};
use crate::views::{Send, button};

/// The composer's place in the keyboard order: first.
pub const TAB_COMPOSER: isize = 1;
/// Send, after the composer.
pub const TAB_SEND: isize = 2;
/// Stop, after Send.
pub const TAB_STOP: isize = 3;
/// Attach image, after Stop.
pub const TAB_ATTACH: isize = 4;
/// The model picker, after Attach image.
pub const TAB_PICKER: isize = 5;
/// The first sidebar entry; the rest follow in order.
pub const TAB_SIDEBAR: isize = 10;

/// What the chat page needs from the window beyond its model.
pub struct ChatControls<'a> {
    /// The composer's text state.
    pub composer: &'a ComposerState,
    /// The transcript's list state, synced to the model's rows.
    pub transcript: &'a TranscriptState,
    /// Sends what is typed.
    pub submit: Handler,
    /// Sends one command to the supervisor.
    pub send: &'a Send,
    /// Turns a chat button's action into its click handler.
    pub handler: ControlHandler,
    /// Attaches the image files a paste carried.
    pub on_images: Rc<dyn Fn(Vec<PathBuf>)>,
}

/// The chat page for `screen`.
pub fn chat_page(screen: ChatScreen, controls: ChatControls<'_>) -> impl IntoElement {
    match screen {
        ChatScreen::Loading => Page::new("Chat")
            .child(note_text("Connecting to Scout…"))
            .into_any_element(),
        ChatScreen::Gate(model) => gate(model, controls.send).into_any_element(),
        ChatScreen::Conversation(model) => conversation(*model, controls).into_any_element(),
    }
}

fn gate(model: GateModel, send: &Send) -> impl IntoElement {
    Page::new(model.title)
        .child(body_text(model.body))
        .children(model.detail.map(note_text))
        .child(
            action_row().children(model.actions.iter().enumerate().map(|(index, action)| {
                button(action, send).tab_index(TAB_COMPOSER + isize::try_from(index).unwrap_or(0))
            })),
        )
}

fn conversation(model: ConversationModel, controls: ChatControls<'_>) -> impl IntoElement {
    let ChatControls {
        composer,
        transcript,
        submit,
        send,
        handler,
        on_images,
    } = controls;
    let body = if model.loading {
        column()
            .px_6()
            .child(note_text("Loading the conversation…"))
            .into_any_element()
    } else if model.rows.is_empty() {
        column()
            .px_6()
            .gap_2()
            .child(section_heading("Ask Scout"))
            .child(note_text(EMPTY_HINT))
            .into_any_element()
    } else {
        // The list pads its rows itself, so it spans the page width and its
        // scrollbar stays inside the page's right margin.
        column()
            .size_full()
            .pl_3()
            .pr_6()
            .child(Transcript::new(transcript, model.rows, handler.clone()))
            .into_any_element()
    };
    let send_button = ScoutButton::new("chat-send", "Send", ButtonStyle::Primary, submit)
        .tab_index(TAB_SEND)
        .disabled(!model.composer.can_send);
    let stop_button = model.composer.can_stop.then(|| {
        ScoutButton::new(
            "chat-stop",
            "Stop",
            ButtonStyle::Secondary,
            send(crate::chat_model::stop_message()),
        )
        .tab_index(TAB_STOP)
    });
    let header_buttons = model
        .header
        .iter()
        .map(|control| control_button(control, ButtonStyle::Secondary, &handler));
    column()
        .size_full()
        .child(
            row()
                .px_6()
                .pt_5()
                .pb_2()
                .gap_3()
                .child(
                    column()
                        .flex_1()
                        .min_w_0()
                        .child(section_heading(model.title)),
                )
                .children(model.reconnecting.then(|| status_line(RECONNECTING_LABEL)))
                .children(header_buttons),
        )
        .children(model.share_url.map(|url| {
            column().px_6().pb_2().child(note_text(format!(
                "Anyone with this link can read the conversation: {url}"
            )))
        }))
        .child(column().flex_1().min_h_0().child(body))
        .children(
            model
                .notice
                .map(|notice| column().px_6().child(error_notice(notice))),
        )
        .child(composer_area(
            &model.composer,
            composer,
            send_button,
            stop_button,
            &handler,
            on_images,
        ))
}

/// Everything under the transcript: the editing banner, the images waiting,
/// the model picker, and the composer row.
fn composer_area(
    model: &ComposerModel,
    composer: &ComposerState,
    send_button: ScoutButton,
    stop_button: Option<ScoutButton>,
    handler: &ControlHandler,
    on_images: Rc<dyn Fn(Vec<PathBuf>)>,
) -> impl IntoElement {
    let attach =
        control_button(&model.attach, ButtonStyle::Secondary, handler).tab_index(TAB_ATTACH);
    let picker = model.picker.as_ref().map(|picker| {
        column()
            .gap_1()
            .child(row().child(
                control_button(&picker.toggle, ButtonStyle::Quiet, handler).tab_index(TAB_PICKER),
            ))
            .children(picker.open.then(|| {
                row()
                    .gap_2()
                    .flex_wrap()
                    .children(picker.options.iter().map(|option| {
                        control_button(
                            &option.control,
                            if option.selected {
                                ButtonStyle::Primary
                            } else {
                                ButtonStyle::Secondary
                            },
                            handler,
                        )
                    }))
            }))
    });
    column()
        .px_6()
        .pt_3()
        .pb_5()
        .gap_2()
        .children(model.editing.as_ref().map(|editing| {
            row()
                .gap_2()
                .child(note_text(editing.label))
                .child(control_button(&editing.cancel, ButtonStyle::Quiet, handler))
        }))
        .children((!model.drafts.is_empty()).then(|| draft_strip(&model.drafts, handler)))
        .children(picker)
        .child(
            row()
                .gap_2()
                .child(attach)
                .child(
                    column()
                        .flex_1()
                        .min_w_0()
                        .child(composer.field(TAB_COMPOSER, on_images)),
                )
                .child(send_button)
                .children(stop_button),
        )
}
