//! Durable production witnesses for the explicit Facet compatibility policy.
//!
//! Adapted from the retained review-only witness after its policies were approved.
//! Batch and concurrency claims are verified against real journals and outboxes.

use super::{AT, Disk, PROFILE, State};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tasknotes_runtime::{
    RuntimeError,
    engine::Engine,
    types::{Command, Mutation, Profile, ProfileKind, Query, VaultFiles},
};
use tasknotes_vault::{
    document::{ContentRevision, TaskDocument},
    path::VaultPath,
};

type Evidence<T = ()> = Result<T, Box<dyn std::error::Error>>;

struct Witness {
    directory: tempfile::TempDir,
    disk: Arc<Disk>,
    engine: Engine,
    database: String,
}
impl Witness {
    fn new(filename_title: bool, paths: &[&str]) -> Evidence<Self> {
        let directory = tempfile::tempdir()?;
        let disk = Arc::new(Disk {
            root: directory.path().to_path_buf(),
            state: Mutex::new(State::default()),
        });
        disk.seed(
            ".obsidian/plugins/tasknotes/data.json",
            &serde_json::to_vec(&json!({"storeTitleInFilename":filename_title}))?,
        )?;
        for path in paths {
            let name = path
                .rsplit('/')
                .next()
                .and_then(|name| name.strip_suffix(".md"))
                .ok_or("task basename")?;
            disk.seed(path, format!("\u{feff}---\r\ntitle: {name}\r\nstatus: open\r\npriority: normal\r\ntags: [task]\r\nid: stable-{name} # identity sentinel\r\ndateCreated: 2026-01-01T00:00:00Z\r\ndateModified: 2026-01-01T00:00:00Z\r\nvendor: {{nested: retained}} # metadata sentinel\r\n---\r\nBody {name}\r\n").as_bytes())?;
        }
        let database = directory
            .path()
            .join("witness.db")
            .to_str()
            .ok_or("database path")?
            .to_owned();
        let engine = Engine::open(&database, disk.clone())?;
        engine.register_profile(Profile {
            id: PROFILE.into(),
            name: "Facet compatibility witness".into(),
            kind: ProfileKind::ObsidianSync,
            approve_standard: false,
        })?;
        engine.refresh(PROFILE)?;
        assert_eq!(
            engine.snapshot(PROFILE, &Query::default())?.tasks.len(),
            paths.len()
        );
        Ok(Self {
            directory,
            disk,
            engine,
            database,
        })
    }
    fn bytes(&self, path: &str) -> Evidence<Vec<u8>> {
        self.disk
            .read_file(PROFILE, path)?
            .ok_or_else(|| "witness file missing".into())
    }
    fn document(&self, path: &str) -> Evidence<TaskDocument> {
        Ok(TaskDocument::parse(
            VaultPath::parse(path)?,
            &self.bytes(path)?,
        )?)
    }
    fn exchanges(&self) -> Evidence<u64> {
        Ok(self
            .disk
            .state
            .lock()
            .map_err(|_| "witness lock")?
            .exchanges)
    }
    fn feature(&self, request: &Value) -> Evidence<Value> {
        Ok(serde_json::from_str(
            &self.engine.features_json(PROFILE, &request.to_string())?,
        )?)
    }
    fn assert_renamed_semantics(&self, path: &str, title: &str) -> Evidence {
        let snapshot = self.engine.snapshot(PROFILE, &Query::default())?;
        let task = snapshot
            .tasks
            .iter()
            .find(|task| task.path == path)
            .ok_or("renamed task absent")?;
        assert_eq!(task.title, title);
        assert_eq!(task.status, "open");
        assert_eq!(task.priority, "normal");
        for (key, value) in [
            ("tags", json!(["task"])),
            ("id", json!("stable-Old")),
            ("dateCreated", json!("2026-01-01T00:00:00Z")),
            ("dateModified", json!(AT)),
            ("vendor", json!({"nested":"retained"})),
        ] {
            assert_eq!(task.properties.get(key), Some(&value), "{key}");
        }
        assert_eq!(task.body, "Body Old\r\n");
        Ok(())
    }
    fn reopen(self) -> Evidence<Self> {
        let Self {
            directory,
            disk,
            engine,
            database,
        } = self;
        drop(engine);
        let engine = Engine::open(&database, disk.clone())?;
        Ok(Self {
            directory,
            disk,
            engine,
            database,
        })
    }
}
fn mutation(id: &str, command: Command) -> Mutation {
    Mutation {
        mutation_id: id.into(),
        at: AT.into(),
        execution_context: None,
        command,
    }
}
fn update(path: &str, revision: Option<String>) -> Command {
    Command::Update {
        path: path.into(),
        expected_revision: revision,
        properties: serde_json::Map::from_iter([("priority".into(), json!("high"))]),
        body: None,
    }
}

#[test]
fn filename_title_policy_preserves_bytes_with_durable_rename_replay_and_undo() -> Evidence {
    let fixture = Witness::new(true, &["tasks/Old.md"])?;
    let original = fixture.bytes("tasks/Old.md")?;
    let request = mutation(
        "filename-policy",
        Command::Update {
            path: "tasks/Old.md".into(),
            expected_revision: Some(ContentRevision::of(&original).as_str().to_owned()),
            properties: serde_json::Map::from_iter([("title".into(), json!("New Title"))]),
            body: None,
        },
    );
    let receipt = fixture.engine.execute(PROFILE, &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.task_path.as_deref(), Some("tasks/New Title.md"));
    assert!(fixture.disk.read_file(PROFILE, "tasks/Old.md")?.is_none());
    let renamed = fixture.document("tasks/New Title.md")?;
    assert!(!renamed.frontmatter().contains_key("title"));
    assert_eq!(renamed.frontmatter().get("id"), Some(&json!("stable-Old")));
    assert_eq!(
        renamed.frontmatter().get("vendor"),
        Some(&json!({"nested":"retained"}))
    );
    assert_eq!(renamed.body(), "Body Old\r\n");
    let bytes = fixture.bytes("tasks/New Title.md")?;
    assert!(bytes.starts_with(&[0xef, 0xbb, 0xbf]));
    let text = std::str::from_utf8(&bytes)?;
    assert!(text.contains("id: stable-Old # identity sentinel\r\n"));
    assert!(text.contains("vendor: {nested: retained} # metadata sentinel\r\n"));
    fixture.assert_renamed_semantics("tasks/New Title.md", "New Title")?;
    let exchanges = fixture.exchanges()?;
    let fixture = fixture.reopen()?;
    assert_eq!(
        fixture.engine.execute(PROFILE, &request)?.paths,
        receipt.paths
    );
    assert_eq!(fixture.exchanges()?, exchanges);
    fixture.assert_renamed_semantics("tasks/New Title.md", "New Title")?;
    fixture.engine.execute(
        PROFILE,
        &mutation(
            "filename-policy-undo",
            Command::Undo {
                receipt_id: "filename-policy".into(),
            },
        ),
    )?;
    assert_eq!(fixture.bytes("tasks/Old.md")?, original);
    assert!(
        fixture
            .disk
            .read_file(PROFILE, "tasks/New Title.md")?
            .is_none()
    );
    // These controls enforce Facet's chosen title policy. Ordinary frontmatter
    // titles and lossy/colliding filenames still retain the requested title.
    for (filename_title, title, occupied, expected_path) in [
        (false, "New Title", false, "tasks/Old.md"),
        (true, "A/B", false, "tasks/AB.md"),
        (true, "New Title", true, "tasks/New Title-2.md"),
    ] {
        let paths = if occupied {
            vec!["tasks/Old.md", "tasks/New Title.md"]
        } else {
            vec!["tasks/Old.md"]
        };
        let control = Witness::new(filename_title, &paths)?;
        let occupied_bytes = if occupied {
            Some(control.bytes("tasks/New Title.md")?)
        } else {
            None
        };
        let original = control.bytes("tasks/Old.md")?;
        let receipt = control.engine.execute(
            PROFILE,
            &mutation(
                "title-policy-control",
                Command::Update {
                    path: "tasks/Old.md".into(),
                    expected_revision: Some(ContentRevision::of(&original).as_str().to_owned()),
                    properties: serde_json::Map::from_iter([("title".into(), json!(title))]),
                    body: None,
                },
            ),
        )?;
        assert!(receipt.applied);
        assert_eq!(receipt.task_path.as_deref(), Some(expected_path));
        assert_eq!(
            control.document(expected_path)?.frontmatter().get("title"),
            Some(&json!(title))
        );
        control.assert_renamed_semantics(expected_path, title)?;
        if let Some(bytes) = occupied_bytes {
            assert_eq!(control.bytes("tasks/New Title.md")?, bytes);
        }
    }
    Ok(())
}

#[test]
fn claimed_batch_capability_has_real_partial_outcomes_and_replay() -> Evidence {
    let fixture = Witness::new(false, &["tasks/a.md", "tasks/b.md"])?;
    let untouched = fixture.bytes("tasks/b.md")?;
    let request = mutation(
        "batch-supported",
        Command::BatchPartial {
            commands: vec![
                update("tasks/a.md", None),
                update("tasks/b.md", Some("0".repeat(64))),
            ],
        },
    );
    let receipt = fixture.engine.execute(PROFILE, &request)?;
    assert!(receipt.applied);
    let query = json!({"kind":"batch_outcome","mutationId":"batch-supported"});
    let result = fixture.feature(&query)?;
    assert_eq!(result.get("total"), Some(&json!(2)));
    assert_eq!(result.get("succeeded"), Some(&json!(1)));
    assert_eq!(result.get("failed"), Some(&json!(1)));
    assert_eq!(
        fixture
            .document("tasks/a.md")?
            .frontmatter()
            .get("priority"),
        Some(&json!("high"))
    );
    assert_eq!(fixture.bytes("tasks/b.md")?, untouched);
    assert_eq!(
        fixture
            .feature(&json!({"kind":"sync_status"}))?
            .get("pendingUploadCount"),
        Some(&json!(1))
    );
    let exchanges = fixture.exchanges()?;
    let fixture = fixture.reopen()?;
    assert_eq!(
        fixture.engine.execute(PROFILE, &request)?.paths,
        receipt.paths
    );
    assert_eq!(fixture.feature(&query)?, result);
    assert_eq!(fixture.exchanges()?, exchanges);
    Ok(())
}

#[test]
fn claimed_concurrency_capability_preserves_foreign_bytes_before_successful_retry() -> Evidence {
    let fixture = Witness::new(false, &["tasks/a.md"])?;
    let original = fixture.bytes("tasks/a.md")?;
    let foreign = [original.as_slice(), b"Foreign writer sentinel\r\n"].concat();
    fixture.disk.seed("tasks/a.md", &foreign)?;
    let stale = mutation(
        "stale-supported",
        update(
            "tasks/a.md",
            Some(ContentRevision::of(&original).as_str().to_owned()),
        ),
    );
    assert!(matches!(
        fixture.engine.execute(PROFILE, &stale),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(fixture.bytes("tasks/a.md")?, foreign);
    assert_eq!(fixture.exchanges()?, 0);
    assert_eq!(
        fixture
            .feature(&json!({"kind":"mutation_receipt","mutationId":"stale-supported"}))?
            .get("state"),
        Some(&json!("absent"))
    );
    assert_eq!(
        fixture
            .feature(&json!({"kind":"sync_status"}))?
            .get("pendingUploadCount"),
        Some(&json!(0))
    );
    let fresh = mutation(
        "fresh-supported",
        update(
            "tasks/a.md",
            Some(ContentRevision::of(&foreign).as_str().to_owned()),
        ),
    );
    let receipt = fixture.engine.execute(PROFILE, &fresh)?;
    assert!(receipt.applied);
    assert_eq!(
        fixture
            .document("tasks/a.md")?
            .frontmatter()
            .get("priority"),
        Some(&json!("high"))
    );
    assert!(
        fixture
            .document("tasks/a.md")?
            .body()
            .ends_with("Foreign writer sentinel\r\n")
    );
    assert_eq!(
        fixture
            .feature(&json!({"kind":"sync_status"}))?
            .get("pendingUploadCount"),
        Some(&json!(1))
    );
    let exchanges = fixture.exchanges()?;
    let fixture = fixture.reopen()?;
    assert_eq!(
        fixture.engine.execute(PROFILE, &fresh)?.paths,
        receipt.paths
    );
    assert_eq!(fixture.exchanges()?, exchanges);
    Ok(())
}
