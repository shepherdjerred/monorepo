//! Read-only iOS agenda and search parity through the real durable index.

use super::{Arc, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value, json, profile};
use tasknotes_runtime::types::{AgendaDateKind, AgendaSection, Snapshot};

const TODAY: &str = "2026-10-25";

fn setup(notes: &[(&str, Value)]) -> Result<(Engine, Arc<Memory>)> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: completeInstances\n  skipped_instances: skippedInstances\n",
    )?;
    for (name, fields) in notes {
        seed(&files, name, fields.clone())?;
    }
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let snapshot = engine.refresh("a")?;
    assert!(snapshot.problems.is_empty(), "{:?}", snapshot.problems);
    Ok((engine, files))
}

fn seed(files: &Memory, name: &str, fields: Value) -> Result<()> {
    let Value::Object(fields) = fields else {
        return Err(RuntimeError::NotFound);
    };
    let mut properties = json!({"title":name,"status":"open","tags":["task"]})
        .as_object()
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    properties.extend(fields);
    files.seed(
        "a",
        &format!("Tasks/{name}.md"),
        format!(
            "---\n{}\n---\nPreserved body\n",
            serde_json::to_string(&properties)?
        )
        .as_bytes(),
    )
}

fn query(scope: &str) -> Query {
    Query {
        scope: Some(scope.into()),
        today: Some(TODAY.into()),
        completed: Some(false),
        ..Query::default()
    }
}

fn titles(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .tasks
        .iter()
        .map(|task| task.title.as_str())
        .collect()
}

#[test]
fn ios_agenda_today_keeps_overdue_and_selects_the_actual_planned_or_deadline_reason() -> Result<()>
{
    let (engine, files) = setup(&[
        (
            "Old planned",
            json!({"scheduled":"2026-10-24","due":"2026-11-01"}),
        ),
        (
            "Old deadline",
            json!({"due":"2026-10-23","scheduled":"2026-11-01"}),
        ),
        ("Plan today", json!({"scheduled":TODAY,"due":"2026-11-02"})),
        ("Due today", json!({"due":TODAY,"scheduled":"2026-11-02"})),
        ("Both today", json!({"due":TODAY,"scheduled":TODAY})),
        ("Future", json!({"due":"2026-11-01"})),
        ("Done", json!({"due":"2026-10-23","status":"done"})),
    ])?;
    let before = engine.snapshot("a", &Query::default())?;
    let mut request = query("todayAgenda");
    request.group_by = Some("agendaSection".into());
    let snapshot = engine.snapshot("a", &request)?;
    assert_eq!(snapshot.total_count, 5);
    assert_eq!(
        snapshot
            .groups
            .iter()
            .map(|group| group.key.as_str())
            .collect::<Vec<_>>(),
        ["overdue", "scheduled-today", "due-today"]
    );
    for (title, day, section, kind) in [
        (
            "Old planned",
            "2026-10-24",
            AgendaSection::Overdue,
            AgendaDateKind::Planned,
        ),
        (
            "Old deadline",
            "2026-10-23",
            AgendaSection::Overdue,
            AgendaDateKind::Deadline,
        ),
        (
            "Plan today",
            TODAY,
            AgendaSection::ScheduledToday,
            AgendaDateKind::Planned,
        ),
        (
            "Due today",
            TODAY,
            AgendaSection::DueToday,
            AgendaDateKind::Deadline,
        ),
        (
            "Both today",
            TODAY,
            AgendaSection::ScheduledToday,
            AgendaDateKind::Planned,
        ),
    ] {
        let task = snapshot
            .tasks
            .iter()
            .find(|task| task.title == title)
            .ok_or(RuntimeError::NotFound)?;
        assert_eq!(task.effective_date.as_deref(), Some(day), "{title}");
        assert_eq!(task.agenda_section, Some(section), "{title}");
        assert_eq!(task.agenda_date_kind, Some(kind), "{title}");
        let group = snapshot
            .groups
            .iter()
            .find(|group| group.task_ids.contains(&task.id))
            .ok_or(RuntimeError::NotFound)?;
        assert_eq!(
            group.key,
            match section {
                AgendaSection::Overdue => "overdue",
                AgendaSection::ScheduledToday => "scheduled-today",
                AgendaSection::DueToday => "due-today",
            }
        );
    }
    assert_eq!(snapshot.version, before.version);
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        0
    );
    let legacy = engine.snapshot("a", &query("today"))?;
    assert_eq!(legacy.total_count, 3);
    for task in legacy.tasks {
        let encoded = serde_json::to_value(task)?;
        assert!(encoded.get("agendaSection").is_none());
        assert!(encoded.get("agendaDateKind").is_none());
    }
    Ok(())
}

#[test]
fn ios_agenda_upcoming_includes_distant_tasks_and_uses_future_reason_before_pagination()
-> Result<()> {
    let (engine, _) = setup(&[
        ("Far deadline", json!({"due":"2028-03-01"})),
        ("Far plan", json!({"scheduled":"2028-04-01"})),
        (
            "Past deadline future plan",
            json!({"due":"2026-10-20","scheduled":"2026-11-08"}),
        ),
        (
            "Past plan future deadline",
            json!({"scheduled":"2026-10-20","due":"2026-11-08"}),
        ),
        (
            "Both future",
            json!({"scheduled":"2026-11-08","due":"2026-11-09"}),
        ),
        ("Tomorrow", json!({"due":"2026-10-26"})),
    ])?;
    let legacy = engine.snapshot("a", &query("upcoming"))?;
    assert_eq!(titles(&legacy), ["Tomorrow"]);
    let all = engine.snapshot("a", &query("upcomingAgenda"))?;
    assert_eq!(all.total_count, 6);
    let mut selected = query("upcomingAgenda");
    selected.effective_day = Some("2026-11-08".into());
    selected.sort_field = Some("title".into());
    selected.limit = Some(1);
    selected.offset = 1;
    let page = engine.snapshot("a", &selected)?;
    assert_eq!(page.total_count, 3);
    assert_eq!(titles(&page), ["Past deadline future plan"]);
    assert_eq!(page.tasks[0].effective_date.as_deref(), Some("2026-11-08"));
    assert_eq!(
        page.tasks[0].agenda_date_kind,
        Some(AgendaDateKind::Planned)
    );
    assert_eq!(page.tasks[0].agenda_section, None);
    let deadline = all
        .tasks
        .iter()
        .find(|task| task.title == "Past plan future deadline")
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(deadline.effective_date.as_deref(), Some("2026-11-08"));
    assert_eq!(deadline.agenda_date_kind, Some(AgendaDateKind::Deadline));
    Ok(())
}

#[test]
fn ios_agenda_today_recurring_overdue_keeps_its_completion_identity() -> Result<()> {
    let (engine, _) = setup(&[
        (
            "Scheduled series",
            json!({"recurrence":"DTSTART:20261020;FREQ=DAILY","scheduled":"2026-10-20","recurrenceAnchor":"scheduled"}),
        ),
        (
            "Completion series",
            json!({"recurrence":"DTSTART:20261020;FREQ=DAILY","scheduled":"2026-10-20","recurrenceAnchor":"completion"}),
        ),
        (
            "Processed series",
            json!({"recurrence":"DTSTART:20261020;FREQ=DAILY","scheduled":"2026-10-20","completeInstances":["2026-10-20"],"recurrenceAnchor":"scheduled"}),
        ),
        (
            "Skipped series",
            json!({"recurrence":"DTSTART:20261020;FREQ=DAILY","scheduled":"2026-10-20","skippedInstances":["2026-10-20"],"recurrenceAnchor":"scheduled"}),
        ),
    ])?;
    let today = engine.snapshot("a", &query("todayAgenda"))?;
    assert_eq!(today.total_count, 2);
    for task in today.tasks {
        assert_eq!(task.effective_date.as_deref(), Some("2026-10-20"));
        assert_eq!(task.agenda_section, Some(AgendaSection::Overdue));
        assert_eq!(
            task.occurrence_date.as_deref(),
            Some(if task.title == "Scheduled series" {
                "2026-10-20"
            } else {
                TODAY
            })
        );
    }
    let upcoming = engine.snapshot("a", &query("upcomingAgenda"))?;
    assert_eq!(upcoming.total_count, 2);
    assert!(
        upcoming
            .tasks
            .iter()
            .all(|task| task.title.ends_with("series")
                && task.effective_date.as_deref() == Some("2026-10-26"))
    );
    Ok(())
}

#[test]
fn ios_agenda_recurrence_preview_has_a_finite_year_and_respects_processed_days() -> Result<()> {
    let (engine, _) = setup(&[
        (
            "Future annual",
            json!({"recurrence":"DTSTART:20261220;FREQ=YEARLY","dateCreated":"2026-01-01T00:00:00Z"}),
        ),
        (
            "Distant current",
            json!({"recurrence":"DTSTART:20281220;FREQ=YEARLY","scheduled":"2028-12-20"}),
        ),
        (
            "Next eligible",
            json!({"recurrence":"DTSTART:20261020;FREQ=DAILY","scheduled":"2026-10-20","completeInstances":["2026-10-20","2026-10-26"],"skippedInstances":["2026-10-27"]}),
        ),
    ])?;
    let upcoming = engine.snapshot("a", &query("upcomingAgenda"))?;
    assert_eq!(upcoming.total_count, 3);
    for (title, day) in [
        ("Future annual", "2026-12-20"),
        ("Distant current", "2028-12-20"),
        ("Next eligible", "2026-10-28"),
    ] {
        let task = upcoming
            .tasks
            .iter()
            .find(|task| task.title == title)
            .ok_or(RuntimeError::NotFound)?;
        assert_eq!(task.effective_date.as_deref(), Some(day));
        assert_eq!(task.occurrence_date.as_deref(), Some(day));
    }
    let mut short = query("upcomingAgenda");
    short.upcoming_days = Some(7);
    assert_eq!(engine.snapshot("a", &short)?.total_count, 2);
    Ok(())
}

#[test]
fn ios_agenda_materialized_child_owns_the_row_and_group_membership() -> Result<()> {
    let (engine, files) = setup(&[(
        "Series",
        json!({"recurrence":"DTSTART:20261024;FREQ=DAILY","scheduled":"2026-10-24","recurrenceAnchor":"scheduled"}),
    )])?;
    seed(
        &files,
        "Child",
        json!({"recurrenceParent":"[[Tasks/Series]]","occurrenceDate":"2026-10-24","scheduled":"2026-10-24"}),
    )?;
    engine.refresh("a")?;
    let mut request = query("todayAgenda");
    request.group_by = Some("agendaSection".into());
    let snapshot = engine.snapshot("a", &request)?;
    assert_eq!(titles(&snapshot), ["Child"]);
    assert_eq!(
        snapshot.tasks[0].occurrence_date.as_deref(),
        Some("2026-10-24")
    );
    assert_eq!(snapshot.groups[0].key, "overdue");
    assert_eq!(snapshot.groups[0].task_ids, ["Tasks/Child.md"]);
    Ok(())
}

#[test]
fn ios_agenda_metadata_search_and_projectless_inbox_use_existing_global_filters() -> Result<()> {
    let (engine, _) = setup(&[
        (
            "Project match",
            json!({"projects":["[[Needle project]]"],"due":"2026-11-25"}),
        ),
        (
            "Context match",
            json!({"contexts":["needle context"],"scheduled":TODAY}),
        ),
        (
            "Tag match",
            json!({"tags":["task","Needle tag"],"due":"2026-11-01"}),
        ),
        ("Done match", json!({"status":"done","projects":["needle"]})),
        ("Unrelated", json!({})),
    ])?;
    let global = Query {
        scope: Some("all".into()),
        text: Some(" NEEDLE ".into()),
        ..Query::default()
    };
    assert_eq!(engine.snapshot("a", &global)?.total_count, 4);
    let inbox = Query {
        scope: Some("all".into()),
        completed: Some(false),
        has_no_project: Some(true),
        ..Query::default()
    };
    assert_eq!(engine.snapshot("a", &inbox)?.total_count, 3);
    let legacy = engine.snapshot("a", &query("inbox"))?;
    assert_eq!(titles(&legacy), ["Unrelated"]);
    Ok(())
}

#[test]
fn ios_agenda_date_sorts_use_their_own_property_and_keep_missing_values_last() -> Result<()> {
    let (engine, _) = setup(&[
        (
            "Z early",
            json!({"scheduled":"2026-10-26","due":"2026-12-01","dateCreated":"2026-10-25T01:00:00+02:00","completedDate":"2026-10-28"}),
        ),
        (
            "A late",
            json!({"scheduled":"2026-10-27","due":"2026-10-01","dateCreated":"2026-10-25T00:00:00Z","completedDate":"2026-10-27"}),
        ),
        ("Missing", json!({})),
    ])?;
    for field in ["scheduledDate", "createdDate", "completedDate"] {
        let ascending = Query {
            sort_field: Some(field.into()),
            sort_direction: Some("asc".into()),
            ..Query::default()
        };
        let expected = if field == "completedDate" {
            ["A late", "Z early", "Missing"]
        } else {
            ["Z early", "A late", "Missing"]
        };
        assert_eq!(
            titles(&engine.snapshot("a", &ascending)?),
            expected,
            "{field}"
        );
        let descending = Query {
            sort_direction: Some("desc".into()),
            ..ascending
        };
        assert_eq!(
            titles(&engine.snapshot("a", &descending)?),
            [expected[1], expected[0], expected[2]],
            "{field}"
        );
    }
    Ok(())
}

#[test]
fn ios_agenda_sections_order_before_pagination_even_with_title_sort() -> Result<()> {
    let (engine, _) = setup(&[
        ("A deadline", json!({"due":TODAY})),
        ("B plan", json!({"scheduled":TODAY})),
        ("Z overdue", json!({"due":"2026-10-24"})),
    ])?;
    let mut request = query("todayAgenda");
    request.group_by = Some("agendaSection".into());
    request.sort_field = Some("title".into());
    request.limit = Some(1);
    for (offset, title) in [(0, "Z overdue"), (1, "B plan"), (2, "A deadline")] {
        request.offset = offset;
        let page = engine.snapshot("a", &request)?;
        assert_eq!(page.total_count, 3);
        assert_eq!(titles(&page), [title]);
    }
    Ok(())
}

#[test]
fn ios_agenda_default_order_keeps_planned_work_before_deadlines_and_titles_before_paths()
-> Result<()> {
    let (engine, _) = setup(&[
        ("A deadline", json!({"due":"2026-10-26","priority":"high"})),
        ("Z plan", json!({"scheduled":"2026-10-26","priority":"low"})),
        (
            "B plan",
            json!({"scheduled":"2026-10-26","priority":"normal"}),
        ),
        ("Z today", json!({"scheduled":TODAY,"priority":"high"})),
        ("A today", json!({"scheduled":TODAY,"priority":"low"})),
    ])?;
    assert_eq!(
        titles(&engine.snapshot("a", &query("upcomingAgenda"))?),
        ["B plan", "Z plan", "A deadline"]
    );
    assert_eq!(
        titles(&engine.snapshot("a", &query("todayAgenda"))?),
        ["A today", "Z today"]
    );
    let explicit = Query {
        sort_field: Some("title".into()),
        ..query("upcomingAgenda")
    };
    assert_eq!(
        titles(&engine.snapshot("a", &explicit)?),
        ["A deadline", "B plan", "Z plan"]
    );
    Ok(())
}

#[test]
fn ios_agenda_invalid_dates_and_unknown_contract_values_fail_without_writes() -> Result<()> {
    let (engine, files) = setup(&[])?;
    for value in [
        json!({"scope":"todayAgenda"}),
        json!({"scope":"upcomingAgenda","today":"2026-02-30"}),
        json!({"scope":"all","effectiveDay":"2026-02-30"}),
        json!({"scope":"all","effectiveDay":"2026-1-01"}),
        json!({"scope":"all","groupBy":"agendaSection"}),
        json!({"scope":"unknownAgenda","today":TODAY}),
        json!({"scope":"all","sortField":"trackedMinutes"}),
    ] {
        let request: Query = serde_json::from_value(value.clone())?;
        assert!(
            matches!(
                engine.snapshot("a", &request),
                Err(RuntimeError::Validation(_))
            ),
            "{value}"
        );
    }
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        0
    );
    Ok(())
}
