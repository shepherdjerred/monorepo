//! Integration tests for SessionManager with mock backends.
//!
//! These tests verify SessionManager behavior using mock implementations
//! of GitOperations and ExecutionBackend.

use std::sync::Arc;

use clauderon::backends::{ExecutionBackend, GitOperations, MockExecutionBackend, MockGitBackend};
use clauderon::core::{AgentType, BackendType, SessionManager, SessionStatus};
use clauderon::store::SqliteStore;
use tempfile::TempDir;

/// Helper to create a test environment
async fn create_test_manager() -> (
    SessionManager,
    TempDir,
    Arc<MockGitBackend>,
    Arc<MockExecutionBackend>,
    Arc<MockExecutionBackend>,
) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");
    let store = Arc::new(
        SqliteStore::new(&db_path)
            .await
            .expect("Failed to create store"),
    );

    let git = Arc::new(MockGitBackend::new());
    let zellij = Arc::new(MockExecutionBackend::zellij());
    let docker = Arc::new(MockExecutionBackend::docker());
    let kubernetes = Arc::new(MockExecutionBackend::kubernetes());

    // Helper functions to coerce Arc<Concrete> to Arc<dyn Trait>
    // The coercion happens at the function return site
    fn to_git_ops(arc: Arc<MockGitBackend>) -> Arc<dyn GitOperations> {
        arc
    }
    fn to_exec_backend(arc: Arc<MockExecutionBackend>) -> Arc<dyn ExecutionBackend> {
        arc
    }

    let manager = SessionManager::new(
        store,
        to_git_ops(Arc::clone(&git)),
        to_exec_backend(Arc::clone(&zellij)),
        to_exec_backend(Arc::clone(&docker)),
        to_exec_backend(Arc::clone(&kubernetes)),
    )
    .await
    .expect("Failed to create manager");

    (manager, temp_dir, git, zellij, docker)
}

// ========== create_session tests ==========

#[tokio::test]
async fn test_create_session_zellij_success() {
    let (manager, _temp_dir, git, zellij, _docker) = create_test_manager().await;

    let (session, _warnings) = manager
        .create_session(
            "/tmp/fake-repo".to_string(),
            "Test prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .expect("Failed to create session");

    // Session should have a generated name
    assert!(!session.name.is_empty());

    // Session should be running
    assert_eq!(session.status, SessionStatus::Running);

    // Backend ID should be set
    assert!(session.backend_id.is_some());

    // Git worktree should have been created
    let worktrees = git.get_worktrees().await;
    assert_eq!(worktrees.len(), 1);

    // Zellij session should have been created
    let sessions = zellij.get_sessions().await;
    assert_eq!(sessions.len(), 1);

    // Session should be in the manager's list
    let all_sessions = manager.list_sessions().await;
    assert_eq!(all_sessions.len(), 1);
    assert_eq!(all_sessions[0].id, session.id);
}

#[tokio::test]
async fn test_create_session_docker_success() {
    let (manager, _temp_dir, git, _zellij, docker) = create_test_manager().await;

    let (session, _warnings) = manager
        .create_session(
            "/tmp/fake-repo".to_string(),
            "Docker prompt".to_string(),
            BackendType::Docker,
            AgentType::ClaudeCode,
            false,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .expect("Failed to create session");

    // Session should be running
    assert_eq!(session.status, SessionStatus::Running);

    // Git worktree should have been created
    let worktrees = git.get_worktrees().await;
    assert_eq!(worktrees.len(), 1);

    // Docker container should have been created
    let containers = docker.get_sessions().await;
    assert_eq!(containers.len(), 1);
}

#[tokio::test]
async fn test_create_session_git_fails() {
    let (manager, _temp_dir, git, _zellij, _docker) = create_test_manager().await;

    // Configure git to fail
    git.set_should_fail(true);
    git.set_error_message("Git worktree creation failed").await;

    let result = manager
        .create_session(
            "/tmp/fake-repo".to_string(),
            "Test prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await;

    // Should fail with git error
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Git worktree"));

    // No sessions should be in the manager's list
    let all_sessions = manager.list_sessions().await;
    assert!(all_sessions.is_empty());
}

#[tokio::test]
async fn test_create_session_backend_fails() {
    let (manager, _temp_dir, git, zellij, _docker) = create_test_manager().await;

    // Configure zellij to fail
    zellij.set_should_fail(true);
    zellij
        .set_error_message("Zellij session creation failed")
        .await;

    let result = manager
        .create_session(
            "/tmp/fake-repo".to_string(),
            "Test prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await;

    // Should fail with backend error
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Zellij"));

    // Git worktree was created (but should ideally be cleaned up - future improvement)
    let worktrees = git.get_worktrees().await;
    assert_eq!(worktrees.len(), 1);

    // No sessions should be in the manager's list
    let all_sessions = manager.list_sessions().await;
    assert!(all_sessions.is_empty());
}

// ========== get_session tests ==========

#[tokio::test]
async fn test_get_session_by_name() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let (created, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    // Get by full name
    let found = manager.get_session(&created.name).await;
    assert!(found.is_some());
    assert_eq!(found.unwrap().id, created.id);
}

#[tokio::test]
async fn test_get_session_by_uuid() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let (created, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    // Get by UUID
    let found = manager.get_session(&created.id.to_string()).await;
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, created.name);
}

#[tokio::test]
async fn test_get_session_not_found() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let found = manager.get_session("nonexistent-session").await;
    assert!(found.is_none());
}

// ========== delete_session tests ==========

#[tokio::test]
async fn test_delete_session_success() {
    let (manager, _temp_dir, git, zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    // Verify resources exist
    assert_eq!(git.get_worktrees().await.len(), 1);
    assert_eq!(zellij.get_sessions().await.len(), 1);

    // Delete the session
    manager.delete_session(&session.name).await.unwrap();

    // Session should be gone from manager
    assert!(manager.get_session(&session.name).await.is_none());
    assert!(manager.list_sessions().await.is_empty());

    // Git worktree should be deleted
    assert!(git.get_worktrees().await.is_empty());

    // Zellij session should be deleted
    assert!(zellij.get_sessions().await.is_empty());
}

#[tokio::test]
async fn test_delete_session_not_found() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let result = manager.delete_session("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

// ========== archive_session tests ==========

#[tokio::test]
async fn test_archive_session_success() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    assert_eq!(session.status, SessionStatus::Running);

    // Archive the session
    manager.archive_session(&session.name).await.unwrap();

    // Session should now be archived
    let archived = manager.get_session(&session.name).await.unwrap();
    assert_eq!(archived.status, SessionStatus::Archived);
}

#[tokio::test]
async fn test_archive_session_not_found() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let result = manager.archive_session("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

// ========== get_attach_command tests ==========

#[tokio::test]
async fn test_get_attach_command_zellij() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    let cmd = manager.get_attach_command(&session.name).await.unwrap();

    assert_eq!(cmd[0], "zellij");
    assert_eq!(cmd[1], "attach");
    assert!(cmd[2].contains(&session.backend_id.unwrap()));
}

#[tokio::test]
async fn test_get_attach_command_docker() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Docker,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    let cmd = manager.get_attach_command(&session.name).await.unwrap();

    assert_eq!(cmd[0], "docker");
    assert_eq!(cmd[1], "attach");
}

#[tokio::test]
async fn test_get_attach_command_session_not_found() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let result = manager.get_attach_command("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

// ========== reconcile tests ==========

#[tokio::test]
async fn test_reconcile_healthy_session() {
    let (manager, _temp_dir, _git, zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    // Backend exists
    assert!(zellij.exists(&session.backend_id.unwrap()).await.unwrap());

    // Reconcile should find no issues
    let report = manager.reconcile().await.unwrap();
    assert!(report.missing_worktrees.is_empty());
    assert!(report.missing_backends.is_empty());
}

#[tokio::test]
async fn test_reconcile_missing_backend() {
    let (manager, _temp_dir, _git, zellij, _docker) = create_test_manager().await;

    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    // Manually delete the backend session to simulate a crash
    zellij.delete(&session.backend_id.unwrap()).await.unwrap();

    // Reconcile should detect missing backend
    let report = manager.reconcile().await.unwrap();
    assert!(report.missing_worktrees.is_empty());
    assert_eq!(report.missing_backends.len(), 1);
    assert_eq!(report.missing_backends[0], session.id);
}

// ========== list_sessions tests ==========

#[tokio::test]
async fn test_list_sessions_empty() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    let sessions = manager.list_sessions().await;
    assert!(sessions.is_empty());
}

#[tokio::test]
async fn test_list_sessions_multiple() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    // Create multiple sessions (names are AI-generated)
    let _ = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt 1".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    let _ = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt 2".to_string(),
            BackendType::Docker,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    let _ = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt 3".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();

    let sessions = manager.list_sessions().await;
    assert_eq!(sessions.len(), 3);
}

// ========== session state transitions ==========

#[tokio::test]
async fn test_session_lifecycle() {
    let (manager, _temp_dir, _git, _zellij, _docker) = create_test_manager().await;

    // Create session - should be Running (name is AI-generated)
    let (session, _) = manager
        .create_session(
            "/tmp/repo".to_string(),
            "prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            true,
            false,              // print_mode
            true,               // plan_mode
            Default::default(), // access_mode
            vec![],             // images
        )
        .await
        .unwrap();
    assert_eq!(session.status, SessionStatus::Running);

    // Archive session
    manager.archive_session(&session.name).await.unwrap();
    let archived = manager.get_session(&session.name).await.unwrap();
    assert_eq!(archived.status, SessionStatus::Archived);

    // Delete session
    manager.delete_session(&session.name).await.unwrap();
    assert!(manager.get_session(&session.name).await.is_none());
}
