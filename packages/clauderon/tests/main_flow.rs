//! Main flow integration tests
//!
//! Tests the core data flow: Store + Event sourcing without external dependencies

use std::sync::Arc;

use clauderon::core::events::{Event, EventType, replay_events};
use clauderon::core::{AccessMode, AgentType, BackendType, Session, SessionConfig, SessionStatus};
use clauderon::store::{SqliteStore, Store};
use tempfile::TempDir;

/// Create a test session with default values
fn create_test_session(name: &str) -> Session {
    Session::new(SessionConfig {
        name: name.to_string(),
        title: None,
        description: None,
        repo_path: "/tmp/test-repo".into(),
        worktree_path: format!("/tmp/worktrees/{name}").into(),
        subdirectory: std::path::PathBuf::new(),
        branch_name: name.to_string(),
        repositories: None,
        initial_prompt: "Test prompt".to_string(),
        backend: BackendType::Zellij,
        agent: AgentType::ClaudeCode,
        dangerous_skip_checks: false,
        access_mode: AccessMode::default(),
    })
}

/// Create a test store using a temp directory
async fn create_test_store() -> (Arc<SqliteStore>, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");
    (Arc::new(store), temp_dir)
}

#[tokio::test]
async fn test_session_persistence() {
    let (store, _temp) = create_test_store().await;

    // Create and save a session
    let session = create_test_session("test-session-abc1");
    let session_id = session.id;

    store.save_session(&session).await.unwrap();

    // Retrieve the session
    let retrieved = store.get_session(session_id).await.unwrap();
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.name, "test-session-abc1");
    assert_eq!(retrieved.status, SessionStatus::Creating);
    assert_eq!(retrieved.backend, BackendType::Zellij);
}

#[tokio::test]
async fn test_session_list() {
    let (store, _temp) = create_test_store().await;

    // Create multiple sessions
    let session1 = create_test_session("session-one");
    let session2 = create_test_session("session-two");
    let session3 = create_test_session("session-three");

    store.save_session(&session1).await.unwrap();
    store.save_session(&session2).await.unwrap();
    store.save_session(&session3).await.unwrap();

    // List all sessions
    let sessions = store.list_sessions().await.unwrap();
    assert_eq!(sessions.len(), 3);

    let names: Vec<&str> = sessions.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"session-one"));
    assert!(names.contains(&"session-two"));
    assert!(names.contains(&"session-three"));
}

#[tokio::test]
async fn test_session_delete() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("delete-me");
    let session_id = session.id;

    store.save_session(&session).await.unwrap();

    // Verify it exists
    assert!(store.get_session(session_id).await.unwrap().is_some());

    // Delete it
    store.delete_session(session_id).await.unwrap();

    // Verify it's gone
    assert!(store.get_session(session_id).await.unwrap().is_none());
}

#[tokio::test]
async fn test_session_update() {
    let (store, _temp) = create_test_store().await;

    let mut session = create_test_session("update-me");
    let session_id = session.id;

    store.save_session(&session).await.unwrap();

    // Update the session status
    session.set_status(SessionStatus::Running);
    session.set_backend_id("zellij-session-123".to_string());

    store.save_session(&session).await.unwrap();

    // Retrieve and verify
    let retrieved = store.get_session(session_id).await.unwrap().unwrap();
    assert_eq!(retrieved.status, SessionStatus::Running);
    assert_eq!(retrieved.backend_id, Some("zellij-session-123".to_string()));
}

#[tokio::test]
async fn test_event_recording() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("event-test");
    let session_id = session.id;

    // Record a series of events
    let event1 = Event::new(
        session_id,
        EventType::SessionCreated {
            name: session.name.clone(),
            repo_path: session.repo_path.display().to_string(),
            backend: session.backend,
            initial_prompt: session.initial_prompt.clone(),
        },
    );
    store.record_event(&event1).await.unwrap();

    let event2 = Event::new(
        session_id,
        EventType::StatusChanged {
            old_status: SessionStatus::Creating,
            new_status: SessionStatus::Running,
        },
    );
    store.record_event(&event2).await.unwrap();

    let event3 = Event::new(
        session_id,
        EventType::BackendIdSet {
            backend_id: "zellij-xyz".to_string(),
        },
    );
    store.record_event(&event3).await.unwrap();

    // Retrieve events
    let events = store.get_events(session_id).await.unwrap();
    assert_eq!(events.len(), 3);

    // Verify event order
    assert!(matches!(
        events[0].event_type,
        EventType::SessionCreated { .. }
    ));
    assert!(matches!(
        events[1].event_type,
        EventType::StatusChanged { .. }
    ));
    assert!(matches!(
        events[2].event_type,
        EventType::BackendIdSet { .. }
    ));
}

#[tokio::test]
async fn test_event_replay_basic() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("replay-test");
    let session_id = session.id;

    // Record session creation event
    let event = Event::new(
        session_id,
        EventType::SessionCreated {
            name: session.name.clone(),
            repo_path: session.repo_path.display().to_string(),
            backend: session.backend,
            initial_prompt: session.initial_prompt.clone(),
        },
    );
    store.record_event(&event).await.unwrap();

    // Replay events to reconstruct session
    let events = store.get_events(session_id).await.unwrap();
    let replayed = replay_events(&events);

    assert!(replayed.is_some());
    let replayed = replayed.unwrap();
    assert_eq!(replayed.name, session.name);
    assert_eq!(replayed.status, SessionStatus::Creating);
}

#[tokio::test]
async fn test_event_replay_status_changes() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("status-replay");
    let session_id = session.id;

    // Record creation
    store
        .record_event(&Event::new(
            session_id,
            EventType::SessionCreated {
                name: session.name.clone(),
                repo_path: session.repo_path.display().to_string(),
                backend: session.backend,
                initial_prompt: session.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    // Record status change to Running
    store
        .record_event(&Event::new(
            session_id,
            EventType::StatusChanged {
                old_status: SessionStatus::Creating,
                new_status: SessionStatus::Running,
            },
        ))
        .await
        .unwrap();

    // Record archive
    store
        .record_event(&Event::new(session_id, EventType::SessionArchived))
        .await
        .unwrap();

    // Replay and verify final status
    let events = store.get_events(session_id).await.unwrap();
    let replayed = replay_events(&events).unwrap();
    assert_eq!(replayed.status, SessionStatus::Archived);
}

#[tokio::test]
async fn test_event_replay_with_pr() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("pr-replay");
    let session_id = session.id;

    // Record creation
    store
        .record_event(&Event::new(
            session_id,
            EventType::SessionCreated {
                name: session.name.clone(),
                repo_path: session.repo_path.display().to_string(),
                backend: session.backend,
                initial_prompt: session.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    // Record PR link
    store
        .record_event(&Event::new(
            session_id,
            EventType::PrLinked {
                pr_url: "https://github.com/user/repo/pull/123".to_string(),
            },
        ))
        .await
        .unwrap();

    // Replay and verify PR URL
    let events = store.get_events(session_id).await.unwrap();
    let replayed = replay_events(&events).unwrap();
    assert_eq!(
        replayed.pr_url,
        Some("https://github.com/user/repo/pull/123".to_string())
    );
}

#[tokio::test]
async fn test_event_replay_deleted_session() {
    let (store, _temp) = create_test_store().await;

    let session = create_test_session("deleted-replay");
    let session_id = session.id;

    // Record creation
    store
        .record_event(&Event::new(
            session_id,
            EventType::SessionCreated {
                name: session.name.clone(),
                repo_path: session.repo_path.display().to_string(),
                backend: session.backend,
                initial_prompt: session.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    // Record deletion
    store
        .record_event(&Event::new(
            session_id,
            EventType::SessionDeleted {
                reason: Some("Test deletion".to_string()),
            },
        ))
        .await
        .unwrap();

    // Replay should return None for deleted sessions
    let events = store.get_events(session_id).await.unwrap();
    let replayed = replay_events(&events);
    assert!(replayed.is_none());
}

#[tokio::test]
async fn test_get_all_events() {
    let (store, _temp) = create_test_store().await;

    // Create events for multiple sessions
    let session1 = create_test_session("multi-1");
    let session2 = create_test_session("multi-2");

    store
        .record_event(&Event::new(
            session1.id,
            EventType::SessionCreated {
                name: session1.name.clone(),
                repo_path: session1.repo_path.display().to_string(),
                backend: session1.backend,
                initial_prompt: session1.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    store
        .record_event(&Event::new(
            session2.id,
            EventType::SessionCreated {
                name: session2.name.clone(),
                repo_path: session2.repo_path.display().to_string(),
                backend: session2.backend,
                initial_prompt: session2.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    // Get all events
    let all_events = store.get_all_events().await.unwrap();
    assert_eq!(all_events.len(), 2);
}

#[tokio::test]
async fn test_full_session_lifecycle_via_store() {
    let (store, _temp) = create_test_store().await;

    // 1. Create session
    let mut session = create_test_session("lifecycle-test");
    let session_id = session.id;

    // 2. Record creation event
    store
        .record_event(&Event::new(
            session_id,
            EventType::SessionCreated {
                name: session.name.clone(),
                repo_path: session.repo_path.display().to_string(),
                backend: session.backend,
                initial_prompt: session.initial_prompt.clone(),
            },
        ))
        .await
        .unwrap();

    // 3. Save initial session state
    store.save_session(&session).await.unwrap();

    // 4. Transition to Running
    session.set_status(SessionStatus::Running);
    session.set_backend_id("backend-123".to_string());
    store.save_session(&session).await.unwrap();
    store
        .record_event(&Event::new(
            session_id,
            EventType::StatusChanged {
                old_status: SessionStatus::Creating,
                new_status: SessionStatus::Running,
            },
        ))
        .await
        .unwrap();

    // 5. Link PR
    session.set_pr_url("https://github.com/test/repo/pull/1".to_string());
    store.save_session(&session).await.unwrap();
    store
        .record_event(&Event::new(
            session_id,
            EventType::PrLinked {
                pr_url: "https://github.com/test/repo/pull/1".to_string(),
            },
        ))
        .await
        .unwrap();

    // 6. Archive session
    session.set_status(SessionStatus::Archived);
    store.save_session(&session).await.unwrap();
    store
        .record_event(&Event::new(session_id, EventType::SessionArchived))
        .await
        .unwrap();

    // 7. Verify final state from store
    let final_session = store.get_session(session_id).await.unwrap().unwrap();
    assert_eq!(final_session.status, SessionStatus::Archived);
    assert_eq!(
        final_session.pr_url,
        Some("https://github.com/test/repo/pull/1".to_string())
    );

    // 8. Verify event log
    let events = store.get_events(session_id).await.unwrap();
    assert_eq!(events.len(), 4);

    // 9. Verify event replay matches store state
    let replayed = replay_events(&events).unwrap();
    assert_eq!(replayed.status, SessionStatus::Archived);
}
