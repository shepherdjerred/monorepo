//! End-to-end tests for reconciliation
//!
//! These tests verify that the system can detect missing resources.
//! Run with: cargo test --test e2e_reconcile -- --include-ignored

mod common;

use std::sync::Arc;

use clauderon::backends::{DockerBackend, ExecutionBackend, GitBackend, GitOperations};
use clauderon::core::{AgentType, BackendType, Session, SessionConfig, SessionStatus};
use clauderon::store::{SqliteStore, Store};
use tempfile::TempDir;

/// Helper to create a test session
fn create_test_session(name: &str, worktree_path: &std::path::Path) -> Session {
    let mut session = Session::new(SessionConfig {
        name: name.to_string(),
        title: None,
        description: None,
        repo_path: "/tmp/test-repo".into(),
        worktree_path: worktree_path.to_path_buf(),
        subdirectory: std::path::PathBuf::new(),
        branch_name: name.to_string(),
        initial_prompt: "Test prompt".to_string(),
        backend: BackendType::Docker,
        agent: AgentType::Claude,
        dangerous_skip_checks: true,
        access_mode: Default::default(),
    });
    session.set_status(SessionStatus::Running);
    session.set_backend_id(format!("clauderon-{name}"));
    session
}

/// Test that we can detect a session with a missing worktree
#[tokio::test]
async fn test_detect_missing_worktree() {
    // Create a session that references a non-existent worktree
    let nonexistent_path = std::path::Path::new("/tmp/nonexistent-worktree-xyz123");
    let session = create_test_session("missing-wt", nonexistent_path);

    // The worktree path should not exist
    assert!(
        !session.worktree_path.exists(),
        "Test setup: worktree should not exist"
    );

    // In a real reconciliation, this session would be flagged as having a missing worktree
    // For now, we just verify the detection logic
    let worktree_exists = session.worktree_path.exists();
    assert!(!worktree_exists, "Should detect missing worktree");
}

/// Test that we can detect when a git worktree is properly cleaned up
#[tokio::test]
async fn test_worktree_cleanup_detection() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create a real git repo and worktree
    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent");
    let worktree_path = worktree_parent.path().join("reconcile-test-wt");

    let git = GitBackend::new();

    // Create worktree
    git.create_worktree(temp_repo.path(), &worktree_path, "reconcile-branch")
        .await
        .expect("Failed to create worktree");

    // Verify it exists
    assert!(worktree_path.exists(), "Worktree should exist");

    // Simulate what reconciliation would detect: worktree exists
    let detected_exists = git.worktree_exists(&worktree_path);
    assert!(detected_exists, "Should detect existing worktree");

    // Delete worktree to simulate a crash that left the database stale
    git.delete_worktree(temp_repo.path(), &worktree_path)
        .await
        .unwrap();

    // Now reconciliation should detect it's missing
    let detected_after_delete = git.worktree_exists(&worktree_path);
    assert!(
        !detected_after_delete,
        "Should detect worktree is now missing"
    );
}

/// Test Docker container detection for reconciliation
#[tokio::test]
#[ignore] // Requires Docker
async fn test_docker_container_cleanup_detection() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // A non-existent container should be detected as missing
    let fake_container_name = "clauderon-nonexistent-container-xyz";
    let exists = docker
        .container_exists(fake_container_name)
        .await
        .expect("Failed to check container");

    assert!(!exists, "Should detect that container doesn't exist");
}

/// Test full reconciliation scenario: session in DB but resources are gone
#[tokio::test]
async fn test_reconcile_stale_session() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create store
    let temp_db = TempDir::new().expect("Failed to create temp db dir");
    let db_path = temp_db.path().join("reconcile-test.db");
    let store = Arc::new(
        SqliteStore::new(&db_path)
            .await
            .expect("Failed to create store"),
    );

    // Create a real worktree
    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent");
    let worktree_path = worktree_parent.path().join("stale-session-wt");

    let git = GitBackend::new();
    git.create_worktree(temp_repo.path(), &worktree_path, "stale-branch")
        .await
        .expect("Failed to create worktree");

    // Create a session that references this worktree
    let session = create_test_session("stale-session", &worktree_path);
    store
        .save_session(&session)
        .await
        .expect("Failed to save session");

    // Verify session is in store
    let sessions = store
        .list_sessions()
        .await
        .expect("Failed to list sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].name, "stale-session");

    // At this point, worktree exists
    assert!(worktree_path.exists());

    // Simulate a crash: delete the worktree but leave session in DB
    git.delete_worktree(temp_repo.path(), &worktree_path)
        .await
        .expect("Failed to delete worktree");

    // Session is still in DB
    let session_in_db = store
        .get_session(session.id)
        .await
        .expect("Failed to get session");
    assert!(session_in_db.is_some(), "Session should still be in DB");

    // But worktree is gone
    assert!(!worktree_path.exists(), "Worktree should be gone");

    // In a real reconciliation, this would be flagged as needing attention
    let stored_session = session_in_db.unwrap();
    let worktree_missing = !stored_session.worktree_path.exists();
    assert!(
        worktree_missing,
        "Reconciliation should detect missing worktree"
    );
}

/// Test that sessions with existing resources are not flagged
#[tokio::test]
async fn test_reconcile_healthy_session() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create a real worktree
    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent");
    let worktree_path = worktree_parent.path().join("healthy-session-wt");

    let git = GitBackend::new();
    git.create_worktree(temp_repo.path(), &worktree_path, "healthy-branch")
        .await
        .expect("Failed to create worktree");

    // Create a session that references this worktree
    let session = create_test_session("healthy-session", &worktree_path);

    // Worktree exists
    assert!(session.worktree_path.exists());

    // Reconciliation should NOT flag this as missing
    let worktree_exists = session.worktree_path.exists();
    assert!(
        worktree_exists,
        "Healthy session should have existing worktree"
    );

    // Cleanup
    git.delete_worktree(temp_repo.path(), &worktree_path)
        .await
        .unwrap();
}
