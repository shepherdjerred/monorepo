//! Task status.

use crate::{Error, Result};

/// A task's status.
///
/// A **closed** six-variant enum, deliberately. The wire boundary's own comment
/// is the specification: *"a plugin-side custom status fails validation LOUDLY
/// here instead of being silently remapped"*. The app's workflow is the vault's
/// post-migration workflow, and quietly folding an unknown status into `open`
/// would make a task look actionable when the vault says otherwise.
///
/// Note that this is unrelated to
/// [`FilterOptions::statuses`](super::query::FilterOptions::statuses), which is
/// a list of plain strings: that endpoint returns the *server's configured*
/// status objects for populating a picker, not values that flow into a task.
///
/// As with [`super::priority::Priority`], the declaration order becomes the FFI
/// discriminant once the bindings are generated, so it is a wire format.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum TaskStatus {
    /// Not started.
    #[default]
    Open,
    /// Started but not finished.
    InProgress,
    /// Finished.
    Done,
    /// Abandoned; counts as completed for filtering purposes.
    Cancelled,
    /// Blocked on something outside the vault.
    Waiting,
    /// Handed to someone else.
    Delegated,
}

/// Every status, in declaration order.
pub const ALL_STATUSES: [TaskStatus; 6] = [
    TaskStatus::Open,
    TaskStatus::InProgress,
    TaskStatus::Done,
    TaskStatus::Cancelled,
    TaskStatus::Waiting,
    TaskStatus::Delegated,
];

/// The statuses that mean "still needs doing".
pub const ACTIVE_STATUSES: [TaskStatus; 4] = [
    TaskStatus::Open,
    TaskStatus::InProgress,
    TaskStatus::Waiting,
    TaskStatus::Delegated,
];

/// The statuses that mean "no longer needs doing".
pub const COMPLETED_STATUSES: [TaskStatus; 2] = [TaskStatus::Done, TaskStatus::Cancelled];

impl TaskStatus {
    /// The wire spelling. Note `in-progress` is kebab-case, not camelCase.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::InProgress => "in-progress",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
            Self::Waiting => "waiting",
            Self::Delegated => "delegated",
        }
    }

    /// Parse the wire spelling.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] for any value outside the closed set — see
    /// the type documentation for why this is a hard failure.
    pub fn parse(raw: &str) -> Result<Self> {
        ALL_STATUSES
            .into_iter()
            .find(|status| status.as_str() == raw)
            .ok_or_else(|| {
                Error::invariant(format!(
                    "unknown task status {raw:?}; expected one of {:?}",
                    ALL_STATUSES.map(Self::as_str)
                ))
            })
    }

    /// Whether the task still needs doing.
    ///
    /// Exhaustive rather than a set lookup, so adding a variant is a compile
    /// error here instead of a task silently disappearing from every list.
    #[must_use]
    pub const fn is_active(self) -> bool {
        match self {
            Self::Open | Self::InProgress | Self::Waiting | Self::Delegated => true,
            Self::Done | Self::Cancelled => false,
        }
    }

    /// Whether the task is finished or abandoned.
    #[must_use]
    pub const fn is_completed(self) -> bool {
        !self.is_active()
    }

    /// The status a single "toggle" gesture moves to.
    ///
    /// Everything that is not already done becomes done; everything else
    /// reopens. The sync layer records the *result* of this, never the gesture,
    /// so replaying a toggle twice is idempotent.
    #[must_use]
    pub const fn next(self) -> Self {
        match self {
            Self::Open | Self::InProgress => Self::Done,
            Self::Done | Self::Cancelled | Self::Waiting | Self::Delegated => Self::Open,
        }
    }

    /// The label shown in menus and rows.
    ///
    /// Content, not theming — see [`super::priority::Priority::label`]. The
    /// TypeScript `STATUS_ICONS` map is deliberately *not* ported: those are
    /// Feather icon names, and the macOS client draws SF Symbols.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::InProgress => "In Progress",
            Self::Done => "Done",
            Self::Cancelled => "Cancelled",
            Self::Waiting => "Waiting",
            Self::Delegated => "Delegated",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ACTIVE_STATUSES, ALL_STATUSES, COMPLETED_STATUSES, TaskStatus};

    #[test]
    fn parses_and_renders_every_wire_spelling() {
        for status in ALL_STATUSES {
            assert_eq!(TaskStatus::parse(status.as_str()).unwrap(), status);
        }
        assert_eq!(TaskStatus::InProgress.as_str(), "in-progress");
    }

    #[test]
    fn rejects_an_unknown_status_loudly() {
        for raw in ["someday", "inProgress", "in_progress", "Open", ""] {
            let error = TaskStatus::parse(raw).unwrap_err();
            assert!(
                error.to_string().contains("unknown task status"),
                "expected {raw:?} to be rejected, got {error}"
            );
        }
    }

    #[test]
    fn active_and_completed_partition_the_enum() {
        for status in ALL_STATUSES {
            assert_ne!(
                status.is_active(),
                status.is_completed(),
                "{status:?} is in both halves or neither"
            );
            let listed_active = ACTIVE_STATUSES.contains(&status);
            let listed_completed = COMPLETED_STATUSES.contains(&status);
            assert_eq!(status.is_active(), listed_active);
            assert_eq!(status.is_completed(), listed_completed);
        }
    }

    #[test]
    fn toggling_matches_the_typescript_transition_table() {
        assert_eq!(TaskStatus::Open.next(), TaskStatus::Done);
        assert_eq!(TaskStatus::InProgress.next(), TaskStatus::Done);
        assert_eq!(TaskStatus::Done.next(), TaskStatus::Open);
        assert_eq!(TaskStatus::Cancelled.next(), TaskStatus::Open);
        assert_eq!(TaskStatus::Waiting.next(), TaskStatus::Open);
        assert_eq!(TaskStatus::Delegated.next(), TaskStatus::Open);
    }

    #[test]
    fn serializes_as_its_wire_spelling() {
        assert_eq!(
            serde_json::to_string(&TaskStatus::InProgress).unwrap(),
            "\"in-progress\""
        );
        assert_eq!(
            serde_json::from_str::<TaskStatus>("\"delegated\"").unwrap(),
            TaskStatus::Delegated
        );
        assert!(serde_json::from_str::<TaskStatus>("\"someday\"").is_err());
    }

    #[test]
    fn defaults_to_open() {
        assert_eq!(TaskStatus::default(), TaskStatus::Open);
    }
}
