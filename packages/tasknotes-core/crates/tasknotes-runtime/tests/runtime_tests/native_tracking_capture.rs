//! Actual current-producer scalar and complete bounded tracking page capture.

use super::{
    Arc, ContentRevision, Engine, Memory, ProfileKind, Result, RuntimeError, Value, json, profile,
};

const INPUTS: &str = include_str!(
    "../../../../../tasknotes-fixtures/vault/runtime-tracking/core-aggregate-inputs.json"
);

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(RuntimeError::NotFound)
}

fn pages(engine: &Engine, owner: &str, mut request: Value) -> Result<Vec<String>> {
    let mut result = Vec::new();
    let mut first_version = None;
    loop {
        let raw = engine.features_json(owner, &request.to_string())?;
        let page: Value = serde_json::from_str(&raw)?;
        assert_eq!(page.get("profileId"), Some(&json!(owner)));
        assert_eq!(page.get("at"), request.get("at"));
        let version = page.get("version").cloned().ok_or(RuntimeError::NotFound)?;
        if let Some(expected) = &first_version {
            assert_eq!(&version, expected);
        } else {
            first_version = Some(version.clone());
        }
        let after = page
            .get("nextCursor")
            .cloned()
            .ok_or(RuntimeError::NotFound)?;
        result.push(raw);
        if after.is_null() {
            break;
        }
        let fields = request.as_object_mut().ok_or(RuntimeError::NotFound)?;
        fields.insert("after".into(), after);
        fields.insert("expectedVersion".into(), version);
    }
    Ok(result)
}

#[test]
fn capture_exact_legacy_scalars_and_all_bounded_tracking_pages() -> Result<()> {
    capture(
        INPUTS,
        "6637c8afc77b55ba8d614b24048079e01f6f4eaf9a128a9f7ad6e6e74dca0d23",
    )
}

#[test]
fn capture_exact_nanosecond_thresholds_and_lossless_owner_clock() -> Result<()> {
    capture(
        include_str!(
            "../../../../../tasknotes-fixtures/vault/runtime-tracking/core-nano-aggregate-inputs.json"
        ),
        "51eed6757a91a9edff507fef77da74bf947f06c063945a1a768850904f86fa51",
    )
}

fn capture(input: &str, input_hash: &str) -> Result<()> {
    assert_eq!(ContentRevision::of(input.as_bytes()).as_str(), input_hash);
    let input: Value = serde_json::from_str(input)?;
    let owner = text(&input, "profileId")?;
    let at = text(&input, "at")?;
    let cases = input
        .get("cases")
        .and_then(Value::as_array)
        .ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    for case in cases {
        let metadata = json!({"title":text(case,"id")?,"status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z","timeEntries":case.get("timeEntries"),"projects":[]});
        files.seed(
            owner,
            text(case, "path")?,
            format!("---\n{metadata}\n---\nCaptured fixture body\n").as_bytes(),
        )?;
    }
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let db = directory.path().join("tracking-capture.db");
    let engine = Engine::open(db.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    let mut configured = profile(ProfileKind::LocalFolder);
    owner.clone_into(&mut configured.id);
    engine.register_profile(configured)?;
    engine.refresh(owner)?;
    engine.close()?;
    drop(engine);
    let engine = Engine::open(db.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    let mut captured = Vec::new();
    for case in cases {
        let path = text(case, "path")?;
        let raw = engine.features_json(
            owner,
            &json!({"kind":"task_time","path":path,"at":at}).to_string(),
        )?;
        let limit = input
            .get(if text(case, "id")? == "history-130" {
                "manyHistoryLimit"
            } else {
                "historyLimit"
            })
            .ok_or(RuntimeError::NotFound)?;
        let before = files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("capture lock".into()))?
            .reads;
        let history = pages(
            &engine,
            owner,
            json!({"kind":"tracking_history","path":path,"at":at,"limit":limit}),
        )?;
        assert_eq!(
            files
                .state
                .lock()
                .map_err(|_| RuntimeError::Host("capture lock".into()))?
                .reads,
            before
        );
        let rows = history
            .iter()
            .map(|raw| serde_json::from_str::<Value>(raw))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let count = rows
            .iter()
            .map(|v| v.get("rows").and_then(Value::as_array).map_or(0, Vec::len))
            .sum::<usize>();
        assert_eq!(
            count,
            case.get("timeEntries")
                .and_then(Value::as_array)
                .ok_or(RuntimeError::NotFound)?
                .len()
        );
        captured.push(
            json!({"id":text(case,"id")?,"path":path,"taskTimeRaw":raw,"historyPagesRaw":history}),
        );
    }
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("capture lock".into()))?
        .reads;
    let sessions = pages(
        &engine,
        owner,
        json!({"kind":"tracking_sessions","at":at,"limit":input.get("sessionLimit")}),
    )?;
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("capture lock".into()))?
            .reads,
        before
    );
    let capture = json!({"schemaVersion":1,"profileId":owner,"at":at,"sourceProducerManifestSHA256":"10ec0f24d0d6f798e9193cd34c8610080225512b1431e9371d1b455ae2a3deaf","sourceInputsSHA256":input_hash,"cases":captured,"sessionsPagesRaw":sessions});
    println!("NATIVE_TRACKING_CAPTURE {capture}");
    Ok(())
}
