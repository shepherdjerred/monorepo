//! Chat components: the virtual transcript, streamed Markdown, tool summary
//! rows and the composer, over gpui-kit's message scroller, text view and
//! input.

use std::rc::Rc;

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::message_scroller::{MessageScroller, MessageScrollerState};
use gpui_kit::component::text::TextView;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::{
    AnyElement, App, AppContext as _, Context, ElementId, Entity, Focusable as _, FontWeight,
    IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, px,
};
use scout_desktop_ipc::{ChatRole, ChatToolStatus};

use super::theme::{color, length, theme};
use crate::chat_model::{COMPOSER_PLACEHOLDER, ToolRow, TranscriptRow, stream_fade};

/// The transcript's virtual-list state, owned by the window's view.
pub struct TranscriptState {
    list: Entity<MessageScrollerState>,
    keys: Vec<String>,
}

impl TranscriptState {
    /// An empty transcript that follows its newest row.
    pub fn new<V: 'static>(cx: &mut Context<V>) -> Self {
        Self {
            list: cx.new(|cx| MessageScrollerState::new(0, cx)),
            keys: Vec::new(),
        }
    }

    /// Match the list to `keys`, the rows about to render. New rows reset it
    /// (still following the tail); the same rows remeasure the last one,
    /// whose streamed text may have grown.
    pub fn sync(&mut self, keys: Vec<String>, cx: &mut App) {
        let count = keys.len();
        if keys == self.keys {
            if count > 0 {
                self.list.update(cx, |list, cx| {
                    list.remeasure_items(count - 1..count, cx);
                });
            }
            return;
        }
        let appended = keys.len() > self.keys.len() && keys.starts_with(&self.keys);
        let added = count - self.keys.len().min(count);
        self.list.update(cx, |list, cx| {
            if appended {
                list.append(added, cx);
            } else {
                list.reset(count, cx);
            }
        });
        self.keys = keys;
    }
}

/// The composer's text state, owned by the window's view.
pub struct ComposerState {
    input: Entity<InputState>,
}

impl ComposerState {
    /// An empty composer. `on_submit` runs when Return is pressed in it.
    pub fn new<V: 'static>(
        window: &mut Window,
        cx: &mut Context<V>,
        on_submit: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    ) -> (Self, gpui_kit::Subscription) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(COMPOSER_PLACEHOLDER));
        let subscription = cx.subscribe_in(
            &input,
            window,
            move |view, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { shift: false, .. } = event {
                    on_submit(view, window, cx);
                }
            },
        );
        (Self { input }, subscription)
    }

    /// What has been typed.
    #[must_use]
    pub fn text(&self, cx: &App) -> String {
        self.input.read(cx).value().to_string()
    }

    /// Empty the composer after a send.
    pub fn clear(&self, window: &mut Window, cx: &mut App) {
        self.input
            .update(cx, |input, cx| input.set_value("", window, cx));
    }

    /// Put the keyboard in the composer.
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.input.update(cx, |input, cx| input.focus(window, cx));
    }

    /// Whether the composer has the keyboard.
    #[must_use]
    pub fn is_focused(&self, window: &Window, cx: &App) -> bool {
        self.input.read(cx).focus_handle(cx).is_focused(window)
    }

    /// The text field, first in the window's keyboard order.
    #[must_use]
    pub fn field(&self, tab_index: isize) -> impl IntoElement {
        Input::new(&self.input).tab_index(tab_index)
    }
}

fn tool_glyph(status: ChatToolStatus) -> (&'static str, u32) {
    let tokens = theme();
    match status {
        ChatToolStatus::Running => ("•", tokens.info),
        ChatToolStatus::Succeeded => ("✓", tokens.success_on_surface),
        ChatToolStatus::Failed => ("✕", tokens.danger_on_surface),
        ChatToolStatus::Interrupted => ("–", tokens.text_muted),
    }
}

fn tool_row(row: &ToolRow) -> impl IntoElement {
    let tokens = theme();
    let (glyph, glyph_color) = tool_glyph(row.status);
    h_flex()
        .gap_2()
        .text_sm()
        .child(div().w(px(14.)).text_color(color(glyph_color)).child(glyph))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(color(tokens.text))
                .child(SharedString::from(row.label.clone())),
        )
        .child(
            div()
                .text_color(color(tokens.text_muted))
                .child(SharedString::from(
                    row.duration
                        .clone()
                        .unwrap_or_else(|| row.status_label.to_owned()),
                )),
        )
}

fn tool_summary(rows: &[ToolRow]) -> Option<AnyElement> {
    if rows.is_empty() {
        return None;
    }
    let tokens = theme();
    Some(
        v_flex()
            .gap_1()
            .p_2()
            .rounded(length(tokens.radius_small))
            .border(length(tokens.border_width))
            .border_color(color(tokens.border))
            .bg(color(tokens.surface))
            .children(rows.iter().map(tool_row))
            .into_any_element(),
    )
}

/// One transcript row: a question bubble, or an answer with its steps.
#[derive(IntoElement)]
struct Row {
    row: TranscriptRow,
}

impl RenderOnce for Row {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let row = self.row;
        let text_id = ElementId::Name(SharedString::from(format!("chat-text-{}", row.key)));
        if row.role == ChatRole::User {
            return h_flex()
                .w_full()
                .justify_end()
                .child(
                    div()
                        .max_w(px(460.))
                        .px_3()
                        .py_2()
                        .rounded(length(tokens.radius_medium))
                        .bg(color(tokens.surface_raised))
                        .text_color(color(tokens.text))
                        .child(TextView::markdown(text_id, row.text).selectable(true)),
                )
                .into_any_element();
        }
        let fade = stream_fade(row.streaming, cx.reduce_motion());
        v_flex()
            .w_full()
            .gap_2()
            .children(tool_summary(&row.tools))
            .children((!row.text.is_empty()).then(|| {
                div().w_full().text_color(color(tokens.text)).child(
                    TextView::markdown(text_id, row.text)
                        .stream_fade(fade)
                        .selectable(true),
                )
            }))
            .children(row.activity.map(|activity| {
                div()
                    .text_sm()
                    .text_color(color(tokens.text_muted))
                    .child(SharedString::from(activity))
            }))
            .children(row.caveats.into_iter().map(|caveat| {
                div()
                    .text_sm()
                    .text_color(color(tokens.text_muted))
                    .child(SharedString::from(caveat))
            }))
            .children(row.error.map(|error| {
                div()
                    .text_sm()
                    .text_color(color(tokens.danger_on_surface))
                    .child(SharedString::from(error))
            }))
            .into_any_element()
    }
}

/// The transcript: a virtual list that follows the newest row.
#[derive(IntoElement)]
pub struct Transcript {
    list: Entity<MessageScrollerState>,
    rows: Rc<Vec<TranscriptRow>>,
}

impl Transcript {
    /// `rows`, rendered through `state`, which must have been synced to them.
    #[must_use]
    pub fn new(state: &TranscriptState, rows: Vec<TranscriptRow>) -> Self {
        Self {
            list: state.list.clone(),
            rows: Rc::new(rows),
        }
    }
}

impl RenderOnce for Transcript {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let rows = self.rows;
        MessageScroller::new("chat-transcript", self.list, move |index, _, _| {
            match rows.get(index) {
                Some(row) => Row { row: row.clone() }.into_any_element(),
                // The list and the rows are synced before every render; a
                // row past the end means they were not.
                None => div().into_any_element(),
            }
        })
        .size_full()
    }
}

/// A one-line status above the composer, such as the reconnect indicator.
#[must_use]
pub fn status_line(text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(color(theme().text_muted))
        .child(text.into())
}
