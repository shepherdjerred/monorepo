//! Actual owned FFI application lock/lifetime boundaries, without network I/O.

use super::*;
use std::{sync::Weak, time::Duration};
use tasknotes_runtime::{
    RuntimeError,
    engine::Engine,
    types::{DisplacedMetadata, VaultFiles},
};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;
type Callback = Box<dyn Fn() -> Result<(), RuntimeError> + Send + Sync>;

#[derive(Default)]
struct Files {
    callback: Mutex<Option<Callback>>,
}
impl VaultFiles for Files {
    fn list_files(&self, _: &str) -> Result<Vec<String>, RuntimeError> {
        Ok(Vec::new())
    }
    fn read_file(&self, _: &str, _: &str) -> Result<Option<Vec<u8>>, RuntimeError> {
        if let Some(callback) = self
            .callback
            .lock()
            .map_err(|_| RuntimeError::Busy)?
            .as_ref()
        {
            callback()?;
        }
        Ok(None)
    }
    fn open_file_snapshot(
        &self,
        profile: &str,
        path: &str,
    ) -> Result<Option<tasknotes_runtime::types::FileSnapshot>, RuntimeError> {
        self.read_file(profile, path)?;
        Ok(None)
    }
    fn compare_exchange_staged(
        &self,
        _: &str,
        _: &str,
        _: &str,
        expected: Option<&str>,
        stage: Option<&str>,
    ) -> Result<tasknotes_runtime::types::StagedExchange, RuntimeError> {
        if expected.is_some() || stage.is_some() {
            return Err(RuntimeError::HostContract("nonempty_test_provider".into()));
        }
        Ok(tasknotes_runtime::types::StagedExchange {
            applied: true,
            displaced: None,
        })
    }
    fn displaced_metadata(
        &self,
        _: &str,
        _: Option<&str>,
        _: u32,
    ) -> Result<Vec<DisplacedMetadata>, RuntimeError> {
        Ok(Vec::new())
    }
    fn acknowledge_displaced(&self, _: &str, _: &str) -> Result<(), RuntimeError> {
        Err(RuntimeError::HostContract("unexpected_backup".into()))
    }
}

fn bound(files: Arc<Files>) -> TestResult<(Arc<FfiFacetEngine>, Arc<FfiObsidianSession>, String)> {
    let checkpoint = serde_json::json!({"schema_version":1,"cursor":7,"initial":false,"pending":{"7":{"uid":7,"path":"assets/deleted.bin","ctime":1,"mtime":2,"hash":"","deleted":true,"selected":true}}}).to_string();
    let engine = FfiFacetEngine::from_runtime(Engine::open(":memory:", files)?);
    engine.register_profile(r#"{"schemaVersion":1,"id":"a","name":"Test","kind":"obsidian_sync","approveStandard":false}"#)?;
    engine.runtime().save_checkpoint("a", &checkpoint)?;
    let session = FfiObsidianSession::new(ObsidianSessionOptions {
        host: "sync-test.obsidian.md".into(),
        token: "public-token".into(),
        vault_id: "vault".into(),
        device_name: "test".into(),
        encryption_version: 3,
        salt: "public-salt".into(),
        key_bytes: vec![1; 32],
        checkpoint_json: checkpoint,
        filter_json: None,
    })?;
    session.bind_runtime(engine.clone(), "a".into())?;
    session.begin(0)?;
    session.opened(1)?;
    session.receive_text(r#"{"res":"ok"}"#.into(), 2)?;
    let effects = session.receive_text(r#"{"op":"ready","version":7}"#.into(), 3)?;
    for effect in effects {
        if let ObsidianSessionEffect::PersistCheckpointDelta {
            revision,
            delta_json,
        } = effect
        {
            engine.runtime().apply_checkpoint_delta("a", &delta_json)?;
            session.checkpoint_persisted(revision, 4)?;
        }
    }
    session.queue_download(7, 5)?;
    let effects = session.receive_text(r#"{"res":"ok","deleted":true}"#.into(), 6)?;
    let id = effects
        .into_iter()
        .find_map(|effect| match effect {
            ObsidianSessionEffect::DownloadedPayload { transfer_id, .. } => Some(transfer_id),
            _ => None,
        })
        .ok_or("No owned completion")?;
    Ok((engine, session, id))
}

fn apply_with_deadline(
    session: Arc<FfiObsidianSession>,
    id: String,
) -> TestResult<Result<(), ObsidianBoundaryError>> {
    let (sent, received) = std::sync::mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || sent.send(session.apply_download(&id)));
    let result = received.recv_timeout(Duration::from_secs(5))?;
    thread.join().map_err(|_| "Application thread failed")??;
    Ok(result)
}

#[test]
fn owned_apply_callbacks_reenter_session_and_close_without_locked_callback_deadlock() -> TestResult
{
    let files = Arc::new(Files::default());
    let (engine, session, id) = bound(files.clone())?;
    assert!(matches!(
        session.complete_remote(7),
        Err(ObsidianBoundaryError::Request)
    ));
    let weak_session = Arc::downgrade(&session);
    let weak_engine = Arc::downgrade(&engine);
    *files.callback.lock().map_err(|_| "Callback lock")? = Some(Box::new(move || {
        let session = weak_session.upgrade().ok_or(RuntimeError::Closed)?;
        assert!(matches!(
            session.checkpoint_json(),
            Err(ObsidianBoundaryError::Busy)
        ));
        let engine = weak_engine.upgrade().ok_or(RuntimeError::Closed)?;
        assert!(matches!(
            engine.close_runtime(),
            Err(crate::facet::FacetEngineError::Busy)
        ));
        assert!(!engine.runtime().is_closed());
        Ok(())
    }));
    apply_with_deadline(session.clone(), id.clone())??;
    session.apply_download(&id)?;
    assert!(
        session
            .state
            .lock()
            .map_err(|_| "Session lock")?
            .download
            .as_ref()
            .is_some_and(|download| download.applied)
    );
    assert!(
        engine
            .runtime()
            .load_checkpoint("a")?
            .ok_or("Missing checkpoint")?
            .contains("deleted.bin")
    );
    session.complete_remote(7)?;
    assert!(
        session
            .state
            .lock()
            .map_err(|_| "Session lock")?
            .download
            .is_none()
    );
    Ok(())
}

#[test]
fn reentrant_unbind_invalidates_owned_application_without_acknowledging_remote_notice() -> TestResult
{
    let files = Arc::new(Files::default());
    let (engine, session, id) = bound(files.clone())?;
    let weak: Weak<FfiObsidianSession> = Arc::downgrade(&session);
    *files.callback.lock().map_err(|_| "Callback lock")? = Some(Box::new(move || {
        let session = weak.upgrade().ok_or(RuntimeError::Closed)?;
        session
            .unbind_runtime(10)
            .map_err(|_| RuntimeError::HostContract("unbind_failed".into()))?;
        Ok(())
    }));
    assert!(matches!(
        apply_with_deadline(session.clone(), id)?,
        Err(ObsidianBoundaryError::Request)
    ));
    let state = session.state.lock().map_err(|_| "Session lock")?;
    assert!(state.binding.is_none());
    assert!(state.download.is_none());
    assert!(state.application.is_none());
    drop(state);
    assert!(
        engine
            .runtime()
            .load_checkpoint("a")?
            .ok_or("Missing checkpoint")?
            .contains("deleted.bin")
    );
    Ok(())
}

#[test]
fn completion_projection_after_owner_close_releases_frame_reservation_without_ack() -> TestResult {
    let (engine, session, _) = bound(Arc::new(Files::default()))?;
    let mut state = session.state.lock().map_err(|_| "Session lock")?;
    drop(state.download.take());
    state.session.release_download(7)?;
    state.session.queue_download(7, 10)?;
    let effects = state
        .session
        .handle(Input::Text(r#"{"res":"ok","deleted":true}"#.into()), 11)?;
    engine.close_runtime()?;
    assert!(
        matches!(project_effects(&mut state, effects), Err(ObsidianBoundaryError::Boundary { code, .. }) if code == "engine_closed")
    );
    assert!(state.download.is_none());
    assert!(
        state.session.release_download(7).is_err(),
        "Failed projection already released its original frame reservation"
    );
    assert!(state.session.checkpoint().pending.contains_key(&7));
    Ok(())
}
