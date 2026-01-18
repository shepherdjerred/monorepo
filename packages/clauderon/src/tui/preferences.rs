use anyhow::Context;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tracing::instrument;

use crate::core::{ExperienceLevel, UserPreferences};

/// Local preferences file for TUI (since TUI doesn't require auth)
const PREFERENCES_FILENAME: str = "preferences.json";

/// Get the preferences file path (~/.config/clauderon/preferences.json)
fn get_preferences_path() -> anyhow::Result<PathBuf> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Could not determine config directory"))?;
    let clauderon_dir = config_dir.join("clauderon");
    Ok(clauderon_dir.join(PREFERENCES_FILENAME))
}

/// TUI preferences manager
/// Stores user preferences locally since TUI doesn't require authentication
pub struct TuiPreferences {
    pub prefs: UserPreferences,
    file_path: PathBuf,
}

impl TuiPreferences {
    /// Load preferences from disk or create default
    #[instrument]
    pub async fn load() -> anyhow::Result<Self> {
        let file_path = get_preferences_path()?;

        // Ensure config directory exists
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .await
                .context("Failed to create config directory")?;
        }

        // Try to load existing preferences
        if file_path.exists() {
            match fs::read_to_string(&file_path).await {
                Ok(content) => match serde_json::from_str::<UserPreferences>(&content) {
                    Ok(mut prefs) => {
                        // Recalculate experience level on load
                        prefs.experience_level = prefs.calculate_experience_level();
                        tracing::debug!(
                            path = %file_path.display(),
                            level = ?prefs.experience_level,
                            "Loaded TUI preferences"
                        );
                        return Ok(Self { prefs, file_path });
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "Failed to parse preferences, creating new"
                        );
                    }
                },
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to read preferences, creating new");
                }
            }
        }

        // Create default preferences
        let prefs = UserPreferences::new("tui-user".to_string());
        tracing::info!(path = %file_path.display(), "Created new TUI preferences");

        let manager = Self { prefs, file_path };
        manager.save().await?;
        Ok(manager)
    }

    /// Save preferences to disk
    #[instrument(skip(self))]
    pub async fn save(&self) -> anyhow::Result<()> {
        let content =
            serde_json::to_string_pretty(&self.prefs).context("Failed to serialize preferences")?;

        fs::write(&self.file_path, content).await.with_context(|| {
            format!(
                "Failed to write preferences to {}",
                self.file_path.display()
            )
        })?;

        tracing::debug!(
            path = %self.file_path.display(),
            level = ?self.prefs.experience_level,
            "Saved TUI preferences"
        );

        Ok(())
    }

    /// Track a session creation
    pub async fn track_session_created(&mut self) -> anyhow::Result<()> {
        self.prefs.track_session_created();
        self.save().await
    }

    /// Track a session attachment
    pub async fn track_session_attached(&mut self) -> anyhow::Result<()> {
        self.prefs.track_session_attached();
        self.save().await
    }

    /// Track an advanced operation
    pub async fn track_advanced_operation(&mut self) -> anyhow::Result<()> {
        self.prefs.track_advanced_operation();
        self.save().await
    }

    /// Dismiss a hint
    pub async fn dismiss_hint(&mut self, hint_id: String) -> anyhow::Result<()> {
        self.prefs.dismiss_hint(hint_id);
        self.save().await
    }

    /// Mark first run as complete
    pub async fn mark_first_run_complete(&mut self) -> anyhow::Result<()> {
        self.prefs.mark_first_run_complete();
        self.save().await
    }

    /// Get current experience level
    #[must_use]
    pub fn experience_level(&self) -> ExperienceLevel {
        self.prefs.experience_level
    }

    /// Check if first run should be shown
    #[must_use]
    pub fn should_show_first_run(&self) -> bool {
        self.prefs.should_show_first_run()
    }

    /// Check if a hint is dismissed
    #[must_use]
    pub fn is_hint_dismissed(&self, hint_id: &str) -> bool {
        self.prefs.is_hint_dismissed(hint_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_preferences_path() {
        let path = get_preferences_path().unwrap();
        assert!(path.to_string_lossy().contains("clauderon"));
        assert!(path.to_string_lossy().ends_with("preferences.json"));
    }

    #[tokio::test]
    async fn test_track_operations() {
        // Create temp preferences
        let mut prefs = UserPreferences::new("test".to_string());
        assert_eq!(prefs.experience_level, ExperienceLevel::FirstTime);

        // Track sessions
        for _ in 0..3 {
            prefs.track_session_created();
        }
        assert_eq!(prefs.experience_level, ExperienceLevel::Regular);

        // Track advanced operations
        for _ in 0..3 {
            prefs.track_advanced_operation();
        }
        assert_eq!(prefs.experience_level, ExperienceLevel::Advanced);
    }
}
