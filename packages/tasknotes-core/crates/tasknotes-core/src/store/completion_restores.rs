//! The pre-completion schedules of occurrences this install has already had
//! acknowledged, and the rules for when one is still safe to send.
//!
//! ## Why the queue alone is not enough
//!
//! Completing an occurrence of a recurring task makes the *server* advance the
//! series. [`apply_command`](crate::sync::apply_command) deliberately does not,
//! so while the completion is still queued the visible task still carries the
//! pre-completion `scheduled`, `due`, and rule — the queue *is* the record.
//!
//! The moment that completion is acknowledged the queue stops being one: the
//! command is gone and the base now holds the advanced schedule, which is not
//! invertible. An uncompletion sent after that point can only be bare, and the
//! server's compatibility path keeps its already-advanced schedule for a bare
//! uncompletion — so the occurrence reads as undone while the series has
//! silently skipped a period. Undo is not a five-second affordance; a user
//! unticks yesterday's habit hours later, long after the queue drained.
//!
//! So the snapshot is *moved* into this durable map when the completion is
//! acknowledged, and consumed when the matching uncompletion is enqueued. This
//! is the same slot, the same key encoding, and the same invalidation rules as
//! the TypeScript client's `acknowledgedCompletionRestores`.
//!
//! ## Why it needs invalidation rules at all
//!
//! A retained snapshot is a *claim about what the server currently holds*.
//! Sending a stale one is worse than sending nothing, because the server
//! honours it: it rewinds a series to a schedule that some later edit already
//! replaced. Every rule below exists to drop a snapshot the moment it stops
//! describing the server's state — an occurrence edit, a pulled change, or the
//! day simply passing.

use indexmap::IndexMap;

use crate::{
    Error, Result,
    domain::{FieldUpdate, Task, TaskId, UpdateTaskRequest},
    net::InstanceRestore,
};

/// The key separator, byte-for-byte the TypeScript client's
/// `completionRestoreKey`.
///
/// NUL rather than a printable separator because a [`TaskId`] is a vault path
/// and may contain any of them; NUL is the one byte a path cannot hold, so the
/// encoding is unambiguous without escaping.
const SEPARATOR: char = '\u{0}';

/// One retained snapshot, in the shape it is persisted.
///
/// A wrapper record rather than a bare [`InstanceRestore`] because the
/// TypeScript slot is one, and the two clients have to agree on the bytes for
/// the format to mean anything.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct StoredCompletionRestore {
    /// The schedule the acknowledged completion replaced.
    pub(super) restore: InstanceRestore,
}

/// Retained snapshots, keyed by [`key`].
pub(super) type CompletionRestores = IndexMap<String, StoredCompletionRestore>;

/// The storage key for one occurrence of one task.
pub(super) fn key(task_id: &TaskId, date: &str) -> String {
    format!("{}{SEPARATOR}{date}", task_id.as_str())
}

/// Split a storage key back into its task and date, or `None` when it is not
/// one this crate wrote.
fn split(raw: &str) -> Option<(TaskId, &str)> {
    let (task_id, date) = raw.split_once(SEPARATOR)?;
    Some((TaskId::parse(task_id).ok()?, date))
}

/// The schedule a completion of `date` would replace, or `None` when the task
/// has no series to advance.
pub(super) fn snapshot(task: &Task, date: &str) -> Option<InstanceRestore> {
    Some(InstanceRestore {
        scheduled: task.scheduled.clone(),
        due: task.due.clone(),
        // A task with no rule has no series to advance, so there is nothing an
        // undo could restore.
        recurrence: task.recurrence.clone()?,
        skipped: task.skipped_instances.iter().any(|entry| entry == date),
    })
}

/// Parse the persisted map. **Absent** means empty; present-and-invalid is an
/// error.
///
/// Strict for the same reason [`parse_id_counters`](super::parse_id_counters)
/// is, and unlike [`parse_aliases`](super::parse_aliases): a half-read map is
/// indistinguishable from a *smaller* map, and a missing entry here is not a
/// missing feature but a silently wrong undo — the uncompletion goes bare and
/// the series keeps a period it should have given back. Refusing to launch is
/// recoverable by deleting one file; rewinding the wrong schedule is not.
pub(super) fn parse(raw: Option<&str>) -> Result<CompletionRestores> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Ok(CompletionRestores::new());
    };
    serde_json::from_str::<CompletionRestores>(raw).map_err(|error| {
        Error::invariant(format!(
            "the persisted completion restores exist but are unreadable, so the \
             schedules this install's completions replaced are unknown: {error}"
        ))
    })
}

/// Render the map for storage.
///
/// # Errors
///
/// A serialization failure, which is an invariant violation rather than a
/// storage fault.
pub(super) fn serialize(restores: &CompletionRestores) -> Result<String> {
    serde_json::to_string(restores).map_err(|error| {
        Error::invariant(format!(
            "could not serialize the completion restores: {error}"
        ))
    })
}

/// Drop every snapshot that has outlived its usefulness.
///
/// Two conditions, both about the snapshot no longer describing anything a user
/// can act on: the occurrence's day is past, so its row is gone from every
/// surface that offers the undo, and the task itself is no longer in the base,
/// so there is nothing left to rewind.
pub(super) fn prune(
    restores: &mut CompletionRestores,
    today: &str,
    tasks: &IndexMap<TaskId, Task>,
) {
    restores.retain(|raw, _| {
        split(raw).is_some_and(|(task_id, date)| date >= today && tasks.contains_key(&task_id))
    });
}

/// Drop every snapshot for one task.
pub(super) fn invalidate_task(restores: &mut CompletionRestores, task_id: &TaskId) {
    restores.retain(|raw, _| split(raw).is_some_and(|(owner, _)| &owner != task_id));
}

/// Drop every snapshot whose occurrence changed under a fresh pull.
///
/// A pull is the only place another client's edit becomes visible, and an edit
/// to the rule, either date, or the occurrence's skipped membership means the
/// server no longer holds the schedule this snapshot claims to put back. A task
/// that appears or disappears across the pull is left to [`prune`], which has
/// the base to judge it against.
pub(super) fn invalidate_changed(
    restores: &mut CompletionRestores,
    previous: &IndexMap<TaskId, Task>,
    next: &IndexMap<TaskId, Task>,
) {
    restores.retain(|raw, _| {
        let Some((task_id, date)) = split(raw) else {
            return false;
        };
        let (Some(before), Some(after)) = (previous.get(&task_id), next.get(&task_id)) else {
            return true;
        };
        before.recurrence == after.recurrence
            && before.scheduled == after.scheduled
            && before.due == after.due
            && skipped(before, date) == skipped(after, date)
    });
}

/// Whether `date` is in the task's skipped list.
fn skipped(task: &Task, date: &str) -> bool {
    task.skipped_instances.iter().any(|entry| entry == date)
}

/// Whether an update moves the occurrence grid — the rule, the scheduled date,
/// or the due date.
///
/// An update against a task that is not in the given map counts, because the
/// state it edited cannot be compared and a snapshot that might be stale has to
/// be treated as stale.
pub(super) fn is_occurrence_edit(payload: &UpdateTaskRequest, current: Option<&Task>) -> bool {
    let Some(current) = current else {
        return true;
    };
    changes(&payload.recurrence, current.recurrence.as_ref())
        || changes(&payload.scheduled, current.scheduled.as_ref())
        || changes(&payload.due, current.due.as_ref())
}

/// Whether one three-state field update actually changes the stored value.
///
/// Clearing an already-absent field is not an edit, which is what keeps a
/// routine "save" from the detail pane — which sends every field it rendered —
/// from throwing away a perfectly good snapshot.
fn changes(update: &FieldUpdate<String>, current: Option<&String>) -> bool {
    match *update {
        FieldUpdate::Unchanged => false,
        FieldUpdate::Clear => current.is_some(),
        FieldUpdate::Set(ref value) => current != Some(value),
    }
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;

    use super::{
        CompletionRestores, StoredCompletionRestore, invalidate_changed, invalidate_task,
        is_occurrence_edit, key, parse, prune, serialize, snapshot, split,
    };
    use crate::{
        domain::{FieldUpdate, Task, TaskId, TaskTitle, UpdateTaskRequest},
        net::InstanceRestore,
    };

    fn task(id: &str) -> Task {
        serde_json::from_value(serde_json::json!({
            "id": id, "path": id, "title": "Water the plants",
            "recurrence": "FREQ=WEEKLY",
            "scheduled": "2026-08-08",
        }))
        .unwrap()
    }

    fn restore() -> InstanceRestore {
        InstanceRestore {
            scheduled: Some("2026-08-08".to_owned()),
            due: None,
            recurrence: "FREQ=WEEKLY".to_owned(),
            skipped: false,
        }
    }

    fn map(entries: Vec<(&str, &str)>) -> CompletionRestores {
        entries
            .into_iter()
            .map(|(id, date)| {
                (
                    key(&TaskId::parse(id).unwrap(), date),
                    StoredCompletionRestore { restore: restore() },
                )
            })
            .collect()
    }

    fn base(tasks: Vec<Task>) -> IndexMap<TaskId, Task> {
        tasks
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect()
    }

    #[test]
    fn a_key_round_trips_through_a_path_containing_every_other_separator() {
        let id = TaskId::parse("TaskNotes/a-b_c d.e/f.md").unwrap();
        let encoded = key(&id, "2026-08-08");
        let (parsed, date) = split(&encoded).unwrap();
        assert_eq!(parsed, id);
        assert_eq!(date, "2026-08-08");
    }

    #[test]
    fn an_absent_map_is_empty_and_a_corrupt_one_is_an_error() {
        assert!(parse(None).unwrap().is_empty());
        assert!(parse(Some("")).unwrap().is_empty());
        assert!(parse(Some("not-json")).is_err());
    }

    #[test]
    fn a_serialized_map_round_trips() {
        let restores = map(vec![("TaskNotes/plants.md", "2026-08-08")]);
        assert_eq!(
            parse(Some(&serialize(&restores).unwrap())).unwrap(),
            restores
        );
    }

    #[test]
    fn a_task_with_no_rule_has_nothing_to_restore() {
        let mut plain = task("TaskNotes/plants.md");
        plain.recurrence = None;
        assert!(snapshot(&plain, "2026-08-08").is_none());
        assert_eq!(
            snapshot(&task("TaskNotes/plants.md"), "2026-08-08"),
            Some(restore())
        );
    }

    #[test]
    fn pruning_drops_past_days_absent_tasks_and_unreadable_keys() {
        let mut restores = map(vec![
            ("TaskNotes/plants.md", "2026-08-07"),
            ("TaskNotes/plants.md", "2026-08-08"),
            ("TaskNotes/plants.md", "2026-08-09"),
            ("TaskNotes/gone.md", "2026-08-09"),
        ]);
        restores.insert(
            "no-separator".to_owned(),
            StoredCompletionRestore { restore: restore() },
        );

        prune(
            &mut restores,
            "2026-08-08",
            &base(vec![task("TaskNotes/plants.md")]),
        );

        assert_eq!(
            restores,
            map(vec![
                ("TaskNotes/plants.md", "2026-08-08"),
                ("TaskNotes/plants.md", "2026-08-09"),
            ])
        );
    }

    #[test]
    fn invalidating_a_task_leaves_every_other_task_alone() {
        let mut restores = map(vec![
            ("TaskNotes/plants.md", "2026-08-08"),
            ("TaskNotes/plants.md", "2026-08-09"),
            ("TaskNotes/gym.md", "2026-08-08"),
        ]);

        invalidate_task(
            &mut restores,
            &TaskId::parse("TaskNotes/plants.md").unwrap(),
        );

        assert_eq!(restores, map(vec![("TaskNotes/gym.md", "2026-08-08")]));
    }

    #[test]
    fn a_pull_that_moves_the_grid_invalidates_and_one_that_does_not_retains() {
        let before = base(vec![task("TaskNotes/plants.md")]);
        let mut renamed = task("TaskNotes/plants.md");
        renamed.title = "Water every plant".to_owned();

        let mut retained = map(vec![("TaskNotes/plants.md", "2026-08-08")]);
        invalidate_changed(&mut retained, &before, &base(vec![renamed]));
        assert_eq!(retained, map(vec![("TaskNotes/plants.md", "2026-08-08")]));

        let mut rescheduled = task("TaskNotes/plants.md");
        rescheduled.recurrence = Some("FREQ=MONTHLY".to_owned());
        let mut dropped = map(vec![("TaskNotes/plants.md", "2026-08-08")]);
        invalidate_changed(&mut dropped, &before, &base(vec![rescheduled]));
        assert!(dropped.is_empty());
    }

    #[test]
    fn a_pull_that_skips_the_occurrence_invalidates_only_that_occurrence() {
        let before = base(vec![task("TaskNotes/plants.md")]);
        let mut skipped = task("TaskNotes/plants.md");
        skipped.skipped_instances = vec!["2026-08-08".to_owned()];

        let mut restores = map(vec![
            ("TaskNotes/plants.md", "2026-08-08"),
            ("TaskNotes/plants.md", "2026-08-09"),
        ]);
        invalidate_changed(&mut restores, &before, &base(vec![skipped]));

        assert_eq!(restores, map(vec![("TaskNotes/plants.md", "2026-08-09")]));
    }

    #[test]
    fn only_the_three_occurrence_fields_count_as_an_occurrence_edit() {
        let current = task("TaskNotes/plants.md");

        let renamed = UpdateTaskRequest {
            title: Some(TaskTitle::parse("Water every plant").unwrap()),
            ..UpdateTaskRequest::default()
        };
        assert!(!is_occurrence_edit(&renamed, Some(&current)));

        let resaved = UpdateTaskRequest {
            scheduled: FieldUpdate::Set("2026-08-08".to_owned()),
            due: FieldUpdate::Clear,
            recurrence: FieldUpdate::Set("FREQ=WEEKLY".to_owned()),
            ..UpdateTaskRequest::default()
        };
        assert!(!is_occurrence_edit(&resaved, Some(&current)));

        let moved = UpdateTaskRequest {
            scheduled: FieldUpdate::Set("2026-08-15".to_owned()),
            ..UpdateTaskRequest::default()
        };
        assert!(is_occurrence_edit(&moved, Some(&current)));

        let stopped = UpdateTaskRequest {
            recurrence: FieldUpdate::Clear,
            ..UpdateTaskRequest::default()
        };
        assert!(is_occurrence_edit(&stopped, Some(&current)));

        assert!(is_occurrence_edit(&renamed, None));
    }
}
