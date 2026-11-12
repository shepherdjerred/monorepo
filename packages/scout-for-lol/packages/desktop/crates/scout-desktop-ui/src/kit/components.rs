//! Scout-named components over gpui-kit's element and component layers.

use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::component::{ActiveTheme as _, h_flex, v_flex};
use gpui_kit::{
    AnyElement, App, ElementId, FontWeight, InteractiveElement as _, IntoElement, ParentElement,
    RenderOnce, SharedString, StatefulInteractiveElement as _, Styled, Window, div, px,
};

use super::theme::{color, length, theme};
use crate::view_model::Tone;

/// A click handler that needs no view state: it sends an IPC command.
pub type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// How a [`ScoutButton`] reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonStyle {
    /// The page's main action.
    Primary,
    /// Any other action.
    Secondary,
    /// An action that removes something.
    Destructive,
}

/// A Scout button.
#[derive(IntoElement)]
pub struct ScoutButton {
    id: ElementId,
    label: SharedString,
    style: ButtonStyle,
    on_click: Handler,
}

impl ScoutButton {
    /// A button labelled `label` that runs `on_click`.
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        style: ButtonStyle,
        on_click: Handler,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            style,
            on_click,
        }
    }
}

impl RenderOnce for ScoutButton {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let on_click = self.on_click;
        let button = Button::new(self.id)
            .label(self.label)
            .on_click(move |_, window, cx| on_click(window, cx));
        match self.style {
            ButtonStyle::Primary => button.primary(),
            ButtonStyle::Secondary => button.secondary(),
            ButtonStyle::Destructive => button.danger(),
        }
    }
}

/// A labelled checkbox whose click sends a command; the checked state comes
/// back from the supervisor's next snapshot.
#[derive(IntoElement)]
pub struct ScoutToggle {
    id: ElementId,
    label: SharedString,
    checked: bool,
    on_click: Handler,
}

impl ScoutToggle {
    /// A checkbox labelled `label`.
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        checked: bool,
        on_click: Handler,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            checked,
            on_click,
        }
    }
}

impl RenderOnce for ScoutToggle {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let on_click = self.on_click;
        Checkbox::new(self.id)
            .label(self.label)
            .checked(self.checked)
            .on_click(move |_, window, cx| on_click(window, cx))
    }
}

/// A label and its status value.
#[derive(IntoElement)]
pub struct StatusRow {
    label: SharedString,
    value: SharedString,
    tone: Tone,
}

impl StatusRow {
    /// `label: value`, colored by `tone`.
    pub fn new(label: impl Into<SharedString>, value: impl Into<SharedString>, tone: Tone) -> Self {
        Self {
            label: label.into(),
            value: value.into(),
            tone,
        }
    }
}

impl RenderOnce for StatusRow {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let value_color = match self.tone {
            Tone::Normal => tokens.text,
            Tone::Good => tokens.success_on_surface,
            Tone::Waiting => tokens.text_muted,
        };
        h_flex()
            .gap_3()
            .py_1()
            .child(
                div()
                    .w(px(140.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(color(tokens.text))
                    .child(self.label),
            )
            .child(div().text_color(color(value_color)).child(self.value))
    }
}

/// A page: a heading over its content.
#[derive(IntoElement)]
pub struct Page {
    title: SharedString,
    children: Vec<AnyElement>,
}

impl Page {
    /// A page titled `title`.
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            children: Vec::new(),
        }
    }
}

impl ParentElement for Page {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Page {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        v_flex()
            .id("page")
            .size_full()
            .p_6()
            .gap_3()
            .overflow_y_scrollbar()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(color(tokens.text))
                    .pb_2()
                    .child(self.title),
            )
            .children(self.children)
    }
}

/// A row of actions.
#[must_use]
pub fn action_row() -> gpui_kit::Div {
    h_flex().gap_2().flex_wrap()
}

/// A section heading inside a page.
#[must_use]
pub fn section_heading(text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .pt_3()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(color(theme().text))
        .child(text.into())
}

/// Ordinary body text.
#[must_use]
pub fn body_text(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_color(color(theme().text)).child(text.into())
}

/// Secondary, explanatory text.
#[must_use]
pub fn note_text(text: impl Into<SharedString>) -> impl IntoElement {
    div()
        .text_sm()
        .text_color(color(theme().text_muted))
        .child(text.into())
}

/// An error shown on a surface.
#[must_use]
pub fn error_notice(text: impl Into<SharedString>) -> impl IntoElement {
    let tokens = theme();
    div()
        .mt_3()
        .p_3()
        .rounded(length(tokens.radius_medium))
        .border(length(tokens.border_width))
        .border_color(color(tokens.danger))
        .text_color(color(tokens.danger_on_surface))
        .child(text.into())
}

/// One line of monospace text.
#[derive(IntoElement)]
pub struct MonoLine {
    text: SharedString,
}

impl MonoLine {
    /// `text` in the monospace font.
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self { text: text.into() }
    }
}

impl RenderOnce for MonoLine {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .font_family(cx.theme().mono_font_family.clone())
            .text_sm()
            .text_color(color(theme().text))
            .child(self.text)
    }
}

/// A striped two-column table of monospace values.
#[derive(IntoElement)]
pub struct KeyValueTable {
    rows: Vec<(SharedString, SharedString)>,
}

impl KeyValueTable {
    /// One row per `(key, value)`.
    pub fn new(rows: impl IntoIterator<Item = (String, String)>) -> Self {
        Self {
            rows: rows
                .into_iter()
                .map(|(key, value)| (key.into(), value.into()))
                .collect(),
        }
    }
}

impl RenderOnce for KeyValueTable {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let mono = cx.theme().mono_font_family.clone();
        v_flex()
            .rounded(length(tokens.radius_small))
            .border(length(tokens.border_width))
            .border_color(color(tokens.border))
            .children(
                self.rows
                    .into_iter()
                    .enumerate()
                    .map(|(index, (key, value))| {
                        let background = if index % 2 == 0 {
                            tokens.surface
                        } else {
                            tokens.surface_raised
                        };
                        h_flex()
                            .px_3()
                            .py_1()
                            .gap_4()
                            .bg(color(background))
                            .font_family(mono.clone())
                            .text_sm()
                            .text_color(color(tokens.text))
                            .child(div().flex_1().child(key))
                            .child(value)
                    }),
            )
    }
}

/// A bounded, scrolling list of monospace lines.
#[derive(IntoElement)]
pub struct ScrollLog {
    id: ElementId,
    lines: Vec<SharedString>,
}

impl ScrollLog {
    /// `lines`, scrolling past 220 px like the egui window.
    pub fn new(id: impl Into<ElementId>, lines: impl IntoIterator<Item = String>) -> Self {
        Self {
            id: id.into(),
            lines: lines.into_iter().map(SharedString::from).collect(),
        }
    }
}

impl RenderOnce for ScrollLog {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let mono = cx.theme().mono_font_family.clone();
        div()
            .id(self.id)
            .max_h(px(220.))
            .overflow_y_scroll()
            .p_2()
            .rounded(length(tokens.radius_small))
            .border(length(tokens.border_width))
            .border_color(color(tokens.border))
            .bg(color(tokens.surface))
            .font_family(mono)
            .text_sm()
            .text_color(color(tokens.text))
            .children(self.lines.into_iter().map(|line| div().child(line)))
    }
}

/// One navigation entry.
#[derive(IntoElement)]
pub struct NavItem {
    id: ElementId,
    label: SharedString,
    selected: bool,
    on_click: Handler,
}

impl NavItem {
    /// A navigation entry; `selected` marks the current page.
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        selected: bool,
        on_click: Handler,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            selected,
            on_click,
        }
    }
}

impl RenderOnce for NavItem {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        let on_click = self.on_click;
        let item = div()
            .id(self.id)
            .px_3()
            .py_1p5()
            .rounded(length(tokens.radius_small))
            .border_l_2()
            .cursor_pointer()
            .text_color(color(tokens.text))
            .hover(|style| style.bg(color(tokens.interactive_hover)))
            .on_click(move |_, window, cx| on_click(window, cx))
            .child(self.label);
        if self.selected {
            item.bg(color(tokens.interactive_active))
                .border_color(color(tokens.accent))
        } else {
            item.border_color(color(0))
        }
    }
}

/// The window frame: navigation on the left, the page on the right.
#[derive(IntoElement)]
pub struct Shell {
    brand: SharedString,
    navigation: Vec<NavItem>,
    page: AnyElement,
}

impl Shell {
    /// A frame titled `brand` around `page`.
    pub fn new(brand: impl Into<SharedString>, navigation: Vec<NavItem>, page: AnyElement) -> Self {
        Self {
            brand: brand.into(),
            navigation,
            page,
        }
    }
}

impl RenderOnce for Shell {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let tokens = theme();
        h_flex()
            .size_full()
            .items_start()
            .bg(color(tokens.canvas))
            .text_color(color(tokens.text))
            .child(
                v_flex()
                    .w(px(170.))
                    .h_full()
                    .p_3()
                    .gap_1()
                    .bg(color(tokens.surface))
                    .border_r(length(tokens.border_width))
                    .border_color(color(tokens.border))
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::BOLD)
                            .text_color(color(tokens.primary))
                            .pb_3()
                            .child(self.brand),
                    )
                    .children(self.navigation),
            )
            .child(div().flex_1().h_full().child(self.page))
    }
}
