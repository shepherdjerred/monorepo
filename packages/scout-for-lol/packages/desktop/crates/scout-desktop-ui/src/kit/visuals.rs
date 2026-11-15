//! An answer's chart or table, match cards and loadout cards.
//!
//! A chart is the PNG Scout drew, shown in a fixed-height frame so the
//! transcript's measured row height holds while it loads. Tables, lists,
//! leaderboards and headline numbers are drawn here as rows. Card art is the
//! cached Data Dragon image, or a labelled placeholder. Every chart, card and
//! icon is an accessibility node with its own name, so a screen reader reads
//! a chart's values and a card's contents rather than "image".

use std::path::PathBuf;

use gpui_kit::component::{h_flex, v_flex};
use gpui_kit::{
    AnyElement, ElementId, FontWeight, InteractiveElement as _, IntoElement, ObjectFit,
    ParentElement as _, Role, SharedString, StatefulInteractiveElement as _, Styled as _,
    StyledImage as _, div, img, px,
};
use scout_desktop_ipc::{
    ChatIcon, ChatLoadoutCard, ChatMatchCard, ChatMatchTeam, ChatTable, ChatTableLayout, ChatVisual,
};

use super::theme::{color, length, theme};
use crate::chat_model::{CHART_LOADING, Picture, TranscriptRow};

/// The chart frame's height. Fixed, so loading and failure take the same
/// room as the image.
const CHART_HEIGHT: f32 = 220.;

fn id(row: &TranscriptRow, part: &str) -> ElementId {
    ElementId::Name(SharedString::from(format!("chat-{}-{part}", row.key)))
}

fn text(value: impl Into<SharedString>) -> gpui_kit::Div {
    div().child(value.into())
}

fn muted(value: impl Into<SharedString>) -> gpui_kit::Div {
    text(value).text_color(color(theme().text_muted))
}

fn frame() -> gpui_kit::Div {
    let tokens = theme();
    v_flex()
        .w_full()
        .gap_2()
        .p_3()
        .rounded(length(tokens.radius_medium))
        .border(length(tokens.border_width))
        .border_color(color(tokens.border))
        .bg(color(tokens.surface))
}

/// One piece of card art at `size` pixels square.
fn icon(row: &TranscriptRow, part: &str, art: &ChatIcon, size: f32) -> AnyElement {
    let tokens = theme();
    let slot = div()
        .id(id(row, part))
        .role(Role::Image)
        .aria_label(SharedString::from(art.label.clone()))
        .size(px(size))
        .flex_none()
        .rounded(length(tokens.radius_small))
        .overflow_hidden();
    match row.picture(art.image.as_deref()) {
        Picture::Ready(path) => slot
            .child(
                img(PathBuf::from(path))
                    .size_full()
                    .object_fit(ObjectFit::Cover),
            )
            .into_any_element(),
        Picture::Absent => slot
            .border(length(tokens.border_width))
            .border_dashed()
            .border_color(color(tokens.border))
            .into_any_element(),
        Picture::Loading | Picture::Failed(_) => slot
            .bg(color(tokens.surface_raised))
            .border(length(tokens.border_width))
            .border_color(color(tokens.border))
            .into_any_element(),
    }
}

fn chart(row: &TranscriptRow, image: &str, label: &str, description: &str) -> AnyElement {
    let tokens = theme();
    let frame = div()
        .id(id(row, "chart"))
        .role(Role::Image)
        .aria_label(SharedString::from(label.to_owned()))
        .aria_description(SharedString::from(description.to_owned()))
        .w_full()
        .h(px(CHART_HEIGHT))
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .rounded(length(tokens.radius_medium))
        .border(length(tokens.border_width))
        .border_color(color(tokens.border))
        .bg(color(tokens.surface))
        .text_sm();
    match row.picture(Some(image)) {
        Picture::Ready(path) => frame
            .child(
                img(PathBuf::from(path))
                    .size_full()
                    .object_fit(ObjectFit::Contain),
            )
            .into_any_element(),
        Picture::Failed(message) => frame
            .child(text(message.to_owned()).text_color(color(tokens.danger_on_surface)))
            .into_any_element(),
        Picture::Loading | Picture::Absent => frame.child(muted(CHART_LOADING)).into_any_element(),
    }
}

/// Text cells right-align when they read as numbers, as tables do.
fn numeric(cell: &str) -> bool {
    cell.chars()
        .next()
        .is_some_and(|first| first.is_ascii_digit() || first == '-')
}

fn table_rows(row: &TranscriptRow, table: &ChatTable) -> AnyElement {
    let tokens = theme();
    let cell = |value: &str, header: bool, first: bool| {
        let cell = div().flex_1().min_w_0().truncate().px_2().py_1();
        let cell = if first || !numeric(value) && !header {
            cell
        } else {
            cell.text_right()
        };
        let cell = if header {
            cell.text_color(color(tokens.text_muted))
                .font_weight(FontWeight::MEDIUM)
        } else {
            cell.text_color(color(tokens.text))
        };
        cell.child(SharedString::from(value.to_owned()))
    };
    let header = h_flex()
        .id(id(row, "table-header"))
        .role(Role::Row)
        .border_b(length(tokens.border_width))
        .border_color(color(tokens.border))
        .children(table.columns.iter().enumerate().map(|(index, column)| {
            div()
                .id(id(row, &format!("table-head-{index}")))
                .role(Role::ColumnHeader)
                .aria_label(SharedString::from(column.clone()))
                .flex_1()
                .min_w_0()
                .child(cell(column, true, index == 0))
        }));
    v_flex()
        .id(id(row, "table"))
        .role(Role::Table)
        .aria_label(SharedString::from(
            table.title.clone().unwrap_or_else(|| "Result".to_owned()),
        ))
        .w_full()
        .text_sm()
        .child(header)
        .children(table.rows.iter().enumerate().map(|(index, cells)| {
            let background = if index % 2 == 0 {
                tokens.surface
            } else {
                tokens.surface_raised
            };
            h_flex()
                .id(id(row, &format!("table-row-{index}")))
                .role(Role::Row)
                .aria_label(SharedString::from(cells.join(", ")))
                .bg(color(background))
                .children(
                    cells
                        .iter()
                        .enumerate()
                        .map(|(column, value)| cell(value, false, column == 0)),
                )
        }))
        .into_any_element()
}

fn list_rows(row: &TranscriptRow, table: &ChatTable) -> AnyElement {
    let tokens = theme();
    let ranked = table.layout == ChatTableLayout::Leaderboard;
    v_flex()
        .id(id(row, "list"))
        .role(Role::List)
        .aria_label(SharedString::from(
            table.title.clone().unwrap_or_else(|| "Result".to_owned()),
        ))
        .gap_1()
        .text_sm()
        .children(table.rows.iter().enumerate().map(|(index, cells)| {
            let (label, values) = cells
                .split_first()
                .map_or(("", &[][..]), |(first, rest)| (first.as_str(), rest));
            let marker = if ranked {
                format!("{}.", index + 1)
            } else {
                "•".to_owned()
            };
            let spoken = if ranked {
                format!("{marker} {}", cells.join(", "))
            } else {
                cells.join(", ")
            };
            h_flex()
                .id(id(row, &format!("list-{index}")))
                .role(Role::ListItem)
                .aria_label(SharedString::from(spoken))
                .gap_2()
                .child(muted(marker).w(px(22.)))
                .child(
                    text(label.to_owned())
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(color(tokens.text)),
                )
                .child(muted(values.join(" · ")))
        }))
        .into_any_element()
}

fn kpi_rows(row: &TranscriptRow, table: &ChatTable) -> AnyElement {
    let tokens = theme();
    h_flex()
        .id(id(row, "kpi"))
        .role(Role::Group)
        .aria_label(SharedString::from(
            table.title.clone().unwrap_or_else(|| "Result".to_owned()),
        ))
        .flex_wrap()
        .gap_4()
        .children(table.rows.iter().enumerate().map(|(index, cells)| {
            let (value, caption) = cells
                .split_last()
                .map_or(("", &[][..]), |(last, rest)| (last.as_str(), rest));
            v_flex()
                .id(id(row, &format!("kpi-{index}")))
                .role(Role::Group)
                .aria_label(SharedString::from(cells.join(", ")))
                .child(
                    text(value.to_owned())
                        .text_xl()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(color(tokens.text)),
                )
                .child(muted(caption.join(" · ")).text_xs())
        }))
        .into_any_element()
}

fn native(row: &TranscriptRow, table: &ChatTable) -> AnyElement {
    let body = match table.layout {
        ChatTableLayout::Table => table_rows(row, table),
        ChatTableLayout::List | ChatTableLayout::Leaderboard => list_rows(row, table),
        ChatTableLayout::Kpi => kpi_rows(row, table),
    };
    frame()
        .children(table.title.clone().map(|title| {
            text(title)
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(color(theme().text))
        }))
        .child(body)
        .children(
            (table.hidden_rows > 0).then(|| {
                muted(format!("and {} more rows on the web", table.hidden_rows)).text_xs()
            }),
        )
        .into_any_element()
}

fn team(row: &TranscriptRow, card: usize, index: usize, team: &ChatMatchTeam) -> AnyElement {
    let tokens = theme();
    let outcome = if team.won {
        tokens.success_on_surface
    } else {
        tokens.danger_on_surface
    };
    v_flex()
        .id(id(row, &format!("match-{card}-team-{index}")))
        .role(Role::Group)
        .aria_label(SharedString::from(format!(
            "{}, {}",
            team.name, team.result
        )))
        .flex_1()
        .min_w_0()
        .gap_1()
        .child(
            h_flex()
                .gap_2()
                .text_xs()
                .child(
                    text(team.name.clone())
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(color(tokens.text)),
                )
                .child(text(team.result.clone()).text_color(color(outcome))),
        )
        .children(team.players.iter().enumerate().map(|(slot, player)| {
            h_flex()
                .id(id(row, &format!("match-{card}-team-{index}-player-{slot}")))
                .role(Role::Row)
                .aria_label(SharedString::from(player.label.clone()))
                .gap_2()
                .text_xs()
                .child(icon(
                    row,
                    &format!("match-{card}-team-{index}-champion-{slot}"),
                    &player.champion,
                    20.,
                ))
                .child(
                    text(player.name.clone())
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(color(tokens.text)),
                )
                .child(muted(player.kda.clone()).flex_none())
        }))
        .into_any_element()
}

fn match_card(row: &TranscriptRow, index: usize, card: &ChatMatchCard) -> AnyElement {
    let tokens = theme();
    frame()
        .id(id(row, &format!("match-{index}")))
        .role(Role::Article)
        .aria_label(SharedString::from(card.label.clone()))
        .child(
            h_flex()
                .gap_2()
                .child(
                    text(card.queue.clone())
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(color(tokens.text)),
                )
                .child(muted(card.duration.clone()).text_xs().flex_1())
                .child(
                    text(card.score.clone())
                        .text_lg()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(color(tokens.text)),
                ),
        )
        .child(
            h_flex().items_start().gap_4().children(
                card.teams
                    .iter()
                    .enumerate()
                    .map(|(slot, value)| team(row, index, slot, value)),
            ),
        )
        .into_any_element()
}

fn icon_row(
    row: &TranscriptRow,
    part: &str,
    heading: &str,
    icons: &[ChatIcon],
    size: f32,
) -> AnyElement {
    h_flex()
        .id(id(row, part))
        .role(Role::List)
        .aria_label(SharedString::from(heading.to_owned()))
        .gap_2()
        .child(
            muted(heading.to_owned())
                .text_xs()
                .w(px(72.))
                .flex_none()
                .whitespace_nowrap(),
        )
        .children(
            icons
                .iter()
                .enumerate()
                .map(|(slot, art)| icon(row, &format!("{part}-{slot}"), art, size)),
        )
        .into_any_element()
}

fn loadout_card(row: &TranscriptRow, index: usize, card: &ChatLoadoutCard) -> AnyElement {
    let tokens = theme();
    let part = |name: &str| format!("loadout-{index}-{name}");
    frame()
        .id(id(row, &part("card")))
        .role(Role::Article)
        .aria_label(SharedString::from(card.label.clone()))
        .child(
            h_flex()
                .gap_3()
                .child(icon(row, &part("champion"), &card.champion, 36.))
                .child(
                    v_flex()
                        .child(
                            text(card.champion.label.clone())
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(color(tokens.text)),
                        )
                        .child(muted(card.duration.clone()).text_xs()),
                ),
        )
        .child(icon_row(row, &part("items"), "Items", &card.items, 30.))
        .child(icon_row(row, &part("spells"), "Spells", &card.spells, 26.))
        .child(icon_row(
            row,
            &part("primary"),
            "Runes",
            &card.primary_runes,
            26.,
        ))
        .child(icon_row(
            row,
            &part("secondary"),
            "Secondary",
            &card.secondary_runes,
            26.,
        ))
        .into_any_element()
}

/// Everything `row` shows besides its text: its chart or table, then its
/// match cards, then its loadout cards.
pub fn visuals(row: &TranscriptRow) -> Vec<AnyElement> {
    let visuals = &row.visuals;
    let visual = visuals.visual.as_ref().map(|visual| match visual {
        ChatVisual::Chart {
            image,
            label,
            description,
        } => chart(row, image, label, description),
        ChatVisual::Table(table) => native(row, table),
    });
    visual
        .into_iter()
        .chain(
            visuals
                .match_cards
                .iter()
                .enumerate()
                .map(|(index, card)| match_card(row, index, card)),
        )
        .chain(
            visuals
                .loadout_cards
                .iter()
                .enumerate()
                .map(|(index, card)| loadout_card(row, index, card)),
        )
        .collect()
}
