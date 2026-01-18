use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// User experience level for progressive disclosure
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "PascalCase")]
pub enum ExperienceLevel {
    /// First-time user (0-2 sessions, < 7 days)
    FirstTime,
    /// Regular user (3-9 sessions OR 7-30 days)
    Regular,
    /// Advanced user (10+ sessions OR 30+ days OR 3+ advanced operations)
    Advanced,
}

impl Default for ExperienceLevel {
    fn default() -> Self {
        Self::FirstTime
    }
}

impl std::fmt::Display for ExperienceLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FirstTime => write!(f, "FirstTime"),
            Self::Regular => write!(f, "Regular"),
            Self::Advanced => write!(f, "Advanced"),
        }
    }
}

impl std::str::FromStr for ExperienceLevel {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "FirstTime" => Ok(Self::FirstTime),
            "Regular" => Ok(Self::Regular),
            "Advanced" => Ok(Self::Advanced),
            _ => Err(anyhow::anyhow!("Invalid experience level: {}", s)),
        }
    }
}

/// User preferences for progressive disclosure and UI customization
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserPreferences {
    /// User ID
    pub user_id: String,
    /// Current experience level (calculated, not stored directly)
    pub experience_level: ExperienceLevel,
    /// Number of sessions created
    pub sessions_created_count: u32,
    /// Number of times user has attached to sessions
    pub sessions_attached_count: u32,
    /// Number of advanced operations used
    pub advanced_operations_used_count: u32,
    /// Timestamp of first session creation
    pub first_session_at: Option<DateTime<Utc>>,
    /// Timestamp of last activity
    pub last_activity_at: DateTime<Utc>,
    /// List of dismissed hint IDs
    pub dismissed_hints: Vec<String>,
    /// Custom UI preferences (JSON blob)
    pub ui_preferences: serde_json::Value,
    /// Timestamp of record creation
    pub created_at: DateTime<Utc>,
    /// Timestamp of last update
    pub updated_at: DateTime<Utc>,
}

impl UserPreferences {
    /// Create new default preferences for a user
    #[must_use]
    pub fn new(user_id: String) -> Self {
        let now = Utc::now();
        Self {
            user_id,
            experience_level: ExperienceLevel::FirstTime,
            sessions_created_count: 0,
            sessions_attached_count: 0,
            advanced_operations_used_count: 0,
            first_session_at: None,
            last_activity_at: now,
            dismissed_hints: Vec::new(),
            ui_preferences: serde_json::json!({}),
            created_at: now,
            updated_at: now,
        }
    }

    /// Calculate experience level based on user activity
    #[must_use]
    pub fn calculate_experience_level(&self) -> ExperienceLevel {
        let days_since_first = self
            .first_session_at
            .map(|dt| (Utc::now() - dt).num_days())
            .unwrap_or(0);

        // Advanced: 10+ sessions OR 30+ days OR 3+ advanced operations
        if self.sessions_created_count >= 10
            || days_since_first >= 30
            || self.advanced_operations_used_count >= 3
        {
            return ExperienceLevel::Advanced;
        }

        // Regular: 3+ sessions OR 7+ days
        if self.sessions_created_count >= 3 || days_since_first >= 7 {
            return ExperienceLevel::Regular;
        }

        ExperienceLevel::FirstTime
    }

    /// Check if the first run experience should be shown
    #[must_use]
    pub fn should_show_first_run(&self) -> bool {
        self.sessions_created_count == 0
            && !self
                .dismissed_hints
                .contains(&"first-run-complete".to_string())
    }

    /// Mark the first run experience as complete
    pub fn mark_first_run_complete(&mut self) {
        if !self
            .dismissed_hints
            .contains(&"first-run-complete".to_string())
        {
            self.dismissed_hints.push("first-run-complete".to_string());
            self.updated_at = Utc::now();
        }
    }

    /// Track a session creation
    pub fn track_session_created(&mut self) {
        self.sessions_created_count += 1;
        if self.first_session_at.is_none() {
            self.first_session_at = Some(Utc::now());
        }
        self.last_activity_at = Utc::now();
        self.updated_at = Utc::now();
        self.experience_level = self.calculate_experience_level();
    }

    /// Track a session attachment
    pub fn track_session_attached(&mut self) {
        self.sessions_attached_count += 1;
        self.last_activity_at = Utc::now();
        self.updated_at = Utc::now();
    }

    /// Track an advanced operation (Refresh, Reconcile, Regenerate Metadata, Update Access Mode)
    pub fn track_advanced_operation(&mut self) {
        self.advanced_operations_used_count += 1;
        self.last_activity_at = Utc::now();
        self.updated_at = Utc::now();
        self.experience_level = self.calculate_experience_level();
    }

    /// Dismiss a hint
    pub fn dismiss_hint(&mut self, hint_id: String) {
        if !self.dismissed_hints.contains(&hint_id) {
            self.dismissed_hints.push(hint_id);
            self.updated_at = Utc::now();
        }
    }

    /// Check if a hint has been dismissed
    #[must_use]
    pub fn is_hint_dismissed(&self, hint_id: &str) -> bool {
        self.dismissed_hints.contains(&hint_id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_first_time() {
        let prefs = UserPreferences::new("test_user".to_string());
        assert_eq!(
            prefs.calculate_experience_level(),
            ExperienceLevel::FirstTime
        );
    }

    #[test]
    fn test_regular_level_by_session_count() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        prefs.track_session_created();
        prefs.track_session_created();
        prefs.track_session_created();
        assert_eq!(prefs.calculate_experience_level(), ExperienceLevel::Regular);
    }

    #[test]
    fn test_advanced_level_by_session_count() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        for _ in 0..10 {
            prefs.track_session_created();
        }
        assert_eq!(
            prefs.calculate_experience_level(),
            ExperienceLevel::Advanced
        );
    }

    #[test]
    fn test_advanced_level_by_advanced_operations() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        prefs.track_advanced_operation();
        prefs.track_advanced_operation();
        prefs.track_advanced_operation();
        assert_eq!(
            prefs.calculate_experience_level(),
            ExperienceLevel::Advanced
        );
    }

    #[test]
    fn test_first_run_should_show() {
        let prefs = UserPreferences::new("test_user".to_string());
        assert!(prefs.should_show_first_run());
    }

    #[test]
    fn test_first_run_hidden_after_session() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        prefs.track_session_created();
        assert!(!prefs.should_show_first_run());
    }

    #[test]
    fn test_first_run_hidden_after_dismissal() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        prefs.mark_first_run_complete();
        assert!(!prefs.should_show_first_run());
    }

    #[test]
    fn test_hint_dismissal() {
        let mut prefs = UserPreferences::new("test_user".to_string());
        assert!(!prefs.is_hint_dismissed("test_hint"));
        prefs.dismiss_hint("test_hint".to_string());
        assert!(prefs.is_hint_dismissed("test_hint"));
    }
}
