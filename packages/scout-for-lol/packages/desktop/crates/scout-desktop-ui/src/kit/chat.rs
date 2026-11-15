//! Chat components: the virtual transcript, streamed Markdown, tool summary
//! rows and the composer, over gpui-kit's message scroller, text view and
//! input.

use std::path::PathBuf;
use std::rc::Rc;

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::message_scroller::{MessageScroller, MessageScrollerState};
use gpui_kit::component::text::TextView;
use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::{
    AnyElement, App, AppContext as _, ClipboardEntry, ClipboardItem, Context, ElementId, Entity,
    Focusable as _, FontWeight, ImageFormat, IntoElement, ObjectFit, ParentElement, RenderOnce,
    SharedString, Styled, StyledImage as _, Window, div, img, px,
};
use scout_desktop_ipc::{ChatRole, ChatToolStatus};

use super::components::{ButtonStyle, Handler, ScoutButton};
use super::theme::{color, length, theme};
use crate::chat_model::{
    COMPOSER_PLACEHOLDER, Control, DraftView, ImageView, SwitcherView, ToolRow, TranscriptRow,
    UiAction, stream_fade,
};

/// Turns a chat button's action into the click handler the window owns: most
/// send a command, a few change the window's own state.
pub type ControlHandler = Rc<dyn Fn(&UiAction) -> Handler>;

/// A chat button for `control`, disabled when it cannot be used now.
#[must_use]
pub fn control_button(
    control: &Control,
    style: ButtonStyle,
    handler: &ControlHandler,
) -> ScoutButton {
    ScoutButton::new(
        ElementId::Name(SharedString::from(control.id.clone())),
        control.label.clone(),
        style,
        handler(&control.action),
    )
    .disabled(!control.enabled)
}

/// Where the image-paste handler saves a pasted picture so the supervisor
/// can read it: the window has the bytes, the supervisor has the credential.
const PASTE_DIRECTORY: &str = "scout-chat-paste";

/// The image files a paste carries: a copied picture, saved to a file, or
/// copied image files. Only PNG, JPEG and WebP pictures count; a paste with
/// none of those is left to the text field.
#[must_use]
pub fn pasted_images(item: &ClipboardItem) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for entry in item.entries() {
        match entry {
            ClipboardEntry::Image(image) => {
                let extension = match image.format {
                    ImageFormat::Png => "png",
                    ImageFormat::Jpeg => "jpg",
                    ImageFormat::Webp => "webp",
                    _ => continue,
                };
                let directory = std::env::temp_dir().join(PASTE_DIRECTORY);
                let path = directory.join(format!("paste-{}.{extension}", uuid::Uuid::new_v4()));
                if std::fs::create_dir_all(&directory).is_ok()
                    && std::fs::write(&path, &image.bytes).is_ok()
                {
                    paths.push(path);
                }
                // One picture per paste: the clipboard often offers the same
                // picture in several formats.
                break;
            }
            ClipboardEntry::ExternalPaths(files) => paths.extend(
                files
                    .paths()
                    .iter()
                    .filter(|path| {
                        path.extension()
                            .and_then(|extension| extension.to_str())
                            .is_some_and(|extension| {
                                matches!(
                                    extension.to_ascii_lowercase().as_str(),
                                    "png" | "jpg" | "jpeg" | "webp"
                                )
                            })
                    })
                    .cloned(),
            ),
            ClipboardEntry::String(_) => {}
        }
    }
    paths
}

/// Ask the system's file picker for images, then call `attach` with the
/// chosen files. Nothing is called when the picker is cancelled.
pub fn pick_images(cx: &mut App, attach: impl Fn(Vec<PathBuf>) + 'static) {
    let chosen = cx.prompt_for_paths(gpui_kit::PathPromptOptions {
        files: true,
        directories: false,
        multiple: true,
        prompt: Some("Attach".into()),
    });
    cx.spawn(async move |_| {
        if let Ok(Ok(Some(paths))) = chosen.await {
            attach(paths);
        }
    })
    .detach();
}

/// A square picture, or a labelled tile when there is no file to draw.
fn thumbnail(source: Option<&str>, label: &str, size: f32) -> AnyElement {
    let tokens = theme();
    let frame = div()
        .size(px(size))
        .flex_none()
        .overflow_hidden()
        .rounded(length(tokens.radius_small))
        .border(length(tokens.border_width))
        .border_color(color(tokens.border))
        .bg(color(tokens.surface));
    match source {
        Some(path) => frame
            .child(
                img(PathBuf::from(path))
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            )
            .into_any_element(),
        None => frame
            .flex()
            .items_center()
            .justify_center()
            .text_xs()
            .text_color(color(tokens.text_muted))
            .child(SharedString::from(label.to_owned()))
            .into_any_element(),
    }
}

fn image_strip(images: &[ImageView]) -> Option<AnyElement> {
    (!images.is_empty()).then(|| {
        h_flex()
            .gap_2()
            .justify_end()
            .children(
                images
                    .iter()
                    .map(|image| thumbnail(image.thumbnail.as_deref(), &image.label, 72.)),
            )
            .into_any_element()
    })
}

fn switcher(view: &SwitcherView, handler: &ControlHandler) -> AnyElement {
    h_flex()
        .gap_1()
        .child(control_button(&view.previous, ButtonStyle::Quiet, handler))
        .child(
            div()
                .text_sm()
                .text_color(color(theme().text_muted))
                .child(SharedString::from(view.label.clone())),
        )
        .child(control_button(&view.next, ButtonStyle::Quiet, handler))
        .into_any_element()
}

fn row_actions(row: &TranscriptRow, handler: &ControlHandler) -> Option<AnyElement> {
    (row.switcher.is_some() || !row.actions.is_empty()).then(|| {
        h_flex()
            .gap_2()
            .children(row.switcher.iter().map(|view| switcher(view, handler)))
            .children(
                row.actions
                    .iter()
                    .map(|action| control_button(action, ButtonStyle::Quiet, handler)),
            )
            .into_any_element()
    })
}

/// The images waiting in the composer: a thumbnail each, with its state and
/// a Remove button.
#[must_use]
pub fn draft_strip(drafts: &[DraftView], handler: &ControlHandler) -> impl IntoElement {
    let tokens = theme();
    h_flex()
        .gap_3()
        .flex_wrap()
        .children(drafts.iter().map(|draft| {
            v_flex()
                .w(px(72.))
                .gap_1()
                .child(thumbnail(Some(&draft.thumbnail), &draft.name, 72.))
                .child(
                    div()
                        .text_xs()
                        .truncate()
                        .text_color(color(tokens.text_muted))
                        .child(SharedString::from(draft.name.clone())),
                )
                .children(draft.status.iter().map(|status| {
                    div()
                        .text_xs()
                        .text_color(color(if draft.failed {
                            tokens.danger_on_surface
                        } else {
                            tokens.text_muted
                        }))
                        .child(SharedString::from(status.clone()))
                }))
                .child(control_button(&draft.remove, ButtonStyle::Quiet, handler))
        }))
}

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

    /// Replace what is typed, such as with a question to edit, and put the
    /// cursor in the field.
    pub fn set_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.input.update(cx, |input, cx| {
            input.set_value(text.to_owned(), window, cx);
            input.focus(window, cx);
        });
    }

    /// The text field, first in the window's keyboard order. A paste that
    /// carries pictures calls `on_images` with their files instead of
    /// inserting anything; a text paste is left to the field.
    #[must_use]
    pub fn field(&self, tab_index: isize, on_images: Rc<dyn Fn(Vec<PathBuf>)>) -> impl IntoElement {
        Input::new(&self.input)
            .tab_index(tab_index)
            .on_paste(move |item, _, _| {
                let images = pasted_images(item);
                let handled = !images.is_empty();
                if handled {
                    on_images(images);
                }
                handled
            })
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
    handler: ControlHandler,
}

impl RenderOnce for Row {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let row = self.row;
        let handler = self.handler;
        let text_id = ElementId::Name(SharedString::from(format!("chat-text-{}", row.key)));
        if row.role == ChatRole::User {
            return v_flex()
                .w_full()
                .gap_1()
                .items_end()
                .children(image_strip(&row.images))
                .child(
                    div()
                        .max_w(px(460.))
                        .px_3()
                        .py_2()
                        .rounded(length(tokens.radius_medium))
                        .bg(color(tokens.surface_raised))
                        .text_color(color(tokens.text))
                        .child(TextView::markdown(text_id, row.text.clone()).selectable(true)),
                )
                .children(row_actions(&row, &handler))
                .into_any_element();
        }
        let fade = stream_fade(row.streaming, cx.reduce_motion());
        let visuals = super::visuals::visuals(&row);
        let actions = row_actions(&row, &handler);
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
            .children(visuals)
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
            .children(row.error.clone().map(|error| {
                div()
                    .text_sm()
                    .text_color(color(tokens.danger_on_surface))
                    .child(SharedString::from(error))
            }))
            .children(actions)
            .into_any_element()
    }
}

/// The transcript: a virtual list that follows the newest row.
#[derive(IntoElement)]
pub struct Transcript {
    list: Entity<MessageScrollerState>,
    rows: Rc<Vec<TranscriptRow>>,
    handler: ControlHandler,
}

impl Transcript {
    /// `rows`, rendered through `state`, which must have been synced to them.
    #[must_use]
    pub fn new(state: &TranscriptState, rows: Vec<TranscriptRow>, handler: ControlHandler) -> Self {
        Self {
            list: state.list.clone(),
            rows: Rc::new(rows),
            handler,
        }
    }
}

impl RenderOnce for Transcript {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let rows = self.rows;
        let handler = self.handler;
        MessageScroller::new("chat-transcript", self.list, move |index, _, _| {
            match rows.get(index) {
                Some(row) => Row {
                    row: row.clone(),
                    handler: handler.clone(),
                }
                .into_any_element(),
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
