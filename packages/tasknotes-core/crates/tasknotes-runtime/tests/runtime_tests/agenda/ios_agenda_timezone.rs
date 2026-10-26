//! Ordinary collections opt into the same explicit viewer civil-date contract.

use super::*;

fn viewer(scope: &str, today: &str, timezone: &str) -> Query {
    Query {
        scope: Some(scope.into()),
        today: Some(today.into()),
        timezone: Some(timezone.into()),
        ..Query::default()
    }
}

#[test]
fn all_inbox_and_global_search_publish_the_same_local_day_as_agenda() -> Result<()> {
    let instant = "2026-10-27T06:30:00Z";
    let (engine, files) = setup(&[("Midnight witness", json!({"due":instant}))])?;
    for mut request in [
        viewer("all", "2026-10-26", "America/Los_Angeles"),
        Query {
            has_no_project: Some(true),
            completed: Some(false),
            ..viewer("all", "2026-10-26", "America/Los_Angeles")
        },
        Query {
            text: Some("midnight".into()),
            ..viewer("all", "2026-10-26", "America/Los_Angeles")
        },
        viewer("todayAgenda", "2026-10-26", "America/Los_Angeles"),
    ] {
        let snapshot = engine.snapshot("a", &request)?;
        assert_eq!(titles(&snapshot), ["Midnight witness"]);
        assert_eq!(
            snapshot.tasks[0].effective_date.as_deref(),
            Some("2026-10-26")
        );
        assert_eq!(snapshot.tasks[0].properties["due"], instant);
        request.scope = Some("all".into());
        request.timezone = None;
        assert_eq!(
            engine.snapshot("a", &request)?.tasks[0]
                .effective_date
                .as_deref(),
            Some("2026-10-27")
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

#[test]
fn ordinary_date_scopes_and_due_bounds_use_local_due_and_planned_days() -> Result<()> {
    for (zone, instant) in [
        ("America/Los_Angeles", "2026-10-27T06:30:00Z"),
        ("Asia/Tokyo", "2026-10-25T16:30:00Z"),
    ] {
        let (engine, _) = setup(&[
            ("Due", json!({"due":instant})),
            ("Planned", json!({"scheduled":instant})),
        ])?;
        for scope in ["today", "agenda"] {
            let request = viewer(scope, "2026-10-26", zone);
            assert_eq!(
                engine.snapshot("a", &request)?.total_count,
                2,
                "{zone}: {scope}"
            );
        }
        for scope in ["upcoming", "overdue"] {
            assert_eq!(
                engine
                    .snapshot("a", &viewer(scope, "2026-10-26", zone))?
                    .total_count,
                0,
                "{zone}: {scope}"
            );
        }
        assert_eq!(
            engine
                .snapshot("a", &viewer("upcoming", "2026-10-25", zone))?
                .total_count,
            2
        );
        assert_eq!(
            engine
                .snapshot("a", &viewer("overdue", "2026-10-27", zone))?
                .total_count,
            2
        );
        let bounded = Query {
            due_after: Some("2026-10-25".into()),
            due_before: Some("2026-10-27".into()),
            ..viewer("all", "2026-10-26", zone)
        };
        assert_eq!(titles(&engine.snapshot("a", &bounded)?), ["Due"]);
        let exclusive = Query {
            due_before: Some("2026-10-26".into()),
            ..viewer("all", "2026-10-26", zone)
        };
        assert_eq!(engine.snapshot("a", &exclusive)?.total_count, 0);
        let absent = Query {
            has_no_due_date: Some(true),
            ..viewer("all", "2026-10-26", zone)
        };
        assert_eq!(titles(&engine.snapshot("a", &absent)?), ["Planned"]);
    }
    Ok(())
}

#[test]
fn local_effective_day_order_groups_and_pagination_agree() -> Result<()> {
    let (engine, _) = setup(&[
        ("A timed", json!({"due":"2026-10-27T06:30:00Z"})),
        ("B literal", json!({"scheduled":"2026-10-26"})),
        ("C next local day", json!({"due":"2026-10-27T08:30:00Z"})),
    ])?;
    let mut request = viewer("all", "2026-10-26", "America/Los_Angeles");
    request.group_by = Some("effectiveDate".into());
    request.effective_day = Some("2026-10-26".into());
    request.limit = Some(1);
    request.offset = 1;
    let page = engine.snapshot("a", &request)?;
    assert_eq!(page.total_count, 2);
    assert_eq!(titles(&page), ["B literal"]);
    assert_eq!(page.groups[0].key, "2026-10-26");
    request.effective_day = None;
    request.offset = 0;
    request.limit = Some(3);
    let all = engine.snapshot("a", &request)?;
    assert_eq!(titles(&all), ["A timed", "B literal", "C next local day"]);
    assert_eq!(
        all.groups
            .iter()
            .map(|group| group.key.as_str())
            .collect::<Vec<_>>(),
        ["2026-10-26", "2026-10-27"]
    );
    assert_eq!(all.groups[0].task_ids.len(), 2);
    Ok(())
}

#[test]
fn supplied_zone_is_validated_for_every_scope_even_on_empty_or_literal_indexes() -> Result<()> {
    for notes in [vec![], vec![("Literal", json!({"due":"2026-10-26"}))]] {
        let (engine, _) = setup(&notes)?;
        for scope in [
            "all",
            "today",
            "agenda",
            "upcoming",
            "overdue",
            "completed",
            "inbox",
        ] {
            for zone in ["", " ", "Mars/Olympus", "+09:00"] {
                assert!(
                    matches!(
                        engine.snapshot("a", &viewer(scope, "2026-10-26", zone)),
                        Err(RuntimeError::Validation(_))
                    ),
                    "{scope}: {zone}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn missing_and_null_zone_retain_original_written_day_contracts() -> Result<()> {
    let (engine, _) = setup(&[("UTC tomorrow", json!({"due":"2026-10-27T06:30:00Z"}))])?;
    for (scope, total) in [
        ("all", 1),
        ("today", 0),
        ("agenda", 0),
        ("upcoming", 1),
        ("overdue", 0),
    ] {
        let absent: Query = serde_json::from_value(json!({"scope":scope,"today":"2026-10-26"}))?;
        let null: Query =
            serde_json::from_value(json!({"scope":scope,"today":"2026-10-26","timezone":null}))?;
        let baseline = engine.snapshot("a", &absent)?;
        assert_eq!(baseline.total_count, total, "{scope}");
        if let Some(task) = baseline.tasks.first() {
            assert_eq!(task.effective_date.as_deref(), Some("2026-10-27"));
        }
        assert_eq!(
            serde_json::to_value(baseline)?,
            serde_json::to_value(engine.snapshot("a", &null)?)?
        );
    }
    Ok(())
}

#[test]
fn ordinary_viewer_dates_observe_dst_offsets_and_preserve_literal_days() -> Result<()> {
    for (instant, expected) in [
        ("2026-03-08T07:30:00Z", "2026-03-07"),
        ("2026-03-08T09:30:00Z", "2026-03-08"),
        ("2026-03-08T10:30:00Z", "2026-03-08"),
        ("2026-11-01T06:30:00Z", "2026-10-31"),
        ("2026-11-01T08:30:00Z", "2026-11-01"),
        ("2026-11-01T09:30:00Z", "2026-11-01"),
        ("2026-11-01", "2026-11-01"),
    ] {
        let (engine, _) = setup(&[("Witness", json!({"due":instant}))])?;
        let request = viewer("today", expected, "America/Los_Angeles");
        let snapshot = engine.snapshot("a", &request)?;
        assert_eq!(snapshot.total_count, 1, "{instant}");
        assert_eq!(snapshot.tasks[0].effective_date.as_deref(), Some(expected));
    }
    Ok(())
}

#[test]
fn ordinary_virtual_recurrences_keep_literal_days_and_processed_keys() -> Result<()> {
    let (engine, _) = setup(&[(
        "Series",
        json!({"recurrence":"DTSTART:20261026;FREQ=DAILY","scheduled":"2026-10-26T01:30:00Z","completeInstances":["2026-10-27"]}),
    )])?;
    let mut request = viewer("all", "2026-10-26", "America/Los_Angeles");
    request.today = None;
    let current = engine.snapshot("a", &request)?;
    assert_eq!(
        current.tasks[0].effective_date.as_deref(),
        Some("2026-10-25")
    );
    assert_eq!(current.tasks[0].occurrence_date, None);
    request.today = Some("2026-10-26".into());
    request.scope = Some("upcoming".into());
    let future = engine.snapshot("a", &request)?;
    assert_eq!(
        future.tasks[0].effective_date.as_deref(),
        Some("2026-10-27")
    );
    assert_eq!(
        future.tasks[0].occurrence_date.as_deref(),
        Some("2026-10-27")
    );
    assert!(future.tasks[0].completed);
    assert_eq!(
        future.tasks[0].properties["scheduled"],
        "2026-10-26T01:30:00Z"
    );
    Ok(())
}

#[test]
fn ordinary_timed_child_display_does_not_shift_canonical_parent_ownership() -> Result<()> {
    let (engine, files) = setup(&[(
        "Series",
        json!({"recurrence":"DTSTART:20261027;FREQ=DAILY","scheduled":"2026-10-27T06:30:00Z"}),
    )])?;
    seed(
        &files,
        "Child",
        json!({"recurrenceParent":"[[Tasks/Series]]","occurrenceDate":"2026-10-27","scheduled":"2026-10-27T06:30:00Z"}),
    )?;
    engine.refresh("a")?;
    let today = engine.snapshot("a", &viewer("today", "2026-10-26", "America/Los_Angeles"))?;
    assert_eq!(titles(&today), ["Child"]);
    assert_eq!(today.tasks[0].effective_date.as_deref(), Some("2026-10-26"));
    assert_eq!(
        today.tasks[0].occurrence_date.as_deref(),
        Some("2026-10-27")
    );
    let upcoming = engine.snapshot(
        "a",
        &viewer("upcoming", "2026-10-25", "America/Los_Angeles"),
    )?;
    assert_eq!(titles(&upcoming), ["Child", "Series"]);
    assert_eq!(
        upcoming.tasks[1].occurrence_date.as_deref(),
        Some("2026-10-28")
    );
    assert_eq!(
        upcoming.tasks[1].effective_date.as_deref(),
        Some("2026-10-28")
    );
    Ok(())
}
