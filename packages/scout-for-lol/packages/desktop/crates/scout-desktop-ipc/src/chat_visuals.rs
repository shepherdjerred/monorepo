//! What an answer shows besides its text: a chart or a table, match cards and
//! loadout cards, and the pictures they name.
//!
//! The supervisor resolves every picture: a chart is the PNG Scout renders
//! for the answer, card art is a Data Dragon image, and both land in the
//! supervisor's disk cache. The window gets a key per picture and, in the
//! separate `chat_images` part, where that key stands, so an image arriving
//! re-sends one small map rather than the transcript. Every label here is the
//! accessible name the window gives the element.

use serde::{Deserialize, Serialize};

/// Where one picture stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatImage {
    /// The supervisor is fetching it.
    Loading,
    /// It is on disk.
    Ready {
        /// The cached file, readable by the window process.
        path: String,
    },
    /// It could not be fetched; safe to show.
    Failed {
        /// Why.
        message: String,
    },
}

/// One piece of card art: the picture to show, if there is one to fetch, and
/// what it depicts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatIcon {
    /// The picture's key in the images part; none for an empty slot, an id
    /// the game data does not know, or art not resolved yet.
    pub image: Option<String>,
    /// What it depicts, such as `Kraken Slayer` or `Item slot 6: empty`.
    pub label: String,
}

/// How a native result reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatTableLayout {
    /// Columns and rows.
    Table,
    /// One line per row.
    List,
    /// Numbered lines, best first.
    Leaderboard,
    /// One headline number per row.
    Kpi,
}

/// A query result drawn natively.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatTable {
    /// The chart's title, if it has one.
    pub title: Option<String>,
    /// How it reads.
    pub layout: ChatTableLayout,
    /// Column headers.
    pub columns: Vec<String>,
    /// Formatted cells, one per column.
    pub rows: Vec<Vec<String>>,
    /// Rows the query returned beyond those shown.
    pub hidden_rows: u64,
}

/// An answer's chart or table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatVisual {
    /// The PNG Scout renders for the answer.
    Chart {
        /// The picture's key in the images part.
        image: String,
        /// Its accessible name, such as `Bar chart: Win rate by pair`.
        label: String,
        /// Its values in words, for a screen reader.
        description: String,
    },
    /// A table, list, leaderboard or headline drawn natively.
    Table(ChatTable),
}

/// One player on a match card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatMatchPlayer {
    /// Their champion.
    pub champion: ChatIcon,
    /// Their Riot ID.
    pub name: String,
    /// `kills / deaths / assists`.
    pub kda: String,
    /// The row's accessible name.
    pub label: String,
}

/// One team on a match card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatMatchTeam {
    /// `Blue team`, `Red team`, or `Team <id>`.
    pub name: String,
    /// Whether it won.
    pub won: bool,
    /// `Victory` or `Defeat`, with the team's kills.
    pub result: String,
    /// Its players.
    pub players: Vec<ChatMatchPlayer>,
}

/// A match an answer points at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatMatchCard {
    /// The queue's name.
    pub queue: String,
    /// The game's length, such as `28m 14s`.
    pub duration: String,
    /// The kills of each team, such as `38 – 24`.
    pub score: String,
    /// The teams.
    pub teams: Vec<ChatMatchTeam>,
    /// The card's accessible name.
    pub label: String,
}

/// One player's build in a match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatLoadoutCard {
    /// The champion played.
    pub champion: ChatIcon,
    /// The game's length.
    pub duration: String,
    /// The seven final item slots, the trinket last.
    pub items: Vec<ChatIcon>,
    /// The two summoner spells.
    pub spells: Vec<ChatIcon>,
    /// The primary tree, its keystone, then its other runes.
    pub primary_runes: Vec<ChatIcon>,
    /// The secondary tree, then its runes.
    pub secondary_runes: Vec<ChatIcon>,
    /// The card's accessible name.
    pub label: String,
}

/// Everything an answer shows besides its text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatVisuals {
    /// Its chart or table.
    pub visual: Option<ChatVisual>,
    /// Match cards.
    pub match_cards: Vec<ChatMatchCard>,
    /// Loadout cards.
    pub loadout_cards: Vec<ChatLoadoutCard>,
}

impl ChatVisuals {
    /// Every picture these visuals name, chart first.
    #[must_use]
    pub fn image_keys(&self) -> Vec<&str> {
        let chart = match &self.visual {
            Some(ChatVisual::Chart { image, .. }) => Some(image.as_str()),
            _ => None,
        };
        let matches = self
            .match_cards
            .iter()
            .flat_map(|card| &card.teams)
            .flat_map(|team| &team.players)
            .map(|player| &player.champion);
        let loadouts = self.loadout_cards.iter().flat_map(|card| {
            std::iter::once(&card.champion)
                .chain(&card.items)
                .chain(&card.spells)
                .chain(&card.primary_runes)
                .chain(&card.secondary_runes)
        });
        chart
            .into_iter()
            .chain(
                matches
                    .chain(loadouts)
                    .filter_map(|icon| icon.image.as_deref()),
            )
            .collect()
    }
}
