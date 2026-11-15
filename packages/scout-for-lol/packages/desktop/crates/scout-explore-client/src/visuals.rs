//! What an answer shows besides its text, as the window renders it.
//!
//! A chart whose kind every surface draws natively (a table, list,
//! leaderboard or headline number) becomes rows here; any other chart is the
//! PNG Scout renders, named by [`chart_key`]. Card art is a Data Dragon URL
//! when the catalog is loaded and the id is one it knows, and a labelled
//! placeholder otherwise. Values are formatted here, so the window draws
//! strings.

use scout_desktop_ipc::{
    ChatIcon, ChatLoadoutCard, ChatMatchCard, ChatMatchPlayer, ChatMatchTeam, ChatTable,
    ChatTableLayout, ChatVisual, ChatVisuals,
};
use uuid::Uuid;

use crate::contract::NATIVE_VISUALIZATION_KINDS;
use crate::data_dragon::DataDragon;
use crate::model::{
    CellValue, ExploreMessage, LoadoutCard, MatchCard, MatchParticipant, MatchTeam, NamedRune,
    PreviewSummary, RiotId, ValueFormat, Visualization,
};

/// Rows a chart's accessible description reads out before it stops.
const DESCRIBED_ROWS: usize = 12;

/// What the supervisor fetches for one picture key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageSource {
    /// `explore/visualization` for one persisted answer.
    Chart {
        /// The conversation.
        conversation_id: Uuid,
        /// The answer.
        message_id: Uuid,
    },
    /// A Data Dragon image; the key is its URL.
    Art {
        /// The URL.
        url: String,
    },
}

/// The picture key of one answer's chart.
#[must_use]
pub fn chart_key(conversation_id: Uuid, message_id: Uuid) -> String {
    format!("chart:{conversation_id}:{message_id}")
}

/// Every picture `visuals` names, and how to fetch each.
#[must_use]
pub fn image_sources(
    conversation_id: Uuid,
    message_id: Uuid,
    visuals: &ChatVisuals,
) -> Vec<(String, ImageSource)> {
    let chart = chart_key(conversation_id, message_id);
    visuals
        .image_keys()
        .into_iter()
        .map(|key| {
            let source = if key == chart {
                ImageSource::Chart {
                    conversation_id,
                    message_id,
                }
            } else {
                ImageSource::Art {
                    url: key.to_owned(),
                }
            };
            (key.to_owned(), source)
        })
        .collect()
}

/// One persisted message's visuals.
#[must_use]
pub fn chat_visuals(
    message: &ExploreMessage,
    conversation_id: Uuid,
    art: Option<&DataDragon>,
) -> ChatVisuals {
    ChatVisuals {
        visual: visual(message, conversation_id),
        match_cards: message
            .match_cards
            .iter()
            .map(|card| match_card(card, art))
            .collect(),
        loadout_cards: message
            .loadout_cards
            .iter()
            .map(|card| loadout_card(card, art))
            .collect(),
    }
}

fn native_layout(chart: &Visualization) -> Option<ChatTableLayout> {
    if chart.sparkline() || !NATIVE_VISUALIZATION_KINDS.contains(&chart.kind()) {
        return None;
    }
    Some(match chart.kind() {
        "LIST" => ChatTableLayout::List,
        "LEADERBOARD" => ChatTableLayout::Leaderboard,
        "KPI_CARD" => ChatTableLayout::Kpi,
        _ => ChatTableLayout::Table,
    })
}

fn visual(message: &ExploreMessage, conversation_id: Uuid) -> Option<ChatVisual> {
    let preview = message.preview.as_ref();
    let Some(chart) = &message.visualization else {
        return preview
            .map(|preview| ChatVisual::Table(table(preview, None, ChatTableLayout::Table)));
    };
    match (native_layout(chart), preview) {
        (Some(layout), Some(preview)) => {
            Some(ChatVisual::Table(table(preview, chart.title(), layout)))
        }
        // A native kind without its rows is still a chart Scout can draw.
        _ => Some(ChatVisual::Chart {
            image: chart_key(conversation_id, message.id),
            label: chart_label(chart),
            description: preview.map(describe).unwrap_or_default(),
        }),
    }
}

/// `BAR_CHART` as `Bar chart`.
fn kind_name(kind: &str) -> String {
    let words = kind.to_lowercase().replace('_', " ");
    let mut characters = words.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    })
}

fn chart_label(chart: &Visualization) -> String {
    let kind = kind_name(chart.kind());
    let kind = if kind.ends_with("chart") || kind.ends_with("plot") || kind.ends_with("map") {
        kind
    } else {
        format!("{kind} chart")
    };
    match chart.title() {
        Some(title) => format!("{kind}: {title}"),
        None => kind,
    }
}

/// The chart's values in words: each row's cells, joined.
fn describe(preview: &PreviewSummary) -> String {
    let rows = rows(preview);
    let mut lines: Vec<String> = rows
        .iter()
        .take(DESCRIBED_ROWS)
        .map(|cells| cells.join(", "))
        .collect();
    if rows.len() > DESCRIBED_ROWS {
        lines.push(format!("and {} more rows", rows.len() - DESCRIBED_ROWS));
    }
    lines.join("; ")
}

fn format_number(number: &serde_json::Number, format: ValueFormat) -> String {
    let Some(value) = number.as_f64() else {
        return number.to_string();
    };
    match format {
        ValueFormat::Text => number.to_string(),
        ValueFormat::Integer => format!("{value:.0}"),
        ValueFormat::Decimal => {
            let fixed = format!("{value:.2}");
            fixed.trim_end_matches('0').trim_end_matches('.').to_owned()
        }
        ValueFormat::Percent => format!("{:.1}%", value * 100.0),
    }
}

fn cell(value: &CellValue, format: ValueFormat) -> String {
    match value {
        CellValue::Text(text) => text.clone(),
        CellValue::Number(number) => format_number(number, format),
        CellValue::Null => "—".to_owned(),
    }
}

fn rows(preview: &PreviewSummary) -> Vec<Vec<String>> {
    preview
        .rows
        .iter()
        .map(|row| {
            preview
                .columns
                .iter()
                .map(|column| {
                    row.values
                        .iter()
                        .find(|value| value.column == column.key)
                        .map_or_else(|| "—".to_owned(), |value| cell(&value.value, column.format))
                })
                .collect()
        })
        .collect()
}

fn table(preview: &PreviewSummary, title: Option<&str>, layout: ChatTableLayout) -> ChatTable {
    let rows = rows(preview);
    let shown = u64::try_from(rows.len()).unwrap_or(u64::MAX);
    ChatTable {
        title: title.map(str::to_owned),
        layout,
        columns: preview
            .columns
            .iter()
            .map(|column| column.label.clone())
            .collect(),
        rows,
        hidden_rows: preview.rows_returned.saturating_sub(shown),
    }
}

/// A game length such as `28m 14s`, as the web shows it.
fn duration(seconds: u64) -> String {
    format!("{}m {}s", seconds / 60, seconds % 60)
}

fn riot_id(id: &RiotId) -> String {
    match (&id.game_name, &id.tag_line) {
        (Some(name), Some(tag)) => format!("{name}#{tag}"),
        (Some(name), None) => name.clone(),
        _ => "Unknown Riot ID".to_owned(),
    }
}

fn team_name(team_id: u32) -> String {
    match team_id {
        100 => "Blue team".to_owned(),
        200 => "Red team".to_owned(),
        other => format!("Team {other}"),
    }
}

fn player(participant: &MatchParticipant, art: Option<&DataDragon>) -> ChatMatchPlayer {
    let name = riot_id(&participant.riot_id);
    let kda = format!(
        "{} / {} / {}",
        participant.kills, participant.deaths, participant.assists
    );
    ChatMatchPlayer {
        champion: ChatIcon {
            image: art.and_then(|art| art.champion_icon(participant.champion_id)),
            label: participant.champion_name.clone(),
        },
        label: format!(
            "{}, {name}, {} kills, {} deaths, {} assists",
            participant.champion_name, participant.kills, participant.deaths, participant.assists
        ),
        name,
        kda,
    }
}

fn team(team: &MatchTeam, art: Option<&DataDragon>) -> ChatMatchTeam {
    let outcome = if team.win { "Victory" } else { "Defeat" };
    ChatMatchTeam {
        name: team_name(team.team_id),
        won: team.win,
        result: format!("{outcome} · {} kills", team.kills),
        players: team
            .participants
            .iter()
            .map(|participant| player(participant, art))
            .collect(),
    }
}

fn match_card(card: &MatchCard, art: Option<&DataDragon>) -> ChatMatchCard {
    let snapshot = &card.snapshot;
    let queue = snapshot
        .queue
        .clone()
        .unwrap_or_else(|| format!("Queue {}", snapshot.queue_id));
    let teams: Vec<ChatMatchTeam> = snapshot
        .teams
        .iter()
        .map(|value| team(value, art))
        .collect();
    let score = snapshot
        .teams
        .iter()
        .map(|team| team.kills.to_string())
        .collect::<Vec<_>>()
        .join(" – ");
    let winner = teams.iter().find(|team| team.won).map_or_else(
        || "No team won".to_owned(),
        |team| format!("{} won", team.name),
    );
    let length = duration(snapshot.game_duration_seconds);
    ChatMatchCard {
        label: format!("Match: {queue}, {length}. {winner}, {score}."),
        queue,
        duration: length,
        score,
        teams,
    }
}

fn item_icon(
    slot: u8,
    item_id: Option<u32>,
    name: Option<&str>,
    art: Option<&DataDragon>,
) -> ChatIcon {
    let slot_name = if slot == 6 {
        "Trinket".to_owned()
    } else {
        format!("Item slot {}", slot + 1)
    };
    match (item_id, name) {
        (None, _) => ChatIcon {
            image: None,
            label: format!("{slot_name}: empty"),
        },
        // An item the game data does not know has no art to fetch.
        (Some(id), None) => ChatIcon {
            image: None,
            label: format!("{slot_name}: unknown item {id}"),
        },
        (Some(id), Some(name)) => ChatIcon {
            image: art.map(|art| art.item_icon(id)),
            label: format!("{slot_name}: {name}"),
        },
    }
}

fn rune_icon(rune: &NamedRune, art: Option<&DataDragon>) -> ChatIcon {
    let known = rune.known != Some(false);
    ChatIcon {
        image: art.filter(|_| known).and_then(|art| art.rune_icon(rune.id)),
        label: if known {
            rune.name.clone()
        } else {
            format!("Unknown rune {}", rune.id)
        },
    }
}

fn loadout_card(card: &LoadoutCard, art: Option<&DataDragon>) -> ChatLoadoutCard {
    let page = &card.rune_page;
    let primary_runes = page
        .primary_tree
        .iter()
        .chain(&page.keystone)
        .chain(&page.primary_runes)
        .map(|rune| rune_icon(rune, art))
        .collect();
    let secondary_runes = page
        .secondary_tree
        .iter()
        .chain(&page.secondary_runes)
        .map(|rune| rune_icon(rune, art))
        .collect();
    let spells = card
        .spells
        .iter()
        .map(|spell| match (&spell.spell_id, &spell.name) {
            (Some(id), Some(name)) => ChatIcon {
                image: art.and_then(|art| art.spell_icon(id)),
                label: format!("Summoner spell: {name}"),
            },
            _ => ChatIcon {
                image: None,
                label: format!("Summoner spell {}: none", spell.slot),
            },
        })
        .collect();
    let length = duration(card.game_duration_seconds);
    let keystone = page
        .keystone
        .as_ref()
        .map_or_else(String::new, |rune| format!(", {}", rune.name));
    ChatLoadoutCard {
        champion: ChatIcon {
            image: art.and_then(|art| art.champion_icon(card.champion_id)),
            label: card.champion_name.clone(),
        },
        label: format!(
            "Loadout: {} in a {length} game{keystone}",
            card.champion_name
        ),
        duration: length,
        items: card
            .final_items
            .iter()
            .map(|item| item_icon(item.slot, item.item_id, item.name.as_deref(), art))
            .collect(),
        spells,
        primary_runes,
        secondary_runes,
    }
}

#[cfg(test)]
mod tests {
    use scout_desktop_ipc::{ChatTableLayout, ChatVisual};
    use uuid::Uuid;

    use super::{ImageSource, chart_key, chat_visuals, image_sources};
    use crate::data_dragon::DataDragon;
    use crate::data_dragon::tests::{CHAMPIONS, RUNES};
    use crate::model::Transcript;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const VISUALS: &str = include_str!(
        "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get-visuals.json"
    );

    fn transcript() -> Result<Transcript, Box<dyn std::error::Error>> {
        let fixture: serde_json::Value = serde_json::from_str(VISUALS)?;
        Ok(serde_json::from_value(fixture["response"].clone())?)
    }

    #[test]
    fn a_chart_kind_is_the_server_png_and_a_table_kind_is_native_rows() -> TestResult {
        let transcript = transcript()?;
        let conversation = transcript.conversation.id;
        let chart = chat_visuals(&transcript.messages[1], conversation, None);
        let Some(ChatVisual::Chart {
            image,
            label,
            description,
        }) = &chart.visual
        else {
            return Err(format!("expected a chart, got {:?}", chart.visual).into());
        };
        assert_eq!(*image, chart_key(conversation, transcript.messages[1].id));
        assert_eq!(label, "Bar chart: Win rate by bot lane pair");
        assert!(description.starts_with("Jinx + Lulu, 61.0%; Jinx + Nami, 55.0%"));
        assert_eq!(
            image_sources(conversation, transcript.messages[1].id, &chart),
            [(
                image.clone(),
                ImageSource::Chart {
                    conversation_id: conversation,
                    message_id: transcript.messages[1].id,
                }
            )]
        );

        let native = chat_visuals(&transcript.messages[3], conversation, None);
        let Some(ChatVisual::Table(table)) = native.visual else {
            return Err("expected a native table".into());
        };
        assert_eq!(table.layout, ChatTableLayout::Table);
        assert_eq!(table.title.as_deref(), Some("Most played champions"));
        assert_eq!(table.columns, ["Champion", "Games", "Win rate"]);
        assert_eq!(table.rows[0], ["Jinx", "41", "58.0%"]);
        assert_eq!(table.hidden_rows, 0);
        Ok(())
    }

    #[test]
    fn cards_carry_labels_and_art_once_the_catalog_loads() -> TestResult {
        let transcript = transcript()?;
        let conversation = transcript.conversation.id;
        let bare = chat_visuals(&transcript.messages[5], conversation, None);
        let card = &bare.match_cards[0];
        assert_eq!(card.queue, "Ranked Solo/Duo");
        assert_eq!(card.duration, "28m 14s");
        assert_eq!(card.score, "38 – 24");
        assert_eq!(
            card.label,
            "Match: Ranked Solo/Duo, 28m 14s. Blue team won, 38 – 24."
        );
        assert_eq!(card.teams[0].result, "Victory · 38 kills");
        let jinx = &card.teams[0].players[0];
        assert_eq!(
            (jinx.name.as_str(), jinx.kda.as_str()),
            ("Scout#NA1", "14 / 3 / 18")
        );
        assert_eq!(jinx.champion.image, None, "no art before the catalog loads");
        assert_eq!(card.teams[0].players[4].name, "Kestrel");

        let art = DataDragon::from_documents("16.22.1", CHAMPIONS.as_bytes(), RUNES.as_bytes())?;
        let drawn = chat_visuals(&transcript.messages[5], conversation, Some(&art));
        assert_eq!(
            drawn.match_cards[0].teams[0].players[0]
                .champion
                .image
                .as_deref(),
            Some("https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/Jinx.png")
        );

        let loadout = chat_visuals(&transcript.messages[7], conversation, Some(&art));
        let card = &loadout.loadout_cards[0];
        assert_eq!(card.label, "Loadout: Jinx in a 28m 14s game, Arcane Comet");
        assert_eq!(card.items.len(), 7);
        assert_eq!(card.items[0].label, "Item slot 1: Kraken Slayer");
        assert_eq!(
            card.items[0].image.as_deref(),
            Some("https://ddragon.leagueoflegends.com/cdn/16.22.1/img/item/6672.png")
        );
        assert_eq!(card.items[5].label, "Item slot 6: empty");
        assert_eq!(card.items[5].image, None);
        assert_eq!(card.items[6].label, "Trinket: Farsight Alteration");
        assert_eq!(card.spells[0].label, "Summoner spell: Flash");
        assert_eq!(
            card.primary_runes
                .iter()
                .map(|rune| rune.label.as_str())
                .collect::<Vec<_>>(),
            [
                "Sorcery",
                "Arcane Comet",
                "Manaflow Band",
                "Transcendence",
                "Scorch"
            ]
        );
        // The trimmed catalog here names no Sorcery rune, so they keep their
        // labelled placeholders rather than a guessed URL.
        assert!(card.primary_runes.iter().all(|rune| rune.image.is_none()));
        assert_eq!(card.secondary_runes[0].label, "Inspiration");
        assert!(
            image_sources(conversation, Uuid::nil(), &loadout)
                .iter()
                .all(|(_, source)| matches!(source, ImageSource::Art { .. }))
        );
        Ok(())
    }
}
