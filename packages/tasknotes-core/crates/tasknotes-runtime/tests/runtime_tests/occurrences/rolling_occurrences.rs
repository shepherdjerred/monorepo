//! Finite rolling mutation and cached query/reminder ownership contracts.
#[path = "automatic_occurrence_windows.rs"]
mod automatic_occurrence_windows;
use super::{
    Command, ContentRevision, DAY, Fixture, PARENT, Query, Result, RuntimeError, TaskDocument,
    VaultPath, json, mutation,
};
use serde_json::Value;

fn maintenance(reference: &str, limit: u32, after: Value, version: Value) -> Value {
    Value::Object(serde_json::Map::from_iter([
        ("schemaVersion".into(), json!(1)),
        ("kind".into(), json!("rolling_maintenance_plan")),
        ("referenceDate".into(), json!(reference)),
        ("limit".into(), json!(limit)),
        ("after".into(), after),
        ("expectedVersion".into(), version),
    ]))
}

#[test]
fn rolling_maintenance_cached_pages_include_exclusions_problems_and_exact_policy_without_io()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("rolling", "scheduled", "completion")?;
    parent_fields(
        &f,
        json!({"occurrencePastHorizon":"P1D","occurrenceFutureHorizon":"P2D"}),
    )?;
    let parent = f.bytes(PARENT)?;
    f.files.seed(
        "a",
        "A/Manual.md",
        String::from_utf8(parent.clone())?
            .replace(
                "occurrence_materialization: rolling",
                "occurrence_materialization: manual",
            )
            .as_bytes(),
    )?;
    f.files.seed(
        "a",
        "B/Ordinary.md",
        b"---\ntitle: Ordinary\ntags: [task]\nstatus: open\npriority: normal\n---\nOpaque\n",
    )?;
    f.files.seed(
        "a",
        "C/Invalid.md",
        String::from_utf8(parent.clone())?
            .replace("DTSTART:20261001;FREQ=DAILY", "FREQ=NONSENSE")
            .as_bytes(),
    )?;
    f.engine.refresh("a")?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let child_bytes = f.bytes(&child)?;
    let provider = std::sync::Arc::new(NoProvider::default());
    let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
    let database = std::fs::read(&f.database)?;
    let mut cursor = Value::Null;
    let mut version = Value::Null;
    let mut pages = Vec::new();
    for _ in 0..8 {
        let request = maintenance(DAY, 1, cursor, version);
        let page: Value = serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
        println!(
            "ROLLING_MAINTENANCE_REQUEST_SCHEMA {}",
            serde_json::to_string(&request)?
        );
        assert_eq!(page["inspectedCount"], 1);
        assert_eq!(page["referenceDate"], DAY);
        cursor = page["nextCursor"].clone();
        version = page["version"].clone();
        pages.push(page);
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(pages.len(), 5);
    assert_eq!(pages[0]["targets"], json!([]));
    assert_eq!(pages[0]["problems"], json!([]));
    assert_eq!(pages[1]["targets"], json!([]));
    assert_eq!(pages[1]["problems"], json!([]));
    assert_eq!(
        pages[2]["problems"],
        json!([{"taskPath":"C/Invalid.md","code":"invalid_recurrence_rule"}])
    );
    assert_eq!(
        pages[3]["targets"],
        json!([{"parentPath":PARENT,"expectedParentRevision":ContentRevision::of(&parent).as_str(),"referenceDate":DAY,"start":"2026-10-03","end":"2026-10-06"}])
    );
    assert_eq!(pages[4]["targets"], json!([]));
    assert!(pages[4]["nextCursor"].is_null());
    for page in &pages {
        println!(
            "ROLLING_MAINTENANCE_SCHEMA {}",
            serde_json::to_string(page)?
        );
    }
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(std::fs::read(&f.database)?, database);
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.bytes(&child)?, child_bytes);
    Ok(())
}

#[test]
fn rolling_maintenance_cursor_binds_profile_day_path_and_task_configuration_version() -> Result {
    for configuration_change in [false, true] {
        let f = Fixture::new()?;
        f.series("rolling", "scheduled", "completion")?;
        let first = f.feature(&maintenance(DAY, 1, Value::Null, Value::Null))?;
        let cursor = first["nextCursor"].clone();
        assert!(!cursor.is_null());
        let valid = maintenance(DAY, 1, cursor.clone(), first["version"].clone());
        let result = f.feature(&valid)?;
        assert_eq!(result, f.feature(&valid)?);
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        for (key, value) in [
            ("lastPath", json!("Tasks/P 2026-10-04.md")),
            ("referenceDate", json!("2026-10-05")),
            ("binding", json!("a".repeat(64))),
            ("unknown", json!(true)),
        ] {
            let mut bad = valid.clone();
            bad["after"][key] = value;
            assert!(f.feature(&bad).is_err(), "{key}");
        }
        let mut changed_day = valid.clone();
        changed_day["referenceDate"] = json!("2026-10-05");
        assert!(f.feature(&changed_day).is_err());
        let mut missing_version = valid.clone();
        missing_version["expectedVersion"] = Value::Null;
        assert!(f.feature(&missing_version).is_err());
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
        if configuration_change {
            f.files.seed(
                "a",
                "tasknotes.yaml",
                b"occurrences:\n  future_horizon: P1D\n",
            )?;
            f.engine.refresh("a")?;
        } else {
            f.engine.execute(
                "a",
                &mutation(
                    "new-parent-revision",
                    Command::Update {
                        path: PARENT.into(),
                        expected_revision: None,
                        properties: serde_json::from_value(json!({"priority":"high"}))?,
                        body: None,
                    },
                ),
            )?;
        }
        assert!(matches!(
            f.engine.features_json("a", &valid.to_string()),
            Err(RuntimeError::Conflict)
        ));
        let next = f.feature(&maintenance(DAY, 1, Value::Null, Value::Null))?;
        assert!(next["version"].as_u64() > first["version"].as_u64());
    }
    Ok(())
}

#[test]
fn rolling_maintenance_cross_profile_cursors_and_large_excluded_pages_are_bounded() -> Result {
    let f = Fixture::new()?;
    f.series("rolling", "scheduled", "completion")?;
    let first = f.feature(&maintenance(DAY, 1, Value::Null, Value::Null))?;
    let mut second = super::profile(super::ProfileKind::ObsidianSync);
    second.id = "b".into();
    f.engine.register_profile(second)?;
    let plugin = tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH;
    f.files.seed(
        "b",
        plugin,
        &f.files.get("a", plugin)?.ok_or("configuration")?,
    )?;
    f.files.seed("b", PARENT, &f.bytes(PARENT)?)?;
    let target_version = first["version"].as_u64().ok_or("version")?;
    for _ in 0..target_version {
        f.engine.refresh("b")?;
    }
    let other: Value = serde_json::from_str(&f.engine.features_json(
        "b",
        &maintenance(DAY, 1, Value::Null, Value::Null).to_string(),
    )?)?;
    assert_eq!(other["version"], first["version"]);
    assert!(
        matches!(f.engine.features_json("b",&maintenance(DAY,1,first["nextCursor"].clone(),first["version"].clone()).to_string()),Err(RuntimeError::Validation(message)) if message=="invalid_rolling_maintenance_cursor")
    );
    let f = Fixture::new()?;
    for index in 0..300 {
        f.files.seed(
            "a",
            &format!("A/{index:03}.md"),
            b"---\ntitle: Ordinary\ntags: [task]\nstatus: open\npriority: normal\n---\n",
        )?;
    }
    f.engine.refresh("a")?;
    let counts = f.counts()?;
    let provider = std::sync::Arc::new(NoProvider::default());
    let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
    let first: Value = serde_json::from_str(&engine.features_json(
        "a",
        &maintenance(DAY, 256, Value::Null, Value::Null).to_string(),
    )?)?;
    assert_eq!(first["inspectedCount"], 256);
    assert_eq!(first["targets"], json!([]));
    assert_eq!(first["nextCursor"]["lastPath"], "A/255.md");
    let last: Value = serde_json::from_str(
        &engine.features_json(
            "a",
            &maintenance(
                DAY,
                256,
                first["nextCursor"].clone(),
                first["version"].clone(),
            )
            .to_string(),
        )?,
    )?;
    assert_eq!(last["inspectedCount"], 45);
    assert!(last["nextCursor"].is_null());
    assert_eq!(last["targets"], json!([]));
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(f.counts()?, counts);
    Ok(())
}

#[test]
fn rolling_maintenance_closes_requests_and_never_expands_a_discovery_candidate() -> Result {
    let f = Fixture::new()?;
    f.series("rolling", "scheduled", "completion")?;
    let list = vec!["0"; 101].join(",");
    parent_fields(
        &f,
        json!({"recurrence":format!("DTSTART:20261004;FREQ=DAILY;COUNT=1;BYHOUR={list};BYMINUTE={list};BYSECOND={list}")}),
    )?;
    f.engine.refresh("a")?;
    let page = f.feature(&maintenance(DAY, 256, Value::Null, Value::Null))?;
    assert_eq!(page["targets"].as_array().ok_or("targets")?.len(), 1);
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    for malformed in [
        json!({"kind":"rolling_maintenance_plan"}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":"2026-02-30"}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":"2026-10-04T00:00:00Z"}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":DAY,"limit":0}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":DAY,"limit":257}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":DAY,"limit":1.5}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":DAY,"extra":true}),
        json!({"kind":"rolling_maintenance_plan","referenceDate":DAY,"after":{}}),
    ] {
        assert!(f.feature(&malformed).is_err());
    }
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}

#[test]
fn rolling_production_today_upcoming_and_plain_completion_bound_recurrence_before_effects() -> Result
{
    let f = Fixture::new()?;
    let list = vec!["0"; 101].join(",");
    parent_fields(
        &f,
        json!({"scheduled":DAY,"recurrence":format!("DTSTART:20261004;FREQ=DAILY;COUNT=1;BYHOUR={list};BYMINUTE={list};BYSECOND={list}")}),
    )?;
    f.engine.refresh("a")?;
    let provider = std::sync::Arc::new(NoProvider::default());
    let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let bytes = f.bytes(PARENT)?;
    for scope in ["today", "upcoming"] {
        assert!(
            matches!(engine.snapshot("a",&Query{scope:Some(scope.into()),today:Some(DAY.into()),..Query::default()}),Err(RuntimeError::Validation(message)) if message=="occurrence_expansion_resource_limit")
        );
    }
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    for route in 0..4 {
        assert!(
            matches!(f.engine.execute("a",&f.finish(&format!("bounded-parent-{route}"),PARENT,route)?),Err(RuntimeError::Validation(message)) if message=="occurrence_expansion_resource_limit")
        );
    }
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(PARENT)?, bytes);
    Ok(())
}

#[test]
fn rolling_cartesian_preparation_rejects_count_one_before_any_durable_effect() -> Result {
    for (frequency, repeats, hours) in [("DAILY", 101, true), ("HOURLY", 1001, false)] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            "tasknotes.yaml",
            b"occurrences:\n  future_horizon: P0D\n",
        )?;
        let existing = f.series("rolling", "scheduled", "completion")?;
        let list = vec!["0"; repeats].join(",");
        let hours = if hours {
            format!(";BYHOUR={list}")
        } else {
            String::new()
        };
        parent_fields(
            &f,
            json!({"recurrence":format!("DTSTART:20261004;FREQ={frequency};COUNT=1{hours};BYMINUTE={list};BYSECOND={list}")}),
        )?;
        f.engine.refresh("a")?;
        let parent = f.bytes(PARENT)?;
        let child = f.bytes(&existing)?;
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        let stages = f
            .files
            .state
            .lock()
            .map_err(|_| "provider lock")?
            .stage_begin_paths
            .clone();
        let req = request(&f, "cartesian-budget")?;
        for _ in 0..2 {
            assert!(
                matches!(f.engine.execute("a", &req), Err(RuntimeError::Validation(message)) if message == "occurrence_expansion_resource_limit")
            );
        }
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
        assert_eq!(
            f.files
                .state
                .lock()
                .map_err(|_| "provider lock")?
                .stage_begin_paths,
            stages
        );
        assert_eq!(f.bytes(PARENT)?, parent);
        assert_eq!(f.bytes(&existing)?, child);
        let db = rusqlite::Connection::open(&f.database)?;
        assert_eq!(
            db.query_row("SELECT count(*) FROM occurrence_windows", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        drop(db);
        let f = f.reopen()?;
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.bytes(PARENT)?, parent);
        assert_eq!(f.bytes(&existing)?, child);
    }
    Ok(())
}

pub(super) fn parent_fields(f: &Fixture, fields: Value) -> Result {
    let config = tasknotes_vault::config::TaskNotesConfiguration::resolve(
        f.files
            .get("a", tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH)?
            .as_deref(),
        f.files
            .get("a", tasknotes_vault::config::PORTABLE_CONFIGURATION_PATH)?
            .as_deref(),
        true,
    )?;
    let Value::Object(fields) = fields else {
        return Err("parent fields".into());
    };
    let edits = fields
        .into_iter()
        .map(
            |(key, value)| tasknotes_vault::document::PropertyEdit::Set {
                key: tasknotes_vault::mapping::canonical_role(&key)
                    .map_or_else(|| key.clone(), |role| config.mapping.field(role).to_owned()),
                value,
            },
        )
        .collect::<Vec<_>>();
    let parent = TaskDocument::parse(VaultPath::parse(PARENT)?, &f.bytes(PARENT)?)?;
    f.files
        .seed("a", PARENT, &parent.plan(&edits, None)?.bytes)?;
    Ok(())
}

fn request(f: &Fixture, id: &str) -> Result<tasknotes_runtime::types::Mutation> {
    Ok(mutation(
        id,
        Command::MaterializeOccurrenceWindow {
            parent_path: PARENT.into(),
            expected_parent_revision: ContentRevision::of(&f.bytes(PARENT)?).as_str().into(),
            reference_date: DAY.into(),
            origin: None,
        },
    ))
}

#[test]
fn rolling_complete_window_reuses_owned_children_replays_and_undoes_only_new_notes() -> Result {
    let f = Fixture::new()?;
    f.files.seed("a","tasknotes.yaml",b"occurrences:\n  default_materialization: rolling\n  past_horizon: P1D\n  future_horizon: P2D\n")?;
    let existing = f.series("rolling", "scheduled", "completion")?;
    let existing_bytes = f.bytes(&existing)?;
    let parent = f.bytes(PARENT)?;
    let before = f.counts()?.1;
    let req = request(&f, "rolling-window")?;
    let receipt = f.engine.execute("a", &req)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths.len(), 3);
    assert_eq!(f.counts()?.1, before + 3);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.bytes(&existing)?, existing_bytes);
    let exchanges = f.exchanges()?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &req)?)?,
        serde_json::to_value(&receipt)?
    );
    let reuse = f.engine.execute("a", &request(&f, "rolling-reuse")?)?;
    assert_eq!(reuse.paths, Vec::<String>::new());
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(
        f.feature(&json!({"kind":"undo_available"}))?["receiptId"],
        "rolling-window"
    );
    f.engine.execute(
        "a",
        &mutation(
            "undo-rolling",
            Command::Undo {
                receipt_id: "rolling-window".into(),
            },
        ),
    )?;
    for path in receipt.paths {
        assert!(f.files.get("a", &path)?.is_none());
    }
    assert_eq!(f.bytes(&existing)?, existing_bytes);
    assert_eq!(f.bytes(PARENT)?, parent);
    Ok(())
}

#[test]
fn rolling_count_until_and_subdaily_candidates_keep_exact_canonical_day_identities() -> Result {
    for (rule, expected) in [
        (
            "DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=3",
            vec!["2026-10-05"],
        ),
        (
            "DTSTART:20261001;FREQ=DAILY;UNTIL=20261006",
            vec!["2026-10-05", "2026-10-06"],
        ),
        ("DTSTART:20261004;FREQ=HOURLY;COUNT=48", vec!["2026-10-05"]),
        ("DTSTART:20261001;FREQ=DAILY;COUNT=2", vec![]),
    ] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            "tasknotes.yaml",
            b"occurrences:\n  future_horizon: P2D\n",
        )?;
        let existing = f.series("rolling", "scheduled", "completion")?;
        let parent =
            String::from_utf8(f.bytes(PARENT)?)?.replace("DTSTART:20261001;FREQ=DAILY", rule);
        f.files.seed("a", PARENT, parent.as_bytes())?;
        let before = f.bytes(&existing)?;
        let receipt = f.engine.execute("a", &request(&f, "finite")?)?;
        assert_eq!(receipt.paths.len(), expected.len());
        let dates = receipt
            .paths
            .iter()
            .map(|path| f.values(path).map(|v| v.get("occurrenceDate").cloned()))
            .collect::<Result<Vec<_>>>()?;
        assert_eq!(
            dates,
            expected
                .iter()
                .map(|day| Some(json!(day)))
                .collect::<Vec<_>>()
        );
        assert_eq!(f.bytes(&existing)?, before);
        assert_eq!(f.bytes(PARENT)?, parent.as_bytes());
    }
    Ok(())
}

#[test]
fn rolling_resource_and_policy_rejections_happen_before_publication() -> Result {
    for fields in [
        json!({"occurrence_materialization":"manual"}),
        json!({"occurrence_future_horizon":"P1001D"}),
        json!({"occurrence_future_horizon":"P100001D"}),
        json!({"occurrence_future_horizon":"-P1D"}),
        json!({"occurrence_future_horizon":"Infinity"}),
        json!({"occurrence_future_horizon":17}),
        json!({"occurrence_future_horizon":"P999999999999999999D"}),
        json!({"recurrence":"DTSTART:19000101;FREQ=SECONDLY"}),
    ] {
        let f = Fixture::new()?;
        let child = f.series("rolling", "scheduled", "completion")?;
        parent_fields(&f, fields)?;
        let parent = f.bytes(PARENT)?;
        let before = f.counts()?;
        let exchanges = f.exchanges()?;
        let children = f.files.state.lock().map_err(|_| "lock")?.files.len();
        assert!(matches!(
            f.engine.execute("a", &request(&f, "reject")?),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(f.counts()?, before);
        assert_eq!(f.exchanges()?, exchanges);
        assert_eq!(f.bytes(PARENT)?, parent);
        assert!(f.files.get("a", &child)?.is_some());
        assert_eq!(
            f.files.state.lock().map_err(|_| "lock")?.files.len(),
            children
        );
    }
    Ok(())
}

#[test]
fn rolling_recovery_preserves_captured_template_dates_body_attachments_and_original_clock() -> Result
{
    let f = Fixture::new()?;
    f.files.seed(
        "a",
        "tasknotes.yaml",
        b"occurrences:\n  future_horizon: P2D\n",
    )?;
    let existing = f.series("rolling", "completion", "completion")?;
    f.files
        .seed("a", "Projects/media/a.bin", b"immutable attachment")?;
    parent_fields(
        &f,
        json!({"occurrence_template":"Templates/child.md","attachments":["./media/a.bin"],"due":"2026-10-02"}),
    )?;
    f.files.seed("a","Templates/child.md",b"---\npriority: high\nscheduled: 2026-10-20\ndue: 2026-10-21\nvendorChild: {kept: true}\n---\nOriginal template body\n")?;
    let before = f.bytes(&existing)?;
    let req = request(&f, "captured-rolling")?;
    let crash = f.exchanges()? + 1;
    f.files.state.lock().map_err(|_| "lock")?.crash_at_exchange = Some(crash);
    assert!(matches!(
        f.engine.execute("a", &req),
        Err(RuntimeError::Host(_))
    ));
    f.files.seed(
        "a",
        "Templates/child.md",
        b"---\nscheduled: 2030-01-01\n---\nChanged template\n",
    )?;
    let f = f.reopen()?;
    let receipt = f.engine.execute("a", &req)?;
    assert_eq!(receipt.paths.len(), 2);
    for path in &receipt.paths {
        let values = f.values(path)?;
        assert_eq!(values.get("scheduled"), Some(&json!("2026-10-20")));
        assert_eq!(values.get("due"), Some(&json!("2026-10-21")));
        assert_eq!(values.get("dateCreated"), Some(&json!(req.at)));
        assert_eq!(values.get("vendorChild"), Some(&json!({"kept":true})));
        let document = TaskDocument::parse(VaultPath::parse(path)?, &f.bytes(path)?)?;
        assert_eq!(document.body(), "Original template body\n");
        let raw = values
            .get("attachments")
            .and_then(Value::as_array)
            .and_then(|v| v.first())
            .ok_or("attachment")?;
        assert_eq!(
            tasknotes_vault::links::resolve(
                &json!({"raw":raw,"sourcePath":path,"candidates":["Projects/media/a.bin"]})
            )?,
            "Projects/media/a.bin"
        );
    }
    assert_eq!(f.bytes(&existing)?, before);
    assert_eq!(f.bytes("Projects/media/a.bin")?, b"immutable attachment");
    assert_eq!(f.counts()?.1, 3);
    Ok(())
}

#[test]
fn rolling_reused_child_and_parent_fences_survive_partial_exchange_recovery() -> Result {
    for change_parent in [false, true] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            "tasknotes.yaml",
            b"occurrences:\n  past_horizon: P1D\n  future_horizon: P1D\n",
        )?;
        let child = f.series("rolling", "scheduled", "completion")?;
        let req = request(&f, "fenced-window")?;
        let crash = f.exchanges()? + 1;
        f.files.state.lock().map_err(|_| "lock")?.crash_at_exchange = Some(crash);
        assert!(matches!(
            f.engine.execute("a", &req),
            Err(RuntimeError::Host(_))
        ));
        let path = if change_parent {
            PARENT
        } else {
            child.as_str()
        };
        let foreign = [f.bytes(path)?, b"Foreign retained body\n".to_vec()].concat();
        f.files.seed("a", path, &foreign)?;
        let exchanges = f.exchanges()?;
        let f = f.reopen()?;
        assert!(matches!(
            f.engine.execute("a", &req),
            Err(RuntimeError::Conflict)
        ));
        assert_eq!(f.bytes(path)?, foreign);
        assert_eq!(f.exchanges()?, exchanges);
        assert_eq!(f.counts()?.1, 1);
    }
    Ok(())
}

#[derive(Default)]
pub(super) struct NoProvider(pub(super) std::sync::atomic::AtomicUsize);
impl NoProvider {
    fn reject<T>(&self) -> tasknotes_runtime::Result<T> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err(RuntimeError::Host(
            "provider must not be called by projections".into(),
        ))
    }
}
impl tasknotes_runtime::types::VaultFiles for NoProvider {
    fn list_files(&self, _: &str) -> tasknotes_runtime::Result<Vec<String>> {
        self.reject()
    }
    fn displaced_metadata(
        &self,
        _: &str,
        _: Option<&str>,
        _: u32,
    ) -> tasknotes_runtime::Result<Vec<tasknotes_runtime::types::DisplacedMetadata>> {
        self.reject()
    }
    fn acknowledge_displaced(&self, _: &str, _: &str) -> tasknotes_runtime::Result<()> {
        self.reject()
    }
}

#[test]
fn rolling_cached_queries_filters_totals_groups_and_reminders_use_child_dates_without_provider_io()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    f.engine.execute("a",&mutation("child-override",Command::Update {path:child.clone(),expected_revision:None,properties:serde_json::from_value(json!({"scheduled":"2026-10-20","reminders":[{"id":"child","type":"relative","relatedTo":"scheduled","offset":"PT0S"}]}))?,body:None}))?;
    parent_fields(
        &f,
        json!({"scheduled":DAY,"complete_instances":[DAY],"skipped_instances":[DAY],"reminders":[{"id":"parent","type":"relative","relatedTo":"scheduled","offset":"PT0S"}]}),
    )?;
    f.engine.refresh("a")?;
    let provider = std::sync::Arc::new(NoProvider::default());
    let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
    let counts = f.counts()?;
    let today = engine.snapshot(
        "a",
        &Query {
            scope: Some("today".into()),
            today: Some(DAY.into()),
            ..Query::default()
        },
    )?;
    assert_eq!(today.total_count, 0);
    let upcoming = engine.snapshot(
        "a",
        &Query {
            scope: Some("upcoming".into()),
            today: Some("2026-10-03".into()),
            upcoming_days: Some(1),
            ..Query::default()
        },
    )?;
    assert_eq!(upcoming.total_count, 0);
    let selected = engine.snapshot(
        "a",
        &Query {
            scope: Some("today".into()),
            today: Some("2026-10-20".into()),
            statuses: Some(vec!["open".into()]),
            text: Some("2026-10-04".into()),
            group_by: Some("effectiveDate".into()),
            ..Query::default()
        },
    )?;
    assert_eq!(selected.total_count, 1);
    assert_eq!(selected.tasks.len(), 1);
    let actual = selected.tasks.first().ok_or("child projection")?;
    assert_eq!(actual.path, child);
    assert!(!actual.is_recurring);
    assert_eq!(actual.occurrence_date.as_deref(), Some(DAY));
    assert_eq!(actual.effective_date.as_deref(), Some("2026-10-20"));
    assert_eq!(selected.groups.len(), 1);
    assert!(
        selected
            .problems
            .iter()
            .any(|p| p.path == child && p.message == "occurrence_state_conflict")
    );
    let plan:Value=serde_json::from_str(&engine.features_json("a",&json!({"kind":"reminder_plan","at":"2026-10-01T00:00:00Z","from":"2026-10-04T00:00:00Z","to":"2026-10-21T00:00:00Z","timezone":"UTC"}).to_string())?)?;
    assert_eq!(plan["totalCount"], 1);
    assert_eq!(plan["rows"][0]["taskPath"], child);
    assert_eq!(plan["rows"][0]["occurrenceDate"], DAY);
    assert_eq!(plan["rows"][0]["fireAt"], "2026-10-20T00:00:00Z");
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(f.counts()?, counts);
    Ok(())
}

#[test]
fn rolling_cached_duplicate_and_unresolved_identities_are_visible_and_never_arbitrary_write_targets()
-> Result {
    for duplicate in [true, false] {
        let f = Fixture::new()?;
        let child = f.series("rolling", "scheduled", "completion")?;
        let reminders =
            json!([{"id":"r","type":"relative","relatedTo":"scheduled","offset":"PT0S"}]);
        f.engine.execute(
            "a",
            &mutation(
                "reminders",
                Command::Update {
                    path: child.clone(),
                    expected_revision: None,
                    properties: serde_json::from_value(json!({"reminders":reminders}))?,
                    body: None,
                },
            ),
        )?;
        let code = if duplicate {
            f.files.seed("a", "Tasks/Duplicate.md", &f.bytes(&child)?)?;
            "duplicate_occurrence_note"
        } else {
            let doc = TaskDocument::parse(VaultPath::parse(&child)?, &f.bytes(&child)?)?;
            let write = doc.plan(
                &[tasknotes_vault::document::PropertyEdit::Set {
                    key: "recurrence_parent".into(),
                    value: json!("[[/Missing.md]]"),
                }],
                None,
            )?;
            f.files.seed("a", &child, &write.bytes)?;
            "invalid_recurrence_parent"
        };
        f.engine.refresh("a")?;
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        let snapshot = f.engine.snapshot("a", &Query::default())?;
        assert!(
            snapshot
                .problems
                .iter()
                .any(|p| p.path == child && p.message == code)
        );
        let plan=f.feature(&json!({"kind":"reminder_plan","at":"2026-10-01T00:00:00Z","from":"2026-10-04T00:00:00Z","to":"2026-10-05T00:00:00Z","timezone":"UTC"}))?;
        assert_eq!(plan["totalCount"], i32::from(!duplicate));
        if !duplicate {
            assert_eq!(plan["rows"][0]["occurrenceDate"], DAY);
        }
        assert!(
            plan["problems"]
                .as_array()
                .ok_or("problems")?
                .iter()
                .any(|p| p["code"] == code)
        );
        assert!(matches!(
            f.engine.execute("a", &request(&f, "invalid-target")?),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
    }
    Ok(())
}

#[test]
fn rolling_manual_repair_suppresses_active_creation_problem_without_changing_history_or_undo_ownership()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    parent_fields(&f, json!({"occurrence_template":"Templates/missing.md"}))?;
    f.files.seed("a","tasknotes.yaml",b"templating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n")?;
    f.engine
        .execute("a", &f.finish("failed-primary", &child, 0)?)?;
    let historical = f.outcome("failed-primary")?;
    assert_eq!(historical["items"][0]["state"], "failed");
    assert!(
        f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|p| p.message.contains("Next occurrence"))
    );
    f.files.seed(
        "a",
        "Templates/missing.md",
        b"---\nstatus: open\n---\nIndependently repaired\n",
    )?;
    let repair = mutation(
        "independent-repair",
        Command::MaterializeOccurrence {
            parent_path: PARENT.into(),
            expected_parent_revision: ContentRevision::of(&f.bytes(PARENT)?).as_str().into(),
            occurrence_date: "2026-10-05".into(),
            expected_occurrence_revision: None,
            properties: serde_json::Map::new(),
            body: None,
        },
    );
    let receipt = f.engine.execute("a", &repair)?;
    let repaired = receipt.task_path.as_deref().ok_or("repaired child")?;
    let bytes = f.bytes(repaired)?;
    parent_fields(&f, json!({"recurrence":""}))?;
    f.engine.refresh("a")?;
    assert!(
        !f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|p| p.message.contains("Next occurrence"))
    );
    assert_eq!(f.outcome("failed-primary")?, historical);
    assert_eq!(
        f.feature(&json!({"kind":"undo_available"}))?["receiptId"],
        "independent-repair"
    );
    let before = f.exchanges()?;
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "undo-old-primary",
                Command::Undo {
                    receipt_id: "failed-primary".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.exchanges()?, before);
    assert_eq!(f.bytes(repaired)?, bytes);
    f.engine.execute(
        "a",
        &mutation(
            "undo-repair",
            Command::Undo {
                receipt_id: "independent-repair".into(),
            },
        ),
    )?;
    assert!(f.files.get("a", repaired)?.is_none());
    assert!(
        f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|p| p.message.contains("Next occurrence"))
    );
    assert_eq!(f.outcome("failed-primary")?, historical);
    Ok(())
}

#[test]
fn rolling_custom_mapping_task_horizons_and_skipped_child_state_override_parent_lists() -> Result {
    let f = Fixture::new()?;
    f.files.seed("a","tasknotes.yaml",b"mapping:\n  recurrence_parent: seriesLink\n  occurrence_date: instanceDay\n  occurrence_future_horizon: futureWindow\noccurrences:\n  default_materialization: rolling\n  future_horizon: P30D\nstatus:\n  values: [open, done, deferred]\n  default: open\n  completed_values: [done]\n  skipped_values: [deferred]\n  default_skipped: deferred\n")?;
    let child = f.series("rolling", "scheduled", "completion")?;
    parent_fields(&f, json!({"futureWindow":"P1D"}))?;
    let receipt = f.engine.execute("a", &request(&f, "custom-window")?)?;
    assert_eq!(receipt.paths.len(), 1);
    let new_path = receipt.paths.first().ok_or("new child")?;
    let doc = TaskDocument::parse(VaultPath::parse(new_path)?, &f.bytes(new_path)?)?;
    assert_eq!(
        doc.frontmatter().get("instanceDay"),
        Some(&json!("2026-10-05"))
    );
    assert!(doc.frontmatter().contains_key("seriesLink"));
    assert!(!doc.frontmatter().contains_key("occurrence_date"));
    f.engine.execute(
        "a",
        &mutation(
            "skip-custom",
            Command::SetOccurrenceSkipped {
                path: child.clone(),
                expected_revision: None,
                occurrence_date: DAY.into(),
                skipped: true,
            },
        ),
    )?;
    parent_fields(
        &f,
        json!({"complete_instances":[DAY],"skipped_instances":[]}),
    )?;
    f.engine.refresh("a")?;
    let today = f.engine.snapshot(
        "a",
        &Query {
            scope: Some("today".into()),
            today: Some(DAY.into()),
            ..Query::default()
        },
    )?;
    assert_eq!(today.total_count, 0);
    let all = f.engine.snapshot("a", &Query::default())?;
    let actual = all
        .tasks
        .iter()
        .find(|task| task.path == child)
        .ok_or("custom child")?;
    assert_eq!(actual.status, "deferred");
    assert_eq!(actual.occurrence_date.as_deref(), Some(DAY));
    assert!(
        all.problems
            .iter()
            .any(|p| p.path == child && p.message == "occurrence_state_conflict")
    );
    Ok(())
}

#[test]
fn rolling_date_precedence_keeps_parent_due_out_of_children_and_caller_overrides_template() -> Result
{
    let f = Fixture::new()?;
    f.files.seed(
        "a",
        "tasknotes.yaml",
        b"occurrences:\n  future_horizon: P1D\n",
    )?;
    f.series("rolling", "scheduled", "completion")?;
    parent_fields(&f, json!({"due":"2026-10-09"}))?;
    let receipt = f.engine.execute("a", &request(&f, "defaults")?)?;
    let path = receipt.paths.first().ok_or("default child")?;
    assert_eq!(f.values(path)?.get("scheduled"), Some(&json!("2026-10-05")));
    assert!(!f.values(path)?.contains_key("due"));
    parent_fields(&f, json!({"occurrence_template":"Templates/override.md"}))?;
    f.files.seed(
        "a",
        "Templates/override.md",
        b"---\nscheduled: 2026-10-20\ndue: 2026-10-21\n---\nTemplate body\n",
    )?;
    let request = mutation(
        "explicit-date",
        Command::MaterializeOccurrence {
            parent_path: PARENT.into(),
            expected_parent_revision: ContentRevision::of(&f.bytes(PARENT)?).as_str().into(),
            occurrence_date: "2026-10-06".into(),
            expected_occurrence_revision: None,
            properties: serde_json::from_value(
                json!({"scheduled":"2026-10-30","due":"2026-10-31"}),
            )?,
            body: Some("Caller body\n".into()),
        },
    );
    let receipt = f.engine.execute("a", &request)?;
    let path = receipt.task_path.as_deref().ok_or("explicit child")?;
    assert_eq!(f.values(path)?.get("scheduled"), Some(&json!("2026-10-30")));
    assert_eq!(f.values(path)?.get("due"), Some(&json!("2026-10-31")));
    assert_eq!(
        f.values(path)?.get("occurrenceDate"),
        Some(&json!("2026-10-06"))
    );
    Ok(())
}

#[test]
fn rolling_schema14_migration_preserves_existing_state_and_current16_rejects_missing_or_changed_plan()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    f.engine
        .execute("a", &f.finish("completed-before-migration", &child, 0)?)?;
    let child_before = f.bytes(&child)?;
    let parent_before = f.bytes(PARENT)?;
    let counts = f.counts()?;
    let db = rusqlite::Connection::open(&f.database)?;
    let before = super::retained_tables(&db)?;
    assert_eq!(
        db.query_row("SELECT count(*) FROM occurrence_windows", [], |r| r
            .get::<_, i64>(0))?,
        0
    );
    super::super::remove_deferred_progressions_for_historical_fixture(&db)?;
    db.execute_batch("DROP TABLE occurrence_windows;PRAGMA user_version=14;")?;
    drop(db);
    let f = f.reopen()?;
    let db = rusqlite::Connection::open(&f.database)?;
    assert_eq!(super::retained_tables(&db)?, before);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
        16
    );
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.bytes(&child)?, child_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    drop(db);
    for corruption in ["missing-table", "changed-date"] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            "tasknotes.yaml",
            b"occurrences:\n  future_horizon: P1D\n",
        )?;
        f.series("rolling", "scheduled", "completion")?;
        f.engine.execute("a", &request(&f, "owned-window")?)?;
        let db = rusqlite::Connection::open(&f.database)?;
        if corruption == "missing-table" {
            db.execute_batch("DROP TABLE occurrence_windows;")?;
        } else {
            db.execute("UPDATE occurrence_windows SET json=json_set(json,'$.entries[0].date','2026-10-05') WHERE id='owned-window'",[])?;
        }
        drop(db);
        let Fixture {
            directory,
            database,
            files,
            engine,
        } = f;
        drop(engine);
        assert!(matches!(
            tasknotes_runtime::engine::Engine::open(&database, files),
            Err(RuntimeError::Storage(_))
        ));
        drop(directory);
    }
    Ok(())
}

#[test]
fn rolling_historical_child_dates_state_and_reminders_survive_changed_removed_or_invalid_parent_recurrence()
-> Result {
    for (rule, problem) in [
        (Some("DTSTART:20261001;FREQ=WEEKLY;BYDAY=TH"), false),
        (Some(""), true),
        (Some("FREQ=NONSENSE"), true),
        (None, true),
    ] {
        let f = Fixture::new()?;
        let child = f.series("manual", "scheduled", "completion")?;
        f.engine.execute("a",&mutation("child-reminder",Command::Update {path:child.clone(),expected_revision:None,properties:serde_json::from_value(json!({"scheduled":"2026-10-20","reminders":[{"id":"child","type":"relative","relatedTo":"scheduled","offset":"PT0S"}]}))?,body:Some("Durable historical body\n".into())}))?;
        let before = f.bytes(&child)?;
        if let Some(rule) = rule {
            parent_fields(&f, json!({"recurrence":rule}))?;
        } else {
            parent_fields(&f, json!({"tags":[]}))?;
        }
        f.engine.refresh("a")?;
        let counts = f.counts()?;
        let provider = std::sync::Arc::new(NoProvider::default());
        let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
        let snapshot = engine.snapshot(
            "a",
            &Query {
                scope: Some("today".into()),
                today: Some("2026-10-20".into()),
                text: Some("2026-10-04".into()),
                ..Query::default()
            },
        )?;
        assert_eq!(snapshot.total_count, 1);
        let task = snapshot.tasks.first().ok_or("historical child")?;
        assert_eq!(task.path, child);
        assert_eq!(task.occurrence_date.as_deref(), Some(DAY));
        assert_eq!(task.effective_date.as_deref(), Some("2026-10-20"));
        assert_eq!(task.status, "open");
        assert!(task.body.contains("Durable historical body"));
        assert_eq!(
            snapshot
                .problems
                .iter()
                .any(|p| p.path == child && p.message == "invalid_recurrence_parent"),
            problem
        );
        let plan:Value=serde_json::from_str(&engine.features_json("a",&json!({"kind":"reminder_plan","at":"2026-10-01T00:00:00Z","from":"2026-10-20T00:00:00Z","to":"2026-10-21T00:00:00Z","timezone":"UTC"}).to_string())?)?;
        assert_eq!(plan["totalCount"], 1);
        assert_eq!(plan["rows"][0]["taskPath"], child);
        assert_eq!(plan["rows"][0]["occurrenceDate"], DAY);
        assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(f.bytes(&child)?, before);
        assert_eq!(f.counts()?, counts);
    }
    Ok(())
}

#[test]
fn rolling_public_json_command_is_closed_and_invalid_boundaries_have_no_effects() -> Result {
    let f = Fixture::new()?;
    f.series("rolling", "scheduled", "completion")?;
    let valid = serde_json::to_value(request(&f, "json-window")?)?;
    println!("ROLLING_COMMAND_SCHEMA {}", valid["command"]);
    let before = f.counts()?;
    let exchanges = f.exchanges()?;
    for (key, value) in [
        ("referenceDate", json!("2026-02-30")),
        ("referenceDate", json!(17)),
        ("expectedParentRevision", json!("UPPERCASE")),
        ("parentPath", json!("../outside.md")),
        ("unknown", json!(true)),
    ] {
        let mut invalid = valid.clone();
        invalid["command"][key] = value;
        let result = serde_json::from_value::<tasknotes_runtime::types::Mutation>(invalid)
            .map_err(|_| RuntimeError::Validation("typed decoding rejected invalid JSON".into()))
            .and_then(|request| f.engine.execute("a", &request));
        assert!(matches!(result, Err(RuntimeError::Validation(_))));
        assert_eq!(f.counts()?, before);
        assert_eq!(f.exchanges()?, exchanges);
    }
    let request: tasknotes_runtime::types::Mutation = serde_json::from_value(valid)?;
    assert!(f.engine.execute("a", &request)?.applied);
    Ok(())
}

#[test]
fn rolling_exact_new_child_bound_reuses_more_than_1000_existing_entries_and_group_undo_preserves_foreign_owner()
-> Result {
    let f = Fixture::new()?;
    f.files.seed(
        "a",
        "tasknotes.yaml",
        b"occurrences:\n  future_horizon: P1000D\n",
    )?;
    let existing = f.series("rolling", "scheduled", "completion")?;
    let existing_bytes = f.bytes(&existing)?;
    let parent = f.bytes(PARENT)?;
    let req = request(&f, "full-1000-window")?;
    let receipt = f.engine.execute("a", &req)?;
    assert_eq!(receipt.paths.len(), 1000);
    assert_eq!(
        receipt
            .paths
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        1000
    );
    assert_eq!(f.counts()?.1, 1001);
    let exchanges = f.exchanges()?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &req)?)?,
        serde_json::to_value(&receipt)?
    );
    let reused = f.engine.execute("a", &request(&f, "reuse-1001-window")?)?;
    assert_eq!(reused.paths, Vec::<String>::new());
    assert_eq!(f.exchanges()?, exchanges);
    let db = rusqlite::Connection::open(&f.database)?;
    assert_eq!(db.query_row("SELECT json_array_length(json,'$.entries') FROM occurrence_windows WHERE id='reuse-1001-window'",[],|r|r.get::<_,i64>(0))?,1001);
    assert_eq!(db.query_row("SELECT count(DISTINCT json_extract(task,'$.properties.occurrenceDate')) FROM files WHERE task IS NOT NULL AND json_extract(task,'$.properties.recurrenceParent') IS NOT NULL",[],|r|r.get::<_,i64>(0))?,1001);
    drop(db);
    f.engine.execute(
        "a",
        &mutation(
            "undo-1000-window",
            Command::Undo {
                receipt_id: "full-1000-window".into(),
            },
        ),
    )?;
    for path in receipt.paths {
        assert!(f.files.get("a", &path)?.is_none());
    }
    assert_eq!(f.bytes(&existing)?, existing_bytes);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.counts()?.1, 2001);
    Ok(())
}

#[test]
fn rolling_filename_collision_overlay_keeps_every_identity_and_existing_native_completion_route()
-> Result {
    let f = Fixture::new()?;
    f.files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\n  filename_format: custom\n  custom_filename_template: same\noccurrences:\n  future_horizon: P2D\n")?;
    let existing = f.series("rolling", "scheduled", "completion")?;
    let existing_bytes = f.bytes(&existing)?;
    let receipt = f.engine.execute("a", &request(&f, "colliding-window")?)?;
    assert_eq!(receipt.paths.len(), 2);
    assert_ne!(receipt.paths.first(), receipt.paths.get(1));
    assert!(receipt.paths.iter().all(|path| path != &existing));
    let child = receipt.paths.first().ok_or("created child")?;
    let mut complete = f.finish("complete-generated-child", child, 0)?;
    if let Command::SetCompletion {
        occurrence_date, ..
    } = &mut complete.command
    {
        *occurrence_date = Some("2026-10-05".into());
    }
    f.engine.execute("a", &complete)?;
    assert_eq!(f.values(child)?.get("status"), Some(&json!("done")));
    f.engine.execute(
        "a",
        &mutation(
            "undo-generated-completion",
            Command::Undo {
                receipt_id: "complete-generated-child".into(),
            },
        ),
    )?;
    f.engine.execute(
        "a",
        &mutation(
            "undo-colliding-window",
            Command::Undo {
                receipt_id: "colliding-window".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(&existing)?, existing_bytes);
    for path in receipt.paths {
        assert!(f.files.get("a", &path)?.is_none());
    }
    Ok(())
}
