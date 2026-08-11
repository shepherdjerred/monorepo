//! Task priority.

use crate::{Error, Result};

/// A task's priority.
///
/// A **closed** enum, like [`super::status::TaskStatus`]: the app's workflow is
/// the vault's post-migration workflow, and a plugin-side custom priority must
/// fail validation loudly at the wire boundary instead of being silently
/// remapped onto the nearest known value.
///
/// **The declaration order is the sort order.** `PRIORITY_ORDER` in TypeScript
/// assigns `highest = 0 … none = 5`, which is exactly the derived [`Ord`] here,
/// so `a.cmp(b)` *is* `comparePriority(a, b)`. Reordering these variants
/// silently changes how every list sorts — and, once the FFI layer exports this
/// enum, changes the wire discriminant too.
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
#[serde(rename_all = "lowercase")]
pub enum Priority {
    /// P1 — the most urgent.
    Highest,
    /// P2.
    High,
    /// P3.
    Medium,
    /// The default for a task that never had a priority set.
    #[default]
    Normal,
    /// P4.
    Low,
    /// Explicitly deprioritized.
    None,
}

/// Every priority, most urgent first.
///
/// Mirrors `ALL_PRIORITIES`, which the pickers iterate in this order.
pub const ALL_PRIORITIES: [Priority; 6] = [
    Priority::Highest,
    Priority::High,
    Priority::Medium,
    Priority::Normal,
    Priority::Low,
    Priority::None,
];

impl Priority {
    /// The wire spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Highest => "highest",
            Self::High => "high",
            Self::Medium => "medium",
            Self::Normal => "normal",
            Self::Low => "low",
            Self::None => "none",
        }
    }

    /// Parse the wire spelling.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] for any value outside the closed set. This
    /// is deliberate: an unrecognised priority is a configuration mismatch
    /// between the vault and the client, and silently coercing it would hide
    /// the mismatch behind wrong-looking task lists.
    pub fn parse(raw: &str) -> Result<Self> {
        ALL_PRIORITIES
            .into_iter()
            .find(|priority| priority.as_str() == raw)
            .ok_or_else(|| {
                Error::invariant(format!(
                    "unknown priority {raw:?}; expected one of {:?}",
                    ALL_PRIORITIES.map(Self::as_str)
                ))
            })
    }

    /// The rank used for ordering, `0` being the most urgent.
    ///
    /// Redundant with [`Ord`] by construction and kept because the TypeScript
    /// `PRIORITY_ORDER` map is part of the parity surface — a test asserts the
    /// two agree, which is what makes reordering the variants a test failure
    /// rather than a silent behaviour change.
    #[must_use]
    pub const fn rank(self) -> u8 {
        match self {
            Self::Highest => 0,
            Self::High => 1,
            Self::Medium => 2,
            Self::Normal => 3,
            Self::Low => 4,
            Self::None => 5,
        }
    }

    /// The short label shown in menus and rows.
    ///
    /// Labels are content, not theming: they read identically on every
    /// platform, so they belong in the shared core. Colours deliberately do
    /// **not** — the macOS client uses semantic system colours that follow the
    /// system appearance, which a hard-coded hex triple cannot.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Highest => "P1",
            Self::High => "P2",
            Self::Medium => "P3",
            Self::Normal => "Normal",
            Self::Low => "P4",
            Self::None => "None",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::{ALL_PRIORITIES, Priority};

    #[test]
    fn parses_and_renders_every_wire_spelling() {
        for priority in ALL_PRIORITIES {
            assert_eq!(Priority::parse(priority.as_str()).unwrap(), priority);
        }
    }

    #[test]
    fn rejects_an_unknown_priority_loudly() {
        let error = Priority::parse("urgent").unwrap_err();
        assert!(
            error.to_string().contains("unknown priority"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn derived_ordering_matches_the_typescript_priority_order() {
        for left in ALL_PRIORITIES {
            for right in ALL_PRIORITIES {
                let expected = left.rank().cmp(&right.rank());
                assert_eq!(
                    left.cmp(&right),
                    expected,
                    "declaration order diverged from rank for {left:?} vs {right:?}"
                );
            }
        }
        assert_eq!(Priority::Highest.cmp(&Priority::None), Ordering::Less);
    }

    #[test]
    fn serializes_as_its_wire_spelling() {
        let json = serde_json::to_string(&Priority::Highest).unwrap();
        assert_eq!(json, "\"highest\"");
        assert_eq!(
            serde_json::from_str::<Priority>("\"none\"").unwrap(),
            Priority::None
        );
        assert!(serde_json::from_str::<Priority>("\"urgent\"").is_err());
    }

    #[test]
    fn defaults_to_normal() {
        assert_eq!(Priority::default(), Priority::Normal);
    }
}
