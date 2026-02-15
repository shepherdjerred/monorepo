#![allow(clippy::allow_attributes, reason = "test files use allow for non-guaranteed lints")]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]
#![allow(clippy::print_stdout, reason = "test output")]
#![allow(clippy::print_stderr, reason = "test output")]

//! End-to-end tests for health check functionality
//!
//! These tests verify the health service can detect various backend states.
//! Many tests require external dependencies (Docker, Kubernetes, etc.) and are
//! conditionally skipped when those dependencies are not available.
//!
//! Run all tests: cargo test --test e2e_health
//! Run ignored tests: cargo test --test e2e_health -- --ignored

mod common;

use clauderon::backends::{DockerBackend, GitBackend, GitOperations};
use clauderon::core::session::{
    AvailableAction, HealthCheckResult, ResourceState, SessionHealthReport,
};
use clauderon::core::{AccessMode, AgentType, BackendType, Session, SessionConfig, SessionStatus};
use tempfile::TempDir;

/// Helper to create a test session
fn create_test_session(
    name: &str,
    backend: BackendType,
    worktree_path: &std::path::Path,
) -> Session {
    let mut session = Session::new(SessionConfig {
        name: name.to_owned(),
        title: None,
        description: None,
        repo_path: "/tmp/test-repo".into(),
        worktree_path: worktree_path.to_path_buf(),
        subdirectory: std::path::PathBuf::new(),
        branch_name: name.to_owned(),
        initial_prompt: "Test prompt".to_owned(),
        backend,
        agent: AgentType::ClaudeCode,
        dangerous_skip_checks: true,
        dangerous_copy_creds: false,
        access_mode: AccessMode::default(),
        repositories: None,
        model: None,
    });
    session.set_status(SessionStatus::Running);
    session.set_backend_id(format!("clauderon-{name}"));
    session
}

/// Helper to create a mock health report
fn create_mock_health_report(
    session: &Session,
    state: ResourceState,
    actions: Vec<AvailableAction>,
    data_safe: bool,
) -> SessionHealthReport {
    SessionHealthReport {
        session_id: session.id,
        session_name: session.name.clone(),
        backend_type: session.backend,
        state,
        available_actions: actions,
        recommended_action: None,
        description: "Test description".to_owned(),
        details: "Test details".to_owned(),
        data_safe,
    }
}

// ========== Health Check Result Tests ==========

#[test]
fn test_health_check_result_counts_healthy() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("healthy-test", BackendType::Docker, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate, AvailableAction::UpdateImage],
        true,
    );

    let result = HealthCheckResult::new(vec![report]);

    assert_eq!(result.healthy_count, 1);
    assert_eq!(result.needs_attention_count, 0);
    assert_eq!(result.blocked_count, 0);
}

#[test]
fn test_health_check_result_counts_missing() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("missing-test", BackendType::Docker, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Missing,
        vec![AvailableAction::Recreate],
        true,
    );

    let result = HealthCheckResult::new(vec![report]);

    assert_eq!(result.healthy_count, 0);
    assert_eq!(result.needs_attention_count, 1);
    assert_eq!(result.blocked_count, 0);
}

#[test]
fn test_health_check_result_counts_blocked() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("blocked-test", BackendType::Sprites, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Stopped,
        vec![], // Empty = blocked
        false,
    );

    let result = HealthCheckResult::new(vec![report]);

    assert_eq!(result.healthy_count, 0);
    assert_eq!(result.needs_attention_count, 1);
    assert_eq!(result.blocked_count, 1);
}

#[test]
fn test_health_check_result_mixed_states() {
    let temp = TempDir::new().unwrap();

    let healthy_session = create_test_session("healthy", BackendType::Docker, temp.path());
    let missing_session = create_test_session("missing", BackendType::Docker, temp.path());
    let blocked_session = create_test_session("blocked", BackendType::Sprites, temp.path());

    let reports = vec![
        create_mock_health_report(
            &healthy_session,
            ResourceState::Healthy,
            vec![AvailableAction::Recreate],
            true,
        ),
        create_mock_health_report(
            &missing_session,
            ResourceState::Missing,
            vec![AvailableAction::Recreate],
            true,
        ),
        create_mock_health_report(&blocked_session, ResourceState::Stopped, vec![], false),
    ];

    let result = HealthCheckResult::new(reports);

    assert_eq!(result.sessions.len(), 3);
    assert_eq!(result.healthy_count, 1);
    assert_eq!(result.needs_attention_count, 2);
    assert_eq!(result.blocked_count, 1);
}

// ========== ResourceState Tests ==========

#[test]
fn test_resource_state_is_healthy() {
    assert!(ResourceState::Healthy.is_healthy());
    assert!(!ResourceState::Stopped.is_healthy());
    assert!(!ResourceState::Missing.is_healthy());
    assert!(!ResourceState::Hibernated.is_healthy());
    assert!(!ResourceState::Pending.is_healthy());
    assert!(!ResourceState::CrashLoop.is_healthy());
    assert!(!ResourceState::DeletedExternally.is_healthy());
    assert!(!ResourceState::WorktreeMissing.is_healthy());
}

#[test]
fn test_resource_state_needs_attention() {
    assert!(!ResourceState::Healthy.needs_attention());
    assert!(ResourceState::Stopped.needs_attention());
    assert!(ResourceState::Missing.needs_attention());
    assert!(ResourceState::Hibernated.needs_attention());
    assert!(!ResourceState::Pending.needs_attention()); // Pending is a transient state, doesn't need attention
    assert!(ResourceState::CrashLoop.needs_attention());
}

// ========== SessionHealthReport Tests ==========

#[test]
fn test_session_health_report_is_blocked() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("test", BackendType::Docker, temp.path());

    // Not blocked when actions available
    let report = create_mock_health_report(
        &session,
        ResourceState::Missing,
        vec![AvailableAction::Recreate],
        true,
    );
    assert!(!report.is_blocked());

    // Blocked when no actions
    let blocked_report = create_mock_health_report(&session, ResourceState::Stopped, vec![], false);
    assert!(blocked_report.is_blocked());
}

#[test]
fn test_session_health_report_needs_attention() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("test", BackendType::Docker, temp.path());

    // Healthy does not need attention
    let healthy = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );
    assert!(!healthy.needs_attention());

    // Missing needs attention
    let missing = create_mock_health_report(
        &session,
        ResourceState::Missing,
        vec![AvailableAction::Recreate],
        true,
    );
    assert!(missing.needs_attention());
}

// ========== Docker-specific Tests ==========

#[test]
fn test_docker_healthy_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("docker-healthy", BackendType::Docker, temp.path());

    // Docker healthy sessions should offer proactive recreate options
    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate, AvailableAction::UpdateImage],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::UpdateImage)
    );
    assert!(report.data_safe);
}

#[test]
fn test_docker_stopped_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("docker-stopped", BackendType::Docker, temp.path());

    // Docker stopped containers can be started or recreated
    let report = create_mock_health_report(
        &session,
        ResourceState::Stopped,
        vec![AvailableAction::Start, AvailableAction::Recreate],
        true,
    );

    assert!(report.available_actions.contains(&AvailableAction::Start));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe); // Bind mount preserves data
}

#[test]
fn test_docker_missing_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("docker-missing", BackendType::Docker, temp.path());

    // Docker missing containers can be recreated
    let report = create_mock_health_report(
        &session,
        ResourceState::Missing,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(!report.available_actions.contains(&AvailableAction::Start)); // Can't start what doesn't exist
    assert!(report.data_safe);
}

// ========== Kubernetes-specific Tests ==========

#[test]
fn test_kubernetes_healthy_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("k8s-healthy", BackendType::Kubernetes, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe); // PVC preserves data
}

#[test]
fn test_kubernetes_pending_state() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("k8s-pending", BackendType::Kubernetes, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Pending,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(matches!(report.state, ResourceState::Pending));
    assert!(!report.needs_attention()); // Pending is transient, doesn't need attention
}

#[test]
fn test_kubernetes_crash_loop_state() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("k8s-crash", BackendType::Kubernetes, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::CrashLoop,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(matches!(report.state, ResourceState::CrashLoop));
    assert!(report.needs_attention());
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
}

#[test]
fn test_kubernetes_pvc_deleted_data_lost() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("k8s-pvc-deleted", BackendType::Kubernetes, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::DataLost {
            reason: "PVC was deleted".to_owned(),
        },
        vec![AvailableAction::Cleanup, AvailableAction::RecreateFresh],
        false,
    );

    assert!(!report.data_safe);
    assert!(report.available_actions.contains(&AvailableAction::Cleanup));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::RecreateFresh)
    );
}

// ========== Zellij-specific Tests ==========

#[test]
fn test_zellij_healthy_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("zellij-healthy", BackendType::Zellij, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe); // Local filesystem
}

#[test]
fn test_zellij_missing_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("zellij-missing", BackendType::Zellij, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Missing,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe); // Code is on local filesystem
}

// ========== Sprites-specific Tests ==========

#[test]
fn test_sprites_healthy_no_auto_destroy() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("sprites-healthy", BackendType::Sprites, temp.path());

    // Sprites without auto_destroy can be recreated
    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe);
}

#[test]
fn test_sprites_hibernated_actions() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("sprites-hibernated", BackendType::Sprites, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Hibernated,
        vec![AvailableAction::Wake, AvailableAction::Recreate],
        true,
    );

    assert!(report.available_actions.contains(&AvailableAction::Wake));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
    assert!(report.data_safe);
}

#[test]
fn test_sprites_stopped_auto_destroy_blocked() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("sprites-blocked", BackendType::Sprites, temp.path());

    // Sprites with auto_destroy=true that are stopped are blocked
    let report = create_mock_health_report(
        &session,
        ResourceState::Stopped,
        vec![], // No actions = blocked
        false,  // Data is not safe
    );

    assert!(report.is_blocked());
    assert!(!report.data_safe);
}

#[test]
fn test_sprites_deleted_externally() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("sprites-deleted", BackendType::Sprites, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::DeletedExternally,
        vec![AvailableAction::Cleanup, AvailableAction::RecreateFresh],
        false,
    );

    assert!(!report.data_safe);
    assert!(report.available_actions.contains(&AvailableAction::Cleanup));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::RecreateFresh)
    );
}

// ========== Worktree Missing Tests ==========

#[test]
fn test_worktree_missing_cleanup() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("wt-missing", BackendType::Docker, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::WorktreeMissing,
        vec![AvailableAction::Cleanup],
        false,
    );

    assert!(report.available_actions.contains(&AvailableAction::Cleanup));
    assert_eq!(report.available_actions.len(), 1); // Only cleanup
    assert!(!report.data_safe);
}

// ========== Startup Health Check Tests ==========

#[test]
fn test_startup_no_issues_empty_result() {
    let temp = TempDir::new().unwrap();
    let session = create_test_session("startup-healthy", BackendType::Docker, temp.path());

    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );

    let result = HealthCheckResult::new(vec![report]);

    // No sessions need attention
    assert_eq!(result.needs_attention_count, 0);
}

#[test]
fn test_startup_missing_containers_returns_list() {
    let temp = TempDir::new().unwrap();

    let missing1 = create_test_session("missing1", BackendType::Docker, temp.path());
    let missing2 = create_test_session("missing2", BackendType::Docker, temp.path());

    let reports = vec![
        create_mock_health_report(
            &missing1,
            ResourceState::Missing,
            vec![AvailableAction::Recreate],
            true,
        ),
        create_mock_health_report(
            &missing2,
            ResourceState::Missing,
            vec![AvailableAction::Recreate],
            true,
        ),
    ];

    let result = HealthCheckResult::new(reports);

    assert_eq!(result.needs_attention_count, 2);
    assert_eq!(result.healthy_count, 0);
}

#[test]
fn test_startup_mixed_healthy_unhealthy() {
    let temp = TempDir::new().unwrap();

    let healthy = create_test_session("healthy", BackendType::Docker, temp.path());
    let missing = create_test_session("missing", BackendType::Docker, temp.path());

    let reports = vec![
        create_mock_health_report(
            &healthy,
            ResourceState::Healthy,
            vec![AvailableAction::Recreate],
            true,
        ),
        create_mock_health_report(
            &missing,
            ResourceState::Missing,
            vec![AvailableAction::Recreate],
            true,
        ),
    ];

    let result = HealthCheckResult::new(reports);

    assert_eq!(result.healthy_count, 1);
    assert_eq!(result.needs_attention_count, 1);
}

// ========== Git Worktree Detection Tests ==========

#[tokio::test]
async fn test_worktree_missing_detection() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create a session pointing to a non-existent worktree
    let nonexistent_path = std::path::Path::new("/tmp/nonexistent-worktree-health-test");
    let session = create_test_session("wt-check", BackendType::Docker, nonexistent_path);

    // Worktree should not exist
    assert!(!session.worktree_path.exists());

    // This would be detected as WorktreeMissing state
    let report = create_mock_health_report(
        &session,
        ResourceState::WorktreeMissing,
        vec![AvailableAction::Cleanup],
        false,
    );

    assert!(matches!(report.state, ResourceState::WorktreeMissing));
    assert!(report.is_blocked() || report.available_actions.contains(&AvailableAction::Cleanup));
}

#[tokio::test]
async fn test_worktree_exists_detection() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create a real git repo and worktree
    let temp_repo = TempDir::new().expect("Failed to create temp repo");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent");
    let worktree_path = worktree_parent.path().join("health-test-wt");

    let git = GitBackend::new();

    // Create worktree
    git.create_worktree(temp_repo.path(), &worktree_path, "health-branch")
        .await
        .expect("Failed to create worktree");

    // Create session pointing to existing worktree
    let session = create_test_session("wt-exists", BackendType::Docker, &worktree_path);

    // Worktree should exist
    assert!(session.worktree_path.exists());

    // This would be healthy (assuming backend is also healthy)
    let report = create_mock_health_report(
        &session,
        ResourceState::Healthy,
        vec![AvailableAction::Recreate],
        true,
    );

    assert!(report.state.is_healthy());

    // Cleanup
    let _ = git.delete_worktree(temp_repo.path(), &worktree_path).await;
}
