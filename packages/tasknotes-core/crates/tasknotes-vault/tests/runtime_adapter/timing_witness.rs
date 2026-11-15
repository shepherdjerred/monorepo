//! Real-engine state and byte-preservation witnesses for each withdrawn input.

use super::{AT, Disk, PROFILE, State};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tasknotes_runtime::{
    RuntimeError,
    engine::Engine,
    types::{Command, Mutation, Profile, ProfileKind, Query, VaultFiles},
};
use tasknotes_vault::{
    compat::{self, ExecutionContext},
    document::TaskDocument,
    path::VaultPath,
};
type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Fixture {
    _directory: tempfile::TempDir,
    disk: Arc<Disk>,
    engine: Engine,
    path: String,
    original: Vec<u8>,
    opaque_lines: Vec<String>,
    settings: Vec<u8>,
    status_key: String,
}

impl Fixture {
    fn new(input: &Value, kind: ProfileKind) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let disk = Arc::new(Disk {
            root: directory.path().to_path_buf(),
            state: Mutex::new(State::default()),
        });
        let mut plugin = input
            .get("data")
            .cloned()
            .unwrap_or_else(|| json!({"storeTitleInFilename":false}));
        if let Some(auto) = input.get("autoStopOnComplete") {
            plugin
                .as_object_mut()
                .ok_or("plugin object missing")?
                .insert("autoStopTimeTrackingOnComplete".into(), auto.clone());
        }
        let settings = serde_json::to_vec(&plugin)?;
        let title_key = plugin
            .get("fieldMapping")
            .and_then(|mapping| mapping.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("title");
        let status_key = plugin
            .get("fieldMapping")
            .and_then(|mapping| mapping.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("status")
            .to_owned();
        disk.seed(".obsidian/plugins/tasknotes/data.json", &settings)?;
        let folder = plugin
            .get("tasksFolder")
            .and_then(Value::as_str)
            .unwrap_or("Tasks");
        let path = format!("{folder}/Withdrawal.md");
        let entries = input
            .get("entries")
            .or_else(|| input.get("taskEntries"))
            .or_else(|| {
                input
                    .get("frontmatter")
                    .and_then(|fm| fm.get("timeEntries"))
            })
            .cloned()
            .unwrap_or(Value::Null);
        let opaque_lines = vec![
            format!(
                "vendorOriginalRequest: {} # complete immutable request\r\n",
                serde_json::to_string(input)?
            ),
            format!(
                "timeEntries: {} # uninterpreted entries\r\n",
                serde_json::to_string(&entries)?
            ),
            "timeEstimate: '0005' # historical spelling and comment\r\n".into(),
            "pomodoros: {vendor: true}\r\n".into(),
            "time_estimate: {vendor: 'opaque alias'}\r\n".into(),
            "time_entries: 'not a timing list'\r\n".into(),
            "budget: false\r\n".into(),
            "legacy_budget: {vendor: true}\r\n".into(),
            "log: [vendor, 'unparsed']\r\n".into(),
            "legacy_log: null\r\n".into(),
            "rounds: 'invalid historical count'\r\n".into(),
        ];
        let original = format!("\u{feff}---\r\n{title_key}: Withdrawal\r\n{status_key}: open\r\npriority: normal\r\ntags: [task]\r\ndateCreated: 2026-01-01T00:00:00Z\r\ndateModified: 2026-01-01T00:00:00Z\r\n{}---\r\n\r\nOriginal body.\r\n", opaque_lines.join("")).into_bytes();
        disk.seed(&path, &original)?;
        let database = directory.path().join("witness.db");
        let engine = Engine::open(database.to_str().ok_or("database path")?, disk.clone())?;
        engine.register_profile(Profile {
            id: PROFILE.into(),
            name: "Timing withdrawal witness".into(),
            kind,
            approve_standard: true,
        })?;
        engine.refresh(PROFILE)?;
        assert_eq!(
            engine.snapshot(PROFILE, &Query::default())?.tasks.len(),
            1,
            "positive setup must discover task"
        );
        Ok(Self {
            _directory: directory,
            disk,
            engine,
            path,
            original,
            opaque_lines,
            settings,
            status_key,
        })
    }

    fn state(&self) -> Result<Value, Box<dyn std::error::Error>> {
        let files = self
            .disk
            .list_files(PROFILE)?
            .into_iter()
            .map(|path| {
                Ok((
                    path.clone(),
                    self.disk
                        .read_file(PROFILE, &path)?
                        .ok_or("inventory file missing")?,
                ))
            })
            .collect::<Result<std::collections::BTreeMap<_, _>, Box<dyn std::error::Error>>>()?;
        let exchanges = self
            .disk
            .state
            .lock()
            .map_err(|_| "disk state poisoned")?
            .exchanges;
        Ok(json!({
            "files":files, "snapshot":self.engine.snapshot(PROFILE,&Query::default())?,
            "exchanges":exchanges,"pendingHead":self.engine.pending_upload_metadata(PROFILE)?,
            "undo":self.engine.features_json(PROFILE,r#"{"kind":"undo_available"}"#)?,
            "receipt":self.engine.features_json(PROFILE,r#"{"kind":"mutation_receipt","mutationId":"withdrawn-request"}"#)?
        }))
    }

    fn ordinary_edit_and_undo(&self, completion: bool, sync: bool) -> TestResult {
        let mutation = Mutation {
            mutation_id: "supported-edit".into(),
            at: AT.into(),
            execution_context: None,
            command: if completion {
                Command::SetStatus {
                    path: self.path.clone(),
                    expected_revision: None,
                    status: "done".into(),
                    occurrence_date: None,
                }
            } else {
                Command::Update {
                    path: self.path.clone(),
                    expected_revision: None,
                    properties: serde_json::from_value(json!({"vendorControl":"edited"}))?,
                    body: None,
                }
            },
        };
        let receipt = self.engine.execute(PROFILE, &mutation)?;
        assert!(receipt.applied);
        let saved = self
            .disk
            .read_file(PROFILE, &self.path)?
            .ok_or("saved file missing")?;
        assert_ne!(saved, self.original, "supported edit must actually commit");
        let text = std::str::from_utf8(&saved)?;
        assert!(text.starts_with('\u{feff}'));
        assert!(!text.replace("\r\n", "").contains('\n'));
        for line in &self.opaque_lines {
            assert!(text.contains(line), "opaque metadata bytes changed: {line}");
        }
        let original = TaskDocument::parse(VaultPath::parse(&self.path)?, &self.original)?;
        let parsed = TaskDocument::parse(VaultPath::parse(&self.path)?, &saved)?;
        assert_eq!(parsed.body(), original.body());
        for key in [
            "vendorOriginalRequest",
            "timeEntries",
            "timeEstimate",
            "pomodoros",
            "time_estimate",
            "time_entries",
            "budget",
            "legacy_budget",
            "log",
            "legacy_log",
            "rounds",
        ] {
            assert_eq!(
                parsed.frontmatter().get(key),
                original.frontmatter().get(key),
                "{key}"
            );
        }
        assert_eq!(parsed.frontmatter().get("dateModified"), Some(&json!(AT)));
        assert_eq!(
            parsed.frontmatter().get(&self.status_key),
            Some(&json!(if completion { "done" } else { "open" }))
        );
        assert_eq!(
            self.disk
                .read_file(PROFILE, ".obsidian/plugins/tasknotes/data.json")?,
            Some(self.settings.clone())
        );
        let pending = self.engine.pending_upload_metadata(PROFILE)?;
        if sync {
            assert_eq!(pending.len(), 1);
            let head = pending
                .first()
                .ok_or("supported Sync edit must queue immutable upload")?;
            assert_eq!(head.path, self.path);
            assert_eq!(
                head.content_revision.as_deref(),
                Some(tasknotes_vault::document::ContentRevision::of(&saved).as_str())
            );
            assert_eq!(head.payload_size, u64::try_from(saved.len())?);
        } else {
            assert!(
                pending.is_empty(),
                "LocalFolder must not create Sync uploads"
            );
        }
        self.engine.execute(
            PROFILE,
            &Mutation {
                mutation_id: "supported-undo".into(),
                at: AT.into(),
                execution_context: None,
                command: Command::Undo {
                    receipt_id: receipt.mutation_id,
                },
            },
        )?;
        assert_eq!(
            self.disk.read_file(PROFILE, &self.path)?,
            Some(self.original.clone())
        );
        Ok(())
    }
}

pub(crate) fn preserve_original(
    id: &str,
    operation: &str,
    input: &Value,
    context: &ExecutionContext,
) -> TestResult {
    let fixture = Fixture::new(input, ProfileKind::LocalFolder)?;
    let before = fixture.state()?;
    match operation {
        "time.start" | "time.stop" | "time.replace_entries" | "time.remove_entry" => {
            // Historical runtime Command had no separate remove variant. Exercise
            // its real retired replacement boundary for removal payloads; the
            // exact time.remove_entry request is also dispatched by the corpus.
            let kind = match operation {
                "time.start" => "start_time",
                "time.stop" => "stop_time",
                _ => "set_time_entries",
            };
            let raw = json!({"mutationId":"withdrawn-request","at":AT,"command":{"kind":kind,"path":fixture.path,"expectedRevision":null,"originalInput":input}});
            let rejected = serde_json::from_value::<Mutation>(raw);
            let Err(error) = rejected else {
                return Err(format!("{id}: retired native command accepted").into());
            };
            assert!(error.is_data());
            assert!(
                error
                    .to_string()
                    .starts_with(&format!("unknown variant `{kind}`, expected ")),
                "{error}"
            );
        }
        "time.report_totals" => {
            let request = json!({"kind":"time_report","originalInput":input});
            assert!(
                matches!(fixture.engine.features_json(PROFILE,&request.to_string()),Err(RuntimeError::Validation(message)) if message == "JSON violates its schema")
            );
        }
        "time.auto_stop_on_complete" | "validation.time_entries" => {
            assert!(
                matches!(compat::execute(operation,input,context),Err(tasknotes_vault::VaultError::Document(message)) if message == "unsupported_operation")
            );
        }
        _ => {}
    }
    assert_eq!(
        fixture.state()?,
        before,
        "{id}: rejected boundary changed durable state"
    );
    let claim: Value = serde_json::from_str(
        &fixture
            .engine
            .features_json(PROFILE, r#"{"kind":"conformance"}"#)?,
    )?;
    assert!(
        claim
            .get("capabilities")
            .and_then(Value::as_array)
            .is_some(),
        "supported feature control must execute"
    );
    let completion = operation != "time.auto_stop_on_complete"
        || input.get("isCompletionTransition") == Some(&json!(true));
    fixture.ordinary_edit_and_undo(completion, false)?;
    Ok(())
}

#[test]
fn sync_positive_control_queues_the_actual_supported_edit_without_transport() -> TestResult {
    let fixture = Fixture::new(
        &json!({"entries":[{"startTime":"opaque"}]}),
        ProfileKind::ObsidianSync,
    )?;
    assert!(fixture.engine.pending_upload_metadata(PROFILE)?.is_empty());
    fixture.ordinary_edit_and_undo(true, true)
}

#[test]
fn all_retired_aliases_remain_opaque_with_supported_remaps_in_both_configuration_sources()
-> TestResult {
    for spec in [false, true] {
        let plugin = json!({"storeTitleInFilename":false,"fieldMapping":{
            "title":"headline","status":"state","completedDate":"finished",
            "timeEstimate":"budget","time_estimate":"legacy_budget",
            "timeEntries":"log","time_entries":"legacy_log","pomodoros":"rounds"
        }});
        let fixture = Fixture::new(&json!({"data":plugin}), ProfileKind::LocalFolder)?;
        let yaml = b"title:\n  storage: frontmatter\nmapping:\n  title: headline\n  status: state\n  completed_date: finished\n  timeEstimate: budget\n  time_estimate: legacy_budget\n  timeEntries: log\n  time_entries: legacy_log\n  pomodoros: rounds\n";
        if spec {
            // Plugin provider has precedence. Remove it before refresh to exercise
            // the independently declared YAML provider, then preserve its bytes.
            std::fs::remove_file(fixture.disk.path(".obsidian/plugins/tasknotes/data.json")?)?;
            fixture.disk.seed("tasknotes.yaml", yaml)?;
            fixture.engine.refresh(PROFILE)?;
        }
        let snapshot = fixture.engine.snapshot(PROFILE, &Query::default())?;
        assert_eq!(snapshot.tasks.len(), 1);
        let mapping = snapshot
            .configuration
            .get("mapping")
            .ok_or("effective mapping")?;
        for (role, field) in [
            ("title", "headline"),
            ("status", "state"),
            ("completedDate", "finished"),
        ] {
            assert_eq!(
                mapping.get("roleToField").and_then(|map| map.get(role)),
                Some(&json!(field))
            );
        }
        for role in [
            "timeEstimate",
            "time_estimate",
            "timeEntries",
            "time_entries",
            "pomodoros",
        ] {
            assert!(
                mapping
                    .get("roleToField")
                    .and_then(|map| map.get(role))
                    .is_none()
            );
        }
        if spec {
            // Keep the plugin absent during the YAML edit and Undo so provider
            // precedence cannot silently turn this into a second plugin proof.
            let receipt = fixture.engine.execute(
                PROFILE,
                &Mutation {
                    mutation_id: "mapped-complete".into(),
                    at: AT.into(),
                    execution_context: None,
                    command: Command::SetStatus {
                        path: fixture.path.clone(),
                        expected_revision: None,
                        status: "done".into(),
                        occurrence_date: None,
                    },
                },
            )?;
            let saved = fixture
                .disk
                .read_file(PROFILE, &fixture.path)?
                .ok_or("saved mapped note")?;
            let text = std::str::from_utf8(&saved)?;
            for line in &fixture.opaque_lines {
                assert!(text.contains(line));
            }
            let document = TaskDocument::parse(VaultPath::parse(&fixture.path)?, &saved)?;
            assert_eq!(document.frontmatter().get("state"), Some(&json!("done")));
            assert!(document.frontmatter().get("finished").is_some());
            fixture.engine.execute(
                PROFILE,
                &Mutation {
                    mutation_id: "mapped-undo".into(),
                    at: AT.into(),
                    execution_context: None,
                    command: Command::Undo {
                        receipt_id: receipt.mutation_id,
                    },
                },
            )?;
            assert_eq!(
                fixture.disk.read_file(PROFILE, &fixture.path)?,
                Some(fixture.original.clone())
            );
            assert_eq!(
                fixture.disk.read_file(PROFILE, "tasknotes.yaml")?,
                Some(yaml.to_vec())
            );
            assert!(
                fixture
                    .disk
                    .read_file(PROFILE, ".obsidian/plugins/tasknotes/data.json")?
                    .is_none()
            );
        } else {
            fixture.ordinary_edit_and_undo(true, false)?;
        }
    }
    Ok(())
}
