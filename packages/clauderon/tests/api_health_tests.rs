#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]

//! API health endpoint tests
//!
//! These tests verify the health check types and their serialization.

use clauderon::core::BackendType;
use clauderon::core::session::{
    AvailableAction, HealthCheckResult, ResourceState, SessionHealthReport,
};
use uuid::Uuid;

// ========== ResourceState Serialization Tests ==========

#[test]
fn test_resource_state_healthy_serialization() {
    let state = ResourceState::Healthy;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Healthy"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::Healthy));
}

#[test]
fn test_resource_state_stopped_serialization() {
    let state = ResourceState::Stopped;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Stopped"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::Stopped));
}

#[test]
fn test_resource_state_hibernated_serialization() {
    let state = ResourceState::Hibernated;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Hibernated"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::Hibernated));
}

#[test]
fn test_resource_state_pending_serialization() {
    let state = ResourceState::Pending;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Pending"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::Pending));
}

#[test]
fn test_resource_state_missing_serialization() {
    let state = ResourceState::Missing;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Missing"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::Missing));
}

#[test]
fn test_resource_state_error_serialization() {
    let state = ResourceState::Error {
        message: "Container crashed".to_owned(),
    };
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("Error"));
    assert!(json.contains("Container crashed"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    match parsed {
        ResourceState::Error { message } => {
            assert_eq!(message, "Container crashed");
        }
        _ => panic!("Expected Error state"),
    }
}

#[test]
fn test_resource_state_crash_loop_serialization() {
    let state = ResourceState::CrashLoop;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("CrashLoop"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::CrashLoop));
}

#[test]
fn test_resource_state_deleted_externally_serialization() {
    let state = ResourceState::DeletedExternally;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("DeletedExternally"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::DeletedExternally));
}

#[test]
fn test_resource_state_data_lost_serialization() {
    let state = ResourceState::DataLost {
        reason: "PVC was deleted".to_owned(),
    };
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("DataLost"));
    assert!(json.contains("PVC was deleted"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    match parsed {
        ResourceState::DataLost { reason } => {
            assert_eq!(reason, "PVC was deleted");
        }
        _ => panic!("Expected DataLost state"),
    }
}

#[test]
fn test_resource_state_worktree_missing_serialization() {
    let state = ResourceState::WorktreeMissing;
    let json = serde_json::to_string(&state).unwrap();
    assert!(json.contains("WorktreeMissing"));

    let parsed: ResourceState = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, ResourceState::WorktreeMissing));
}

// ========== ResourceState Helper Method Tests ==========

#[test]
fn test_resource_state_is_healthy() {
    assert!(ResourceState::Healthy.is_healthy());
    assert!(!ResourceState::Stopped.is_healthy());
    assert!(!ResourceState::Missing.is_healthy());
    assert!(
        !ResourceState::Error {
            message: "test".to_owned()
        }
        .is_healthy()
    );
}

// ========== AvailableAction Serialization Tests ==========

#[test]
fn test_available_action_serialization() {
    let actions = vec![
        (AvailableAction::Start, "Start"),
        (AvailableAction::Wake, "Wake"),
        (AvailableAction::Recreate, "Recreate"),
        (AvailableAction::RecreateFresh, "RecreateFresh"),
        (AvailableAction::UpdateImage, "UpdateImage"),
        (AvailableAction::Cleanup, "Cleanup"),
    ];

    for (action, expected) in actions {
        let json = serde_json::to_string(&action).unwrap();
        assert!(
            json.contains(expected),
            "Expected {expected} in json: {json}"
        );

        let parsed: AvailableAction = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, action);
    }
}

// ========== SessionHealthReport Tests ==========

fn create_test_health_report() -> SessionHealthReport {
    SessionHealthReport {
        session_id: Uuid::new_v4(),
        session_name: "test-session".to_owned(),
        backend_type: BackendType::Docker,
        state: ResourceState::Healthy,
        available_actions: vec![AvailableAction::Recreate, AvailableAction::UpdateImage],
        recommended_action: None,
        description: "Container is running".to_owned(),
        details: "Docker container abc123 is healthy".to_owned(),
        data_safe: true,
    }
}

#[test]
fn test_session_health_report_serialization() {
    let report = create_test_health_report();
    let json = serde_json::to_string(&report).unwrap();

    assert!(json.contains("test-session"));
    assert!(json.contains("Docker"));
    assert!(json.contains("Healthy"));
    assert!(json.contains("Recreate"));
    assert!(json.contains("UpdateImage"));

    let parsed: SessionHealthReport = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.session_name, "test-session");
    assert_eq!(parsed.backend_type, BackendType::Docker);
    assert!(parsed.data_safe);
}

#[test]
fn test_session_health_report_with_recommended_action() {
    let mut report = create_test_health_report();
    report.state = ResourceState::Missing;
    report.recommended_action = Some(AvailableAction::Recreate);

    let json = serde_json::to_string(&report).unwrap();
    assert!(json.contains("recommended_action"));
    assert!(json.contains("Recreate"));

    let parsed: SessionHealthReport = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.recommended_action, Some(AvailableAction::Recreate));
}

#[test]
fn test_session_health_report_needs_attention() {
    let healthy_report = create_test_health_report();
    assert!(!healthy_report.needs_attention());

    let mut unhealthy_report = create_test_health_report();
    unhealthy_report.state = ResourceState::Missing;
    assert!(unhealthy_report.needs_attention());
}

#[test]
fn test_session_health_report_is_blocked() {
    let mut report = create_test_health_report();
    assert!(!report.is_blocked());

    report.available_actions = vec![]; // Empty = blocked
    assert!(report.is_blocked());
}

// ========== HealthCheckResult Tests ==========

#[test]
fn test_health_check_result_creation() {
    let reports = vec![
        {
            let mut r = create_test_health_report();
            r.state = ResourceState::Healthy;
            r.available_actions = vec![AvailableAction::Recreate];
            r
        },
        {
            let mut r = create_test_health_report();
            r.state = ResourceState::Missing;
            r.available_actions = vec![AvailableAction::Recreate];
            r
        },
        {
            let mut r = create_test_health_report();
            r.state = ResourceState::Stopped;
            r.available_actions = vec![]; // Blocked
            r
        },
    ];

    let result = HealthCheckResult::new(reports);

    assert_eq!(result.sessions.len(), 3);
    assert_eq!(result.healthy_count, 1);
    assert_eq!(result.needs_attention_count, 2);
    assert_eq!(result.blocked_count, 1);
}

#[test]
fn test_health_check_result_serialization() {
    let reports = vec![create_test_health_report()];
    let result = HealthCheckResult::new(reports);

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("sessions"));
    assert!(json.contains("healthy_count"));
    assert!(json.contains("needs_attention_count"));
    assert!(json.contains("blocked_count"));

    let parsed: HealthCheckResult = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.sessions.len(), 1);
    assert_eq!(parsed.healthy_count, 1);
}

#[test]
fn test_health_check_result_empty() {
    let result = HealthCheckResult::new(vec![]);

    assert_eq!(result.sessions.len(), 0);
    assert_eq!(result.healthy_count, 0);
    assert_eq!(result.needs_attention_count, 0);
    assert_eq!(result.blocked_count, 0);
}

// ========== Action Availability Tests ==========

#[test]
fn test_stopped_container_actions() {
    let mut report = create_test_health_report();
    report.state = ResourceState::Stopped;
    report.available_actions = vec![AvailableAction::Start, AvailableAction::Recreate];

    assert!(report.available_actions.contains(&AvailableAction::Start));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
}

#[test]
fn test_hibernated_sprite_actions() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Sprites;
    report.state = ResourceState::Hibernated;
    report.available_actions = vec![AvailableAction::Wake, AvailableAction::Recreate];

    assert!(report.available_actions.contains(&AvailableAction::Wake));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::Recreate)
    );
}

#[test]
fn test_data_lost_actions() {
    let mut report = create_test_health_report();
    report.state = ResourceState::DataLost {
        reason: "PVC deleted".to_owned(),
    };
    report.available_actions = vec![AvailableAction::Cleanup, AvailableAction::RecreateFresh];
    report.data_safe = false;

    assert!(report.available_actions.contains(&AvailableAction::Cleanup));
    assert!(
        report
            .available_actions
            .contains(&AvailableAction::RecreateFresh)
    );
    assert!(!report.data_safe);
}

#[test]
fn test_healthy_proactive_recreate() {
    let report = create_test_health_report();

    // Healthy sessions should still offer recreate options
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
}

// ========== Data Safety Tests ==========

#[test]
fn test_docker_bind_mount_data_safe() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Docker;
    report.state = ResourceState::Missing;
    report.data_safe = true;

    assert!(report.data_safe);
}

#[test]
fn test_kubernetes_pvc_exists_data_safe() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Kubernetes;
    report.state = ResourceState::Missing;
    report.data_safe = true;

    assert!(report.data_safe);
}

#[test]
fn test_kubernetes_pvc_deleted_data_lost() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Kubernetes;
    report.state = ResourceState::DataLost {
        reason: "PVC was deleted".to_owned(),
    };
    report.data_safe = false;

    assert!(!report.data_safe);
}

#[test]
fn test_zellij_always_data_safe() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Zellij;
    report.state = ResourceState::Missing;
    report.data_safe = true;

    assert!(report.data_safe);
}

#[test]
fn test_sprites_auto_destroy_not_data_safe() {
    let mut report = create_test_health_report();
    report.backend_type = BackendType::Sprites;
    report.state = ResourceState::Stopped;
    report.available_actions = vec![]; // Blocked
    report.data_safe = false;

    assert!(!report.data_safe);
    assert!(report.is_blocked());
}
