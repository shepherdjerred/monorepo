//! Validated identifiers.
//!
//! The TypeScript client brands these with `z.string().brand(...)`, which is a
//! compile-time-only tag: `taskId("")` succeeds there. Rust can do better, so
//! each of these is a real parse — an existing value of one of these types is
//! already known to satisfy its invariants, and no downstream code re-checks.

use std::{ffi::OsStr, fmt, path::Path};

use crate::{Error, Result};

/// The prefix marking a client-minted, not-yet-synced task id.
///
/// Kept here rather than in the sync layer because [`TaskId::parse`] has to
/// recognise it: an offline create names its task before the server has
/// assigned a path, so a temp id is a legal `TaskId` for as long as the create
/// is queued.
pub const TEMP_ID_PREFIX: &str = "tmp-";

/// A task's identity.
///
/// A task id is one of exactly two things:
///
/// * a **vault-relative markdown path** — the path *is* the identity upstream,
///   there is no separate identifier, so renaming a note re-ids the task and
///   the sync layer has to remap it; or
/// * a **temp id** (`tmp-…`), minted on-device for a create that has not
///   reached the server yet. The optimistic task it names has an empty `path`
///   until the create is acknowledged.
///
/// Anything else is rejected at the boundary. In particular an empty id is
/// rejected, where the TypeScript `taskId("")` silently succeeds: an empty id
/// only ever arises from a wire task with neither `path` nor `id`, which is a
/// server bug worth failing loudly on rather than propagating.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String", into = "String")]
pub struct TaskId(String);

impl TaskId {
    /// Parse a vault-relative markdown path or a temp id into a [`TaskId`].
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when `raw` is empty, is a bare temp
    /// prefix, is not vault-relative, or does not name a markdown file.
    pub fn parse(raw: impl Into<String>) -> Result<Self> {
        let raw = raw.into();
        if raw.is_empty() {
            return Err(Error::invariant("task id must not be empty"));
        }
        if let Some(suffix) = raw.strip_prefix(TEMP_ID_PREFIX) {
            if suffix.is_empty() {
                return Err(Error::invariant(
                    "a temp task id must carry a suffix after the `tmp-` prefix",
                ));
            }
            return Ok(Self(raw));
        }
        if raw.starts_with('/') {
            return Err(Error::invariant(format!(
                "task id must be vault-relative, got absolute path {raw:?}"
            )));
        }
        // Deliberately case-sensitive: the path *is* the identity, so "Note.md"
        // and "Note.MD" are different IDs even where the host filesystem would
        // conflate them. `Path::extension` (rather than `str::ends_with`) also
        // rejects a bare ".md" with no stem.
        if Path::new(&raw).extension() != Some(OsStr::new("md")) {
            return Err(Error::invariant(format!(
                "task id must name a markdown file, got {raw:?}"
            )));
        }
        Ok(Self(raw))
    }

    /// Mint a temp id from an already-obtained instant and a caller-held
    /// counter.
    ///
    /// Infallible by construction, and total: the format lives in exactly one
    /// place so the sync layer cannot drift from what [`TaskId::parse`] and
    /// [`TaskId::is_temp`] recognise. The instant is a parameter rather than a
    /// clock read because this crate is sans-I/O.
    #[must_use]
    pub fn temp(minted_at_millis: i64, counter: u64) -> Self {
        Self(format!("{TEMP_ID_PREFIX}{minted_at_millis}-{counter}"))
    }

    /// Whether this id was minted on-device and still needs remapping to the
    /// server-assigned path.
    #[must_use]
    pub fn is_temp(&self) -> bool {
        self.0.starts_with(TEMP_ID_PREFIX)
    }

    /// Borrow the underlying identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume the id, yielding the underlying identifier.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TryFrom<String> for TaskId {
    type Error = Error;

    /// # Errors
    ///
    /// See [`TaskId::parse`].
    fn try_from(raw: String) -> Result<Self> {
        Self::parse(raw)
    }
}

impl From<TaskId> for String {
    fn from(id: TaskId) -> Self {
        id.into_string()
    }
}

impl fmt::Display for TaskId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Declare a validated non-empty name newtype.
///
/// The three vault name types are structurally identical — a non-empty,
/// non-blank string that round-trips byte-exactly — and writing them out three
/// times invites the copies to drift apart. Trimming is deliberately *not*
/// applied: project matching trims at comparison time, and the vault's
/// frontmatter must be rewritten with the bytes it was read with.
macro_rules! vault_name {
    ($(#[$meta:meta])* $name:ident, $noun:literal) => {
        $(#[$meta])*
        #[derive(
            Debug,
            Clone,
            PartialEq,
            Eq,
            PartialOrd,
            Ord,
            Hash,
            serde::Serialize,
            serde::Deserialize,
        )]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            #[doc = concat!("Parse a ", $noun, ".")]
            ///
            /// # Errors
            ///
            /// Returns [`Error::Invariant`] when the value is empty or
            /// contains only whitespace, neither of which can name anything in
            /// a vault.
            pub fn parse(raw: impl Into<String>) -> Result<Self> {
                let raw = raw.into();
                if raw.trim().is_empty() {
                    return Err(Error::invariant(concat!(
                        "a ", $noun, " must not be blank"
                    )));
                }
                Ok(Self(raw))
            }

            #[doc = concat!("Borrow the underlying ", $noun, ".")]
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            #[doc = concat!("Consume the ", $noun, ", yielding its string.")]
            #[must_use]
            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = Error;

            #[doc = concat!("# Errors\n\nSee [`", stringify!($name), "::parse`].")]
            fn try_from(raw: String) -> Result<Self> {
                Self::parse(raw)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.into_string()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

vault_name!(
    /// A project a task belongs to.
    ///
    /// Upstream stores these either bare (`Work`) or as a wikilink
    /// (`[[Areas/Work|Work]]`); see [`crate::domain::project`] for the
    /// equivalence rules that make the two spellings the same project.
    ProjectName,
    "project name"
);

vault_name!(
    /// A context a task is available in (`@home`, `@errands`, …).
    ContextName,
    "context name"
);

vault_name!(
    /// A tag applied to a task.
    TagName,
    "tag name"
);

#[cfg(test)]
mod tests {
    use super::{ContextName, ProjectName, TagName, TaskId};

    #[test]
    fn parses_a_vault_relative_markdown_path() {
        let id = TaskId::parse("Tasks/write the plan.md").unwrap();
        assert_eq!(id.as_str(), "Tasks/write the plan.md");
        assert!(!id.is_temp());
    }

    #[test]
    fn parses_a_temp_id() {
        let id = TaskId::parse("tmp-1754611200000-7").unwrap();
        assert!(id.is_temp());
        assert_eq!(id, TaskId::temp(1_754_611_200_000, 7));
    }

    #[test]
    fn rejects_paths_that_are_not_task_ids() {
        for raw in [
            "",
            "/Tasks/absolute.md",
            "Tasks/not-a-note.txt",
            ".md",
            "tmp-",
        ] {
            let error = TaskId::parse(raw).unwrap_err();
            assert!(
                error.to_string().starts_with("invariant violated: "),
                "expected an invariant error for {raw:?}, got {error}"
            );
        }
    }

    #[test]
    fn task_ids_round_trip_through_json_as_bare_strings() {
        let id = TaskId::parse("Tasks/a.md").unwrap();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"Tasks/a.md\"");
        assert_eq!(serde_json::from_str::<TaskId>(&json).unwrap(), id);
    }

    #[test]
    fn deserializing_an_illegal_task_id_fails() {
        let error = serde_json::from_str::<TaskId>("\"Tasks/a.txt\"").unwrap_err();
        assert!(
            error.to_string().contains("markdown file"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn names_reject_blank_values_and_preserve_bytes() {
        assert_eq!(
            ProjectName::parse("[[Areas/Work|Work]]").unwrap().as_str(),
            "[[Areas/Work|Work]]"
        );
        assert_eq!(ContextName::parse(" home ").unwrap().as_str(), " home ");
        assert_eq!(TagName::parse("#urgent").unwrap().as_str(), "#urgent");

        for blank in ["", "   ", "\t\n"] {
            assert!(ProjectName::parse(blank).is_err(), "accepted {blank:?}");
            assert!(ContextName::parse(blank).is_err(), "accepted {blank:?}");
            assert!(TagName::parse(blank).is_err(), "accepted {blank:?}");
        }
    }
}
