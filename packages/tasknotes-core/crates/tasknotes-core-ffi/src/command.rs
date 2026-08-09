//! The command algebra, monomorphised for the FFI.
//!
//! [`tasknotes_core::sync::Command`] and
//! [`tasknotes_core::sync::CommandInput`] both carry a
//! [`tasknotes_core::domain::UpdateTaskRequest`], which is generic over
//! `FieldUpdate<T>` and therefore unexportable — see [`crate::update`]. So
//! these two enums cannot be remote-derived the way [`crate::types`] derives
//! everything else, and are mirrored instead. The conversions are exhaustive
//! `match`es in both directions, so a sixth variant or a renamed field is a
//! compile error here rather than a silent binding change.
//!
//! [`DeadLetterEntry`] is mirrored for the same reason, one level up: it holds
//! a [`Command`].
//!
//! ## Order is the ABI, twice over
//!
//! Variant order is the FFI discriminant and field order is positional in the
//! FFI buffer, so both follow the core's declaration order exactly — there is
//! one canonical answer rather than two. The `SetInstanceComplete` variant is
//! the sharpest case: `date: String` sits beside `id: String`, and swapping
//! them would leave every API checksum and the whole C header byte-identical
//! while quietly writing a command id into a completion date.

use tasknotes_core::{
    domain::{CreateTaskRequest, TaskId, TaskStatus},
    sync::{self, DeadLetterError},
};

use crate::update::UpdateTaskRequest;

/// The recorded form of one user mutation.
///
/// Mirrors [`tasknotes_core::sync::Command`] variant for variant and field for
/// field. Note what is **not** here: a "patch" or a "toggle". Every command
/// carries absolute target state, which is what makes both the on-device rebase
/// and the server-side replay idempotent.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum Command {
    /// Create a task that does not exist on the server yet.
    Create {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The client-minted id the optimistic task is shown under.
        temp_id: TaskId,
        /// What to create.
        payload: CreateTaskRequest,
    },
    /// Apply a partial update to an existing task.
    Update {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to update.
        task_id: TaskId,
        /// The three-state partial update.
        payload: UpdateTaskRequest,
    },
    /// Delete a task.
    Delete {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to delete.
        task_id: TaskId,
    },
    /// Set a task's status to an absolute value.
    SetStatus {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to restatus.
        task_id: TaskId,
        /// The status to set. Absolute, never derived from the current one.
        status: TaskStatus,
    },
    /// Set one occurrence of a recurring task to an absolute completion state.
    SetInstanceComplete {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The recurring task.
        task_id: TaskId,
        /// The occurrence's date, as `YYYY-MM-DD`.
        date: String,
        /// The state to set the occurrence to.
        completed: bool,
    },
}

impl From<sync::Command> for Command {
    fn from(command: sync::Command) -> Self {
        match command {
            sync::Command::Create {
                id,
                created_at,
                temp_id,
                payload,
            } => Self::Create {
                id,
                created_at,
                temp_id,
                payload,
            },
            sync::Command::Update {
                id,
                created_at,
                task_id,
                payload,
            } => Self::Update {
                id,
                created_at,
                task_id,
                payload: payload.into(),
            },
            sync::Command::Delete {
                id,
                created_at,
                task_id,
            } => Self::Delete {
                id,
                created_at,
                task_id,
            },
            sync::Command::SetStatus {
                id,
                created_at,
                task_id,
                status,
            } => Self::SetStatus {
                id,
                created_at,
                task_id,
                status,
            },
            sync::Command::SetInstanceComplete {
                id,
                created_at,
                task_id,
                date,
                completed,
            } => Self::SetInstanceComplete {
                id,
                created_at,
                task_id,
                date,
                completed,
            },
        }
    }
}

impl From<Command> for sync::Command {
    fn from(command: Command) -> Self {
        match command {
            Command::Create {
                id,
                created_at,
                temp_id,
                payload,
            } => Self::Create {
                id,
                created_at,
                temp_id,
                payload,
            },
            Command::Update {
                id,
                created_at,
                task_id,
                payload,
            } => Self::Update {
                id,
                created_at,
                task_id,
                payload: payload.into(),
            },
            Command::Delete {
                id,
                created_at,
                task_id,
            } => Self::Delete {
                id,
                created_at,
                task_id,
            },
            Command::SetStatus {
                id,
                created_at,
                task_id,
                status,
            } => Self::SetStatus {
                id,
                created_at,
                task_id,
                status,
            },
            Command::SetInstanceComplete {
                id,
                created_at,
                task_id,
                date,
                completed,
            } => Self::SetInstanceComplete {
                id,
                created_at,
                task_id,
                date,
                completed,
            },
        }
    }
}

/// A mutation as the UI expresses it, before ids and timestamps are minted.
///
/// Mirrors [`tasknotes_core::sync::CommandInput`]. The host never mints a
/// command id or a temp id: that happens in exactly one place inside the core,
/// so the two counters cannot drift, and a host that invented its own would
/// break the server's `X-Mutation-Id` idempotency.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum CommandInput {
    /// Create a task.
    Create {
        /// What to create.
        payload: CreateTaskRequest,
    },
    /// Update a task.
    Update {
        /// The task to update, before alias resolution.
        task_id: TaskId,
        /// The three-state partial update.
        payload: UpdateTaskRequest,
    },
    /// Delete a task.
    Delete {
        /// The task to delete, before alias resolution.
        task_id: TaskId,
    },
    /// Set a task's status.
    SetStatus {
        /// The task to restatus, before alias resolution.
        task_id: TaskId,
        /// The status to set.
        status: TaskStatus,
    },
    /// Set one occurrence's completion state.
    SetInstanceComplete {
        /// The recurring task, before alias resolution.
        task_id: TaskId,
        /// The occurrence's date, as `YYYY-MM-DD`.
        ///
        /// Captured from the device's calendar **at the moment of the tap**, so
        /// a 23:59 completion replayed after midnight still lands on the day
        /// the user meant. The host supplies it because only the host knows the
        /// device's timezone.
        date: String,
        /// The state to set it to.
        completed: bool,
    },
}

impl From<CommandInput> for sync::CommandInput {
    fn from(input: CommandInput) -> Self {
        match input {
            CommandInput::Create { payload } => Self::Create { payload },
            CommandInput::Update { task_id, payload } => Self::Update {
                task_id,
                payload: payload.into(),
            },
            CommandInput::Delete { task_id } => Self::Delete { task_id },
            CommandInput::SetStatus { task_id, status } => Self::SetStatus { task_id, status },
            CommandInput::SetInstanceComplete {
                task_id,
                date,
                completed,
            } => Self::SetInstanceComplete {
                task_id,
                date,
                completed,
            },
        }
    }
}

impl From<sync::CommandInput> for CommandInput {
    fn from(input: sync::CommandInput) -> Self {
        match input {
            sync::CommandInput::Create { payload } => Self::Create { payload },
            sync::CommandInput::Update { task_id, payload } => Self::Update {
                task_id,
                payload: payload.into(),
            },
            sync::CommandInput::Delete { task_id } => Self::Delete { task_id },
            sync::CommandInput::SetStatus { task_id, status } => {
                Self::SetStatus { task_id, status }
            }
            sync::CommandInput::SetInstanceComplete {
                task_id,
                date,
                completed,
            } => Self::SetInstanceComplete {
                task_id,
                date,
                completed,
            },
        }
    }
}

/// A command that failed permanently, parked for the user to review.
///
/// Mirrors [`tasknotes_core::sync::DeadLetterEntry`], which cannot be
/// remote-derived because it holds a [`Command`].
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DeadLetterEntry {
    /// The command that failed.
    pub command: Command,
    /// Why it failed, in the persisted shape.
    pub error: DeadLetterError,
    /// When it was parked, in epoch milliseconds.
    pub failed_at: i64,
}

impl From<sync::DeadLetterEntry> for DeadLetterEntry {
    fn from(entry: sync::DeadLetterEntry) -> Self {
        let sync::DeadLetterEntry {
            command,
            error,
            failed_at,
        } = entry;
        Self {
            command: command.into(),
            error,
            failed_at,
        }
    }
}

impl From<DeadLetterEntry> for sync::DeadLetterEntry {
    fn from(entry: DeadLetterEntry) -> Self {
        let DeadLetterEntry {
            command,
            error,
            failed_at,
        } = entry;
        Self {
            command: command.into(),
            error,
            failed_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use tasknotes_core::{
        Error,
        domain::{CreateTaskRequest, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest},
        sync::{self, DeadLetterError},
    };

    use super::{Command, CommandInput, DeadLetterEntry};

    fn every_core_command() -> Vec<sync::Command> {
        let task_id = TaskId::parse("Tasks/a.md").unwrap();
        let payload: UpdateTaskRequest =
            serde_json::from_value(serde_json::json!({ "due": null, "title": "Renamed" })).unwrap();
        vec![
            sync::Command::Create {
                id: "c1".to_owned(),
                created_at: 1,
                temp_id: TaskId::parse("tmp-1-1").unwrap(),
                payload: CreateTaskRequest::new(TaskTitle::parse("Made offline").unwrap()),
            },
            sync::Command::Update {
                id: "c2".to_owned(),
                created_at: 2,
                task_id: task_id.clone(),
                payload,
            },
            sync::Command::Delete {
                id: "c3".to_owned(),
                created_at: 3,
                task_id: task_id.clone(),
            },
            sync::Command::SetStatus {
                id: "c4".to_owned(),
                created_at: 4,
                task_id: task_id.clone(),
                status: TaskStatus::Done,
            },
            sync::Command::SetInstanceComplete {
                id: "c5".to_owned(),
                created_at: 5,
                task_id,
                date: "2026-07-01".to_owned(),
                completed: true,
            },
        ]
    }

    #[test]
    fn every_command_variant_round_trips_through_the_mirror() {
        for command in every_core_command() {
            let exported = Command::from(command.clone());
            assert_eq!(sync::Command::from(exported), command);
        }
    }

    #[test]
    fn the_mirror_keeps_the_id_and_the_completion_date_apart() {
        // Both are `String` and adjacent in the buffer, which is exactly the
        // shape the Phase 6 spike proved no checksum can detect.
        let Command::SetInstanceComplete {
            ref id, ref date, ..
        } = Command::from(sync::Command::SetInstanceComplete {
            id: "c5".to_owned(),
            created_at: 5,
            task_id: TaskId::parse("Tasks/a.md").unwrap(),
            date: "2026-07-01".to_owned(),
            completed: true,
        })
        else {
            panic!("the mirror changed the variant");
        };
        assert_eq!(id, "c5");
        assert_eq!(date, "2026-07-01");
    }

    #[test]
    fn every_command_input_variant_round_trips_through_the_mirror() {
        let task_id = TaskId::parse("Tasks/a.md").unwrap();
        for input in [
            sync::CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Made offline").unwrap()),
            },
            sync::CommandInput::Update {
                task_id: task_id.clone(),
                payload: UpdateTaskRequest::default(),
            },
            sync::CommandInput::Delete {
                task_id: task_id.clone(),
            },
            sync::CommandInput::SetStatus {
                task_id: task_id.clone(),
                status: TaskStatus::Done,
            },
            sync::CommandInput::SetInstanceComplete {
                task_id,
                date: "2026-07-01".to_owned(),
                completed: false,
            },
        ] {
            let exported = CommandInput::from(input.clone());
            assert_eq!(sync::CommandInput::from(exported), input);
        }
    }

    #[test]
    fn a_dead_letter_entry_round_trips_with_its_persisted_error_shape() {
        let entry = sync::DeadLetterEntry {
            command: sync::Command::Delete {
                id: "c3".to_owned(),
                created_at: 3,
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            },
            error: DeadLetterError::from(&Error::api("nope", 422)),
            failed_at: 99,
        };
        let exported = DeadLetterEntry::from(entry.clone());
        assert_eq!(exported.error.name, "ApiError");
        assert_eq!(exported.error.status, Some(422));
        assert_eq!(sync::DeadLetterEntry::from(exported), entry);
    }
}
