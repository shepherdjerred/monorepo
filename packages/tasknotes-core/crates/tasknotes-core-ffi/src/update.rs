//! The partial-update payload, monomorphised for the FFI.
//!
//! [`tasknotes_core::domain::FieldUpdate`] is generic and UniFFI has no
//! generics, so it cannot be exported and neither can
//! [`tasknotes_core::domain::UpdateTaskRequest`], which is built from three of
//! its instantiations. Phase 3 named those three, and this module gives each a
//! concrete exported enum plus a mirrored record that uses them.
//!
//! This is the only place in the crate where a core type is *mirrored* rather
//! than remote-derived, and it is the only place where that is necessary. The
//! conversions below are exhaustive `match`es in both directions, so a fourth
//! instantiation or a new `FieldUpdate` variant is a compile error here.
//!
//! # Why the three states matter
//!
//! Absent, `null`, and a value mean three different things to the server:
//! leave the frontmatter key alone, delete it, replace it. Collapsing any two
//! of them corrupts a note — an absent field treated as `null` erases data, and
//! a `null` treated as absent makes "clear the due date" a silent no-op. Swift
//! gets all three as enum cases so the distinction cannot be lost at the call
//! site.
//!
//! As everywhere on this boundary, field and variant order is the ABI.

use tasknotes_core::domain::{
    ContextName, ExtraFields, FieldUpdate, Priority, ProjectName, RecurrenceAnchor, TagName,
    TaskStatus, TaskTitle,
};

/// Declare the exported form of one [`FieldUpdate`] instantiation.
///
/// The three enums are structurally identical and differ only in the payload
/// type; writing them out three times would invite the copies — and, worse,
/// their conversions — to drift apart while still compiling.
macro_rules! field_update {
    ($(#[$meta:meta])* $name:ident, $payload:ty) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, uniffi::Enum)]
        pub enum $name {
            /// The key is absent from the payload: leave the stored value alone.
            #[default]
            Unchanged,
            /// The key is present and `null`: delete the stored value.
            Clear,
            /// The key is present with a value: store it.
            Set {
                /// The value to store.
                value: $payload,
            },
        }

        impl From<FieldUpdate<$payload>> for $name {
            fn from(update: FieldUpdate<$payload>) -> Self {
                match update {
                    FieldUpdate::Unchanged => Self::Unchanged,
                    FieldUpdate::Clear => Self::Clear,
                    FieldUpdate::Set(value) => Self::Set { value },
                }
            }
        }

        impl From<$name> for FieldUpdate<$payload> {
            fn from(update: $name) -> Self {
                match update {
                    $name::Unchanged => Self::Unchanged,
                    $name::Clear => Self::Clear,
                    $name::Set { value } => Self::Set(value),
                }
            }
        }
    };
}

field_update!(
    /// A clearable string field.
    ///
    /// The exported counterpart of [`tasknotes_core::domain::TextUpdate`].
    TextUpdate,
    String
);

field_update!(
    /// A clearable whole-minutes field.
    ///
    /// The exported counterpart of [`tasknotes_core::domain::MinutesUpdate`].
    MinutesUpdate,
    u32
);

field_update!(
    /// A clearable recurrence anchor.
    ///
    /// The exported counterpart of
    /// [`tasknotes_core::domain::RecurrenceAnchorUpdate`].
    RecurrenceAnchorUpdate,
    RecurrenceAnchor
);

/// A partial update to a task.
///
/// Mirrors [`tasknotes_core::domain::UpdateTaskRequest`] field for field, in
/// declaration order. The fields that are optional-but-not-nullable in the
/// schema stay plain optionals: there is no way to *unset* a status or a title.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct UpdateTaskRequest {
    /// A new title. Cannot be cleared.
    pub title: Option<TaskTitle>,
    /// The note body; `Clear` deletes it.
    pub details: TextUpdate,
    /// A new status. Cannot be cleared.
    pub status: Option<TaskStatus>,
    /// A new priority. Cannot be cleared.
    pub priority: Option<Priority>,
    /// The due date; `Clear` deletes it.
    pub due: TextUpdate,
    /// The scheduled date; `Clear` deletes it.
    pub scheduled: TextUpdate,
    /// The full replacement context list.
    pub contexts: Option<Vec<ContextName>>,
    /// The full replacement project list.
    pub projects: Option<Vec<ProjectName>>,
    /// The full replacement tag list.
    pub tags: Option<Vec<TagName>>,
    /// The recurrence rule; `Clear` stops the task repeating.
    pub recurrence: TextUpdate,
    /// What the recurrence is measured from; `Clear` deletes it.
    pub recurrence_anchor: RecurrenceAnchorUpdate,
    /// The estimate in whole minutes; `Clear` deletes it.
    pub time_estimate: MinutesUpdate,
    /// The full replacement set of extra frontmatter keys, as a JSON object
    /// string.
    pub extra_fields: Option<ExtraFields>,
}

impl From<tasknotes_core::domain::UpdateTaskRequest> for UpdateTaskRequest {
    fn from(request: tasknotes_core::domain::UpdateTaskRequest) -> Self {
        let tasknotes_core::domain::UpdateTaskRequest {
            title,
            details,
            status,
            priority,
            due,
            scheduled,
            contexts,
            projects,
            tags,
            recurrence,
            recurrence_anchor,
            time_estimate,
            extra_fields,
        } = request;
        Self {
            title,
            details: details.into(),
            status,
            priority,
            due: due.into(),
            scheduled: scheduled.into(),
            contexts,
            projects,
            tags,
            recurrence: recurrence.into(),
            recurrence_anchor: recurrence_anchor.into(),
            time_estimate: time_estimate.into(),
            extra_fields,
        }
    }
}

impl From<UpdateTaskRequest> for tasknotes_core::domain::UpdateTaskRequest {
    fn from(request: UpdateTaskRequest) -> Self {
        let UpdateTaskRequest {
            title,
            details,
            status,
            priority,
            due,
            scheduled,
            contexts,
            projects,
            tags,
            recurrence,
            recurrence_anchor,
            time_estimate,
            extra_fields,
        } = request;
        Self {
            title,
            details: details.into(),
            status,
            priority,
            due: due.into(),
            scheduled: scheduled.into(),
            contexts,
            projects,
            tags,
            recurrence: recurrence.into(),
            recurrence_anchor: recurrence_anchor.into(),
            time_estimate: time_estimate.into(),
            extra_fields,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tasknotes_core::domain::{FieldUpdate, RecurrenceAnchor};

    use super::{MinutesUpdate, RecurrenceAnchorUpdate, TextUpdate, UpdateTaskRequest};

    #[test]
    fn every_field_update_state_round_trips() {
        for update in [
            FieldUpdate::Unchanged,
            FieldUpdate::Clear,
            FieldUpdate::Set("2026-08-08".to_owned()),
        ] {
            let exported = TextUpdate::from(update.clone());
            assert_eq!(FieldUpdate::from(exported), update);
        }

        for update in [
            FieldUpdate::Unchanged,
            FieldUpdate::Clear,
            FieldUpdate::Set(30),
        ] {
            let exported = MinutesUpdate::from(update);
            assert_eq!(FieldUpdate::from(exported), update);
        }

        for update in [
            FieldUpdate::Unchanged,
            FieldUpdate::Clear,
            FieldUpdate::Set(RecurrenceAnchor::Completion),
        ] {
            let exported = RecurrenceAnchorUpdate::from(update);
            assert_eq!(FieldUpdate::from(exported), update);
        }
    }

    #[test]
    fn an_unchanged_field_is_the_default_on_both_sides() {
        assert_eq!(TextUpdate::default(), TextUpdate::Unchanged);
        assert_eq!(
            UpdateTaskRequest::from(tasknotes_core::domain::UpdateTaskRequest::default()),
            UpdateTaskRequest::default()
        );
    }

    #[test]
    fn a_populated_update_round_trips_without_collapsing_the_three_states() {
        let core: tasknotes_core::domain::UpdateTaskRequest = serde_json::from_value(json!({
            "title": "New",
            "details": null,
            "status": "done",
            "due": "2026-08-08",
            "recurrenceAnchor": "completion",
            "timeEstimate": null,
        }))
        .unwrap();

        let exported = UpdateTaskRequest::from(core.clone());
        assert_eq!(exported.details, TextUpdate::Clear);
        assert_eq!(
            exported.due,
            TextUpdate::Set {
                value: "2026-08-08".to_owned()
            }
        );
        assert_eq!(exported.scheduled, TextUpdate::Unchanged);
        assert_eq!(exported.time_estimate, MinutesUpdate::Clear);
        assert_eq!(
            exported.recurrence_anchor,
            RecurrenceAnchorUpdate::Set {
                value: RecurrenceAnchor::Completion
            }
        );

        assert_eq!(
            tasknotes_core::domain::UpdateTaskRequest::from(exported),
            core
        );
    }
}
