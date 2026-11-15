//! Reference-compatible selective synchronization. Config files remain inert;
//! allowing `main.js` to replicate never permits executing it in Facet.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{Result, SyncError};

/// Attachment categories in the official client's `allowTypes` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentCategory {
    /// Raster/vector images.
    Image,
    /// Supported audio extensions.
    Audio,
    /// Supported video extensions.
    Video,
    /// PDF documents.
    Pdf,
    /// Other file extensions, including extensionless files.
    Unsupported,
}

/// Configuration categories in the official client's `allowSpecialFiles`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigurationCategory {
    /// app.json and types.json.
    App,
    /// appearance.json.
    Appearance,
    /// Themes and CSS snippets.
    AppearanceData,
    /// hotkeys.json.
    #[serde(rename = "hotkey")]
    Hotkey,
    /// Enabled core plugins and their migration state.
    CorePlugin,
    /// Top-level configuration JSON for core plugins.
    CorePluginData,
    /// Enabled community plugins.
    CommunityPlugin,
    /// Individual plugin manifest, JavaScript, CSS, and data JSON.
    CommunityPluginData,
}

/// Immutable per-profile filter. Default enables every supported category;
/// workspace files and hidden plugin dependencies remain excluded upstream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncFilter {
    /// Logical configuration directory, normally `.obsidian`.
    pub configuration_directory: String,
    /// Selected attachment classes. Notes/canvas/base always remain selected.
    pub attachment_categories: BTreeSet<AttachmentCategory>,
    /// Selected Obsidian configuration classes.
    pub configuration_categories: BTreeSet<ConfigurationCategory>,
    /// Excluded folder paths, matching boundaries rather than string prefixes.
    pub excluded_folders: BTreeSet<String>,
}

impl Default for SyncFilter {
    fn default() -> Self {
        Self {
            configuration_directory: ".obsidian".into(),
            attachment_categories: BTreeSet::from([
                AttachmentCategory::Image,
                AttachmentCategory::Audio,
                AttachmentCategory::Video,
                AttachmentCategory::Pdf,
                AttachmentCategory::Unsupported,
            ]),
            configuration_categories: BTreeSet::from([
                ConfigurationCategory::App,
                ConfigurationCategory::Appearance,
                ConfigurationCategory::AppearanceData,
                ConfigurationCategory::Hotkey,
                ConfigurationCategory::CorePlugin,
                ConfigurationCategory::CorePluginData,
                ConfigurationCategory::CommunityPlugin,
                ConfigurationCategory::CommunityPluginData,
            ]),
            excluded_folders: BTreeSet::new(),
        }
    }
}

impl SyncFilter {
    /// Validate device-independent configuration and folder boundaries.
    ///
    /// # Errors
    /// Rejects invalid config directory or traversing excluded paths.
    pub fn validate(&self) -> Result<()> {
        validate_path(&self.configuration_directory)?;
        if self.configuration_directory.contains('/') {
            return Err(SyncError::Path);
        }
        for folder in &self.excluded_folders {
            validate_path(folder)?;
        }
        Ok(())
    }

    /// Whether the official client would include a file/folder with this path.
    /// Invalid paths are always rejected before reaching a host filesystem.
    #[must_use]
    pub fn allows(&self, path: &str, folder: bool) -> bool {
        if validate_path(path).is_err() {
            return false;
        }
        if self.excluded_folders.iter().any(|excluded| {
            (folder && path == excluded)
                || path
                    .strip_prefix(excluded)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        }) {
            return false;
        }
        if !folder
            && let Some(relative) = path.strip_prefix(&format!("{}/", self.configuration_directory))
        {
            return Self::configuration_category(relative)
                .is_some_and(|category| self.configuration_categories.contains(&category));
        }
        if path.starts_with('.') {
            return false;
        }
        if folder {
            return true;
        }
        let ext = extension(path.rsplit('/').next().unwrap_or_default());
        if matches!(ext.as_str(), "md" | "canvas" | "base") {
            return true;
        }
        let category = match ext.as_str() {
            "bmp" | "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "avif" => {
                AttachmentCategory::Image
            }
            "webm" => {
                return self
                    .attachment_categories
                    .contains(&AttachmentCategory::Audio)
                    || self
                        .attachment_categories
                        .contains(&AttachmentCategory::Video);
            }
            "mp3" | "wav" | "m4a" | "3gp" | "flac" | "ogg" | "oga" | "opus" => {
                AttachmentCategory::Audio
            }
            "mp4" | "ogv" | "mov" | "mkv" => AttachmentCategory::Video,
            "pdf" => AttachmentCategory::Pdf,
            _ => AttachmentCategory::Unsupported,
        };
        self.attachment_categories.contains(&category)
    }

    fn configuration_category(relative: &str) -> Option<ConfigurationCategory> {
        let components: Vec<_> = relative.split('/').collect();
        if components
            .iter()
            .any(|component| *component == "node_modules" || component.starts_with('.'))
        {
            return None;
        }
        let name = components.last().copied()?;
        match relative {
            "workspace.json" | "workspace-mobile.json" => return None,
            "app.json" | "types.json" => return Some(ConfigurationCategory::App),
            "appearance.json" => return Some(ConfigurationCategory::Appearance),
            "hotkeys.json" => return Some(ConfigurationCategory::Hotkey),
            "core-plugins.json" | "core-plugins-migration.json" => {
                return Some(ConfigurationCategory::CorePlugin);
            }
            "community-plugins.json" => return Some(ConfigurationCategory::CommunityPlugin),
            _ => {}
        }
        match components.as_slice() {
            ["themes", _, "theme.css" | "manifest.json"] => {
                Some(ConfigurationCategory::AppearanceData)
            }
            ["snippets", _] if extension(name) == "css" => {
                Some(ConfigurationCategory::AppearanceData)
            }
            [_] if extension(name) == "json" => Some(ConfigurationCategory::CorePluginData),
            [
                "plugins",
                _,
                "manifest.json" | "main.js" | "styles.css" | "data.json",
            ] => Some(ConfigurationCategory::CommunityPluginData),
            _ => None,
        }
    }
}

/// Check a decrypted protocol path without Unicode/case normalization.
///
/// # Errors
/// Rejects absolute, drive, traversing, empty, backslash, and control paths.
pub fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(SyncError::Path);
    }
    let bytes = path.as_bytes();
    if bytes.first().is_some_and(u8::is_ascii_alphabetic) && bytes.get(1) == Some(&b':') {
        return Err(SyncError::Path);
    }
    Ok(())
}

pub(crate) fn extension(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((before, after)) if !before.is_empty() && !after.is_empty() => after.to_lowercase(),
        _ => String::new(),
    }
}
