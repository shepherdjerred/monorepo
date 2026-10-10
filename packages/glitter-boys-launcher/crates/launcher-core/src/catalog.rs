//! The bundled, reviewed catalog supplies data, never executable commands.

use crate::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Game {
    Iw4x,
    T5,
    T6,
    T7,
}

impl Game {
    pub const ALL: [Self; 4] = [Self::Iw4x, Self::T5, Self::T6, Self::T7];
    pub fn id(self) -> &'static str {
        match self {
            Self::Iw4x => "iw4x",
            Self::T5 => "t5",
            Self::T6 => "t6",
            Self::T7 => "t7",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Iw4x => "Modern Warfare 2",
            Self::T5 => "Black Ops",
            Self::T6 => "Black Ops II",
            Self::T7 => "Black Ops III",
        }
    }
    pub fn client(self) -> &'static str {
        match self {
            Self::Iw4x => "IW4x",
            Self::T5 | Self::T6 => "Plutonium",
            Self::T7 => "BOIII",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Multiplayer,
    Zombies,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub file: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

impl Artifact {
    pub fn validate(&self) -> Result<()> {
        crate::archive::safe_relative_path(&self.file)?;
        if self.file.is_empty()
            || !self
                .file
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
            || self.file == "."
            || self.file == ".."
            || self.bytes == 0
        {
            return Err(Error::Invalid(
                "Invalid catalog artifact name or length".into(),
            ));
        }
        let url = reqwest::Url::parse(&self.url)
            .map_err(|_| Error::Invalid("Invalid download URL".into()))?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.query().is_some()
        {
            return Err(Error::Invalid(
                "Catalog downloads must use HTTPS without credentials".into(),
            ));
        }
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(Error::Invalid(
                "Catalog artifact needs a SHA-256 digest".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GamePackage {
    pub game: Game,
    pub expanded_bytes: u64,
    pub archives: Vec<Artifact>,
    pub required_files: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub version: u32,
    pub games: Vec<GamePackage>,
    pub plutonium: Artifact,
    pub iw4x_launcher: Artifact,
    pub boiii: Artifact,
}

impl Catalog {
    pub fn bundled() -> Result<Self> {
        let catalog: Self = serde_json::from_str(include_str!("../../../catalog.json"))?;
        catalog.validate()?;
        Ok(catalog)
    }
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 || self.games.len() != Game::ALL.len() {
            return Err(Error::Invalid(
                "Unsupported or incomplete game catalog".into(),
            ));
        }
        for game in Game::ALL {
            if self.games.iter().filter(|p| p.game == game).count() != 1 {
                return Err(Error::Invalid(
                    "Missing or duplicated game in catalog".into(),
                ));
            }
        }
        for package in &self.games {
            if package.archives.is_empty()
                || package.expanded_bytes == 0
                || package.required_files.is_empty()
            {
                return Err(Error::Invalid("Incomplete game package".into()));
            }
            let mut names = std::collections::HashSet::new();
            for artifact in &package.archives {
                artifact.validate()?;
                if !names.insert(artifact.file.to_ascii_lowercase()) {
                    return Err(Error::Invalid("Duplicate archive filename".into()));
                }
            }
            for file in &package.required_files {
                crate::archive::safe_relative_path(file)?;
            }
        }
        for artifact in [&self.plutonium, &self.iw4x_launcher, &self.boiii] {
            artifact.validate()?;
        }
        Ok(())
    }
    pub fn package(&self, game: Game) -> Result<&GamePackage> {
        self.games
            .iter()
            .find(|p| p.game == game)
            .ok_or_else(|| Error::Invalid("Game missing from catalog".into()))
    }
}
