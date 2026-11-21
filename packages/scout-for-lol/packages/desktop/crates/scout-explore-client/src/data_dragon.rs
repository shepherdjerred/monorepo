//! Card art from Riot's Data Dragon, at the version Scout names.
//!
//! The server's `explore/assets` route names the Data Dragon version its own
//! asset bundle was built from; this build never pins one. Items and summoner
//! spells have art at a URL built from their id. Champions and runes need two
//! Data Dragon documents, fetched once per version through the same cache:
//! `champion.json` maps a champion's numeric id to the name its art is filed
//! under, and `runesReforged.json` maps a rune or tree id to its icon path.
//! Those documents belong to Riot, so they are read leniently, keeping only
//! the fields used here.

use std::collections::HashMap;

use serde::Deserialize;

/// The only host chat fetches card art from.
pub const DATA_DRAGON_HOST: &str = "ddragon.leagueoflegends.com";
const CDN: &str = "https://ddragon.leagueoflegends.com/cdn";

/// A Data Dragon version: dot-separated numbers such as `16.22.1`.
#[must_use]
pub fn is_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit())
        })
}

/// Whether `id` can stand in a URL path as is.
fn is_plain(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// `champion.json` at `version`.
#[must_use]
pub fn champion_list_url(version: &str) -> String {
    format!("{CDN}/{version}/data/en_US/champion.json")
}

/// `runesReforged.json` at `version`.
#[must_use]
pub fn rune_list_url(version: &str) -> String {
    format!("{CDN}/{version}/data/en_US/runesReforged.json")
}

/// `item.json` at `version`, which the proactive coach's detectors read
/// item facts from. Beta profile only.
#[cfg(scout_proactive_coach)]
#[must_use]
pub fn item_list_url(version: &str) -> String {
    format!("{CDN}/{version}/data/en_US/item.json")
}

#[derive(Deserialize)]
struct ChampionList {
    data: HashMap<String, ChampionEntry>,
}

#[derive(Deserialize)]
struct ChampionEntry {
    /// The name art is filed under, such as `MonkeyKing`.
    id: String,
    /// The numeric champion id, as a string.
    key: String,
}

#[derive(Deserialize)]
struct RuneTree {
    id: u32,
    icon: String,
    slots: Vec<RuneSlot>,
}

#[derive(Deserialize)]
struct RuneSlot {
    runes: Vec<RuneEntry>,
}

#[derive(Deserialize)]
struct RuneEntry {
    id: u32,
    icon: String,
}

/// A Data Dragon document did not have the shape this build reads.
#[derive(Debug, thiserror::Error)]
pub enum DataDragonError {
    /// Scout named something that is not a Data Dragon version.
    #[error("{0:?} is not a Data Dragon version")]
    Version(String),
    /// A document did not parse.
    #[error("Data Dragon {document} did not parse: {source}")]
    Document {
        /// Which document.
        document: &'static str,
        /// Why.
        source: serde_json::Error,
    },
}

/// What chat needs to turn card ids into Data Dragon image URLs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDragon {
    version: String,
    champions: HashMap<u32, String>,
    rune_icons: HashMap<u32, String>,
}

impl DataDragon {
    /// The catalog for `version` from its `champion.json` and
    /// `runesReforged.json`.
    ///
    /// # Errors
    ///
    /// The version is malformed or a document does not parse.
    pub fn from_documents(
        version: &str,
        champion_list: &[u8],
        rune_list: &[u8],
    ) -> Result<Self, DataDragonError> {
        if !is_version(version) {
            return Err(DataDragonError::Version(version.to_owned()));
        }
        let champions: ChampionList =
            serde_json::from_slice(champion_list).map_err(|source| DataDragonError::Document {
                document: "champion.json",
                source,
            })?;
        let trees: Vec<RuneTree> =
            serde_json::from_slice(rune_list).map_err(|source| DataDragonError::Document {
                document: "runesReforged.json",
                source,
            })?;
        let champions = champions
            .data
            .into_values()
            .filter(|entry| is_plain(&entry.id))
            .filter_map(|entry| Some((entry.key.parse().ok()?, entry.id)))
            .collect();
        let mut rune_icons = HashMap::new();
        for tree in trees {
            for rune in tree.slots.into_iter().flat_map(|slot| slot.runes) {
                rune_icons.insert(rune.id, rune.icon);
            }
            rune_icons.insert(tree.id, tree.icon);
        }
        Ok(Self {
            version: version.to_owned(),
            champions,
            rune_icons,
        })
    }

    /// The version this catalog builds URLs for.
    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    /// A champion's square portrait, or none for an id this version lacks.
    #[must_use]
    pub fn champion_icon(&self, champion_id: u32) -> Option<String> {
        self.champions
            .get(&champion_id)
            .map(|name| format!("{CDN}/{}/img/champion/{name}.png", self.version))
    }

    /// An item's icon.
    #[must_use]
    pub fn item_icon(&self, item_id: u32) -> String {
        format!("{CDN}/{}/img/item/{item_id}.png", self.version)
    }

    /// A summoner spell's icon by its Data Dragon id, such as
    /// `SummonerFlash`, or none for an id that is not one.
    #[must_use]
    pub fn spell_icon(&self, spell_id: &str) -> Option<String> {
        is_plain(spell_id).then(|| format!("{CDN}/{}/img/spell/{spell_id}.png", self.version))
    }

    /// A rune's or rune tree's icon, or none for an id this version lacks.
    /// Rune art is not versioned in Data Dragon.
    #[must_use]
    pub fn rune_icon(&self, rune_id: u32) -> Option<String> {
        self.rune_icons
            .get(&rune_id)
            .filter(|icon| {
                icon.split('/').all(|part| {
                    !part.is_empty()
                        && part != "."
                        && part != ".."
                        && part.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
                        })
                })
            })
            .map(|icon| format!("{CDN}/img/{icon}"))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{DataDragon, DataDragonError, champion_list_url, is_version, rune_list_url};

    /// A trimmed `champion.json`: Jinx, Wukong (filed as `MonkeyKing`) and a
    /// field this build does not read.
    pub const CHAMPIONS: &str = r#"{
        "type": "champion",
        "version": "16.22.1",
        "data": {
            "Jinx": { "id": "Jinx", "key": "222", "name": "Jinx", "title": "the Loose Cannon" },
            "MonkeyKing": { "id": "MonkeyKing", "key": "62", "name": "Wukong" }
        }
    }"#;

    /// A trimmed `runesReforged.json` with one tree.
    pub const RUNES: &str = r#"[
        {
            "id": 8000, "key": "Precision", "name": "Precision",
            "icon": "perk-images/Styles/7201_Precision.png",
            "slots": [
                { "runes": [
                    { "id": 8008, "key": "LethalTempo", "name": "Lethal Tempo",
                      "icon": "perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png" }
                ] }
            ]
        }
    ]"#;

    #[test]
    fn ids_become_data_dragon_urls_at_the_named_version() -> Result<(), DataDragonError> {
        let catalog =
            DataDragon::from_documents("16.22.1", CHAMPIONS.as_bytes(), RUNES.as_bytes())?;
        assert_eq!(
            catalog.champion_icon(62).as_deref(),
            Some("https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/MonkeyKing.png")
        );
        assert_eq!(catalog.champion_icon(9_999), None);
        assert_eq!(
            catalog.item_icon(3031),
            "https://ddragon.leagueoflegends.com/cdn/16.22.1/img/item/3031.png"
        );
        assert_eq!(
            catalog.spell_icon("SummonerFlash").as_deref(),
            Some("https://ddragon.leagueoflegends.com/cdn/16.22.1/img/spell/SummonerFlash.png")
        );
        assert_eq!(catalog.spell_icon("../secret"), None);
        assert_eq!(
            catalog.rune_icon(8008).as_deref(),
            Some(
                "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png"
            )
        );
        assert_eq!(
            catalog.rune_icon(8000).as_deref(),
            Some(
                "https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7201_Precision.png"
            )
        );
        assert_eq!(catalog.rune_icon(1), None);
        assert_eq!(
            champion_list_url("16.22.1"),
            "https://ddragon.leagueoflegends.com/cdn/16.22.1/data/en_US/champion.json"
        );
        assert_eq!(
            rune_list_url("16.22.1"),
            "https://ddragon.leagueoflegends.com/cdn/16.22.1/data/en_US/runesReforged.json"
        );
        Ok(())
    }

    #[test]
    fn a_malformed_version_or_document_is_refused() {
        assert!(is_version("16.22.1"));
        for version in ["16.22", "latest", "16.22.1/../x", "1..2", ""] {
            assert!(!is_version(version), "{version}");
        }
        assert!(matches!(
            DataDragon::from_documents("latest", CHAMPIONS.as_bytes(), RUNES.as_bytes()),
            Err(DataDragonError::Version(_))
        ));
        assert!(matches!(
            DataDragon::from_documents("16.22.1", b"[]", RUNES.as_bytes()),
            Err(DataDragonError::Document {
                document: "champion.json",
                ..
            })
        ));
    }
}
