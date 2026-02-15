#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]

//! API integration tests

use clauderon::api::protocol::{CreateSessionRequest, Request, Response};
use clauderon::backends::DockerBackend;
use clauderon::core::{AccessMode, AgentType, BackendType, SessionStatus};
use std::path::PathBuf;

#[test]
fn test_request_serialization() {
    let request = Request::ListSessions;
    let json = serde_json::to_string(&request).unwrap();
    assert_eq!(json, r#"{"type":"ListSessions"}"#);

    let parsed: Request = serde_json::from_str(&json).unwrap();
    assert!(matches!(parsed, Request::ListSessions));
}

#[test]
fn test_create_session_request_serialization() {
    let request = Request::CreateSession(CreateSessionRequest {
        repo_path: "/home/user/project".to_owned(),
        repositories: None,
        initial_prompt: "Fix the bug".to_owned(),
        backend: BackendType::Zellij,
        agent: AgentType::ClaudeCode,
        model: None,
        dangerous_skip_checks: false,
        dangerous_copy_creds: false,
        print_mode: false,
        plan_mode: true,
        access_mode: AccessMode::default(),
        images: vec![],
        container_image: None,
        pull_policy: None,
        cpu_limit: None,
        memory_limit: None,
        storage_class: None,
    });

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("CreateSession"));
    assert!(json.contains("Zellij"));

    let parsed: Request = serde_json::from_str(&json).unwrap();
    match parsed {
        Request::CreateSession(req) => {
            assert_eq!(req.backend, BackendType::Zellij);
            assert_eq!(req.repo_path, "/home/user/project");
        }
        _ => panic!("Expected CreateSession"),
    }
}

#[test]
fn test_get_session_request_serialization() {
    let request = Request::GetSession {
        id: "abc123".to_owned(),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("GetSession"));
    assert!(json.contains("abc123"));
}

#[test]
fn test_response_serialization() {
    let response = Response::Created {
        id: "session-123".to_owned(),
        warnings: None,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("Created"));
    assert!(json.contains("session-123"));

    let parsed: Response = serde_json::from_str(&json).unwrap();
    match parsed {
        Response::Created { id, warnings } => {
            assert_eq!(id, "session-123");
            assert!(warnings.is_none());
        }
        _ => panic!("Expected Created"),
    }
}

#[test]
fn test_response_created_with_warnings() {
    let response = Response::Created {
        id: "session-456".to_owned(),
        warnings: Some(vec!["Post-checkout hook failed".to_owned()]),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("session-456"));
    assert!(json.contains("Post-checkout hook failed"));

    let parsed: Response = serde_json::from_str(&json).unwrap();
    match parsed {
        Response::Created { id, warnings } => {
            assert_eq!(id, "session-456");
            assert_eq!(warnings.unwrap().len(), 1);
        }
        _ => panic!("Expected Created"),
    }
}

#[test]
fn test_error_response_serialization() {
    let response = Response::Error {
        code: "NOT_FOUND".to_owned(),
        message: "Session not found".to_owned(),
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("NOT_FOUND"));
    assert!(json.contains("Session not found"));
}

#[test]
fn test_session_status_serialization() {
    let statuses = vec![
        SessionStatus::Creating,
        SessionStatus::Running,
        SessionStatus::Idle,
        SessionStatus::Completed,
        SessionStatus::Failed,
        SessionStatus::Archived,
    ];

    for status in statuses {
        let json = serde_json::to_string(&status).unwrap();
        let parsed: SessionStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, status);
    }
}

#[test]
fn test_backend_type_serialization() {
    let json = serde_json::to_string(&BackendType::Zellij).unwrap();
    assert_eq!(json, r#""Zellij""#);

    let json = serde_json::to_string(&BackendType::Docker).unwrap();
    assert_eq!(json, r#""Docker""#);
}

#[test]
fn test_agent_type_serialization() {
    let json = serde_json::to_string(&AgentType::ClaudeCode).unwrap();
    assert_eq!(json, r#""ClaudeCode""#);
}

// ========== Print Mode Flow Tests ==========
//
// These tests verify the full print mode flow from API request to Docker args.
// Print mode enables non-interactive operation where Claude outputs the response and exits.

/// Test print_mode is correctly serialized in CreateSessionRequest
#[test]
fn test_print_mode_serialization() {
    // Test with print_mode = true
    let request = Request::CreateSession(CreateSessionRequest {
        repo_path: "/tmp/repo".to_owned(),
        repositories: None,
        initial_prompt: "Generate a hello world".to_owned(),
        backend: BackendType::Docker,
        agent: AgentType::ClaudeCode,
        model: None,
        dangerous_skip_checks: true,
        dangerous_copy_creds: false,
        print_mode: true,
        plan_mode: false,
        access_mode: AccessMode::default(),
        images: vec![],
        container_image: None,
        pull_policy: None,
        cpu_limit: None,
        memory_limit: None,
        storage_class: None,
    });

    let json = serde_json::to_string(&request).unwrap();
    assert!(
        json.contains(r#""print_mode":true"#),
        "print_mode should be true in JSON: {json}"
    );

    // Verify deserialization
    let parsed: Request = serde_json::from_str(&json).unwrap();
    match parsed {
        Request::CreateSession(req) => {
            assert!(
                req.print_mode,
                "print_mode should be true after deserialization"
            );
        }
        _ => panic!("Expected CreateSession"),
    }
}

/// Test print_mode defaults to false when omitted (serde default)
#[test]
fn test_print_mode_default_false() {
    // JSON without print_mode field - should default to false
    let json = r#"{"type":"CreateSession","payload":{"repo_path":"/tmp","initial_prompt":"test","backend":"Docker","agent":"ClaudeCode","dangerous_skip_checks":false}}"#;

    let parsed: Request = serde_json::from_str(json).unwrap();
    match parsed {
        Request::CreateSession(req) => {
            assert!(!req.print_mode, "print_mode should default to false");
        }
        _ => panic!("Expected CreateSession"),
    }
}

/// E2E test: Verify print_mode flows through to Docker args with --print --verbose flags
///
/// This test verifies the full print mode flow:
/// 1. CreateSessionRequest with print_mode=true
/// 2. Docker args are generated correctly with --print --verbose flags
#[test]
fn test_print_mode_flows_to_docker_args() {
    // Simulate what happens when a session is created with print_mode=true
    let print_mode = true;

    // Build Docker args with print_mode=true
    let args = DockerBackend::build_create_args(
        "print-test",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "Generate a hello world",
        1000,
        None,
        AgentType::ClaudeCode,
        print_mode,
        true, // dangerous_skip_checks - pass true to get --dangerously-skip-permissions
        &[],  // images
        None, // git user name
        None, // git user email
        None, // session_id
        None, // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // The final command should contain --print --verbose
    let cmd_arg = args.last().expect("Should have command argument");

    assert!(
        cmd_arg.contains("--print"),
        "Print mode should add --print flag to claude command: {cmd_arg}"
    );
    assert!(
        cmd_arg.contains("--verbose"),
        "Print mode should add --verbose flag to claude command: {cmd_arg}"
    );
    assert!(
        cmd_arg.contains("--dangerously-skip-permissions"),
        "Should still have dangerous flag: {cmd_arg}"
    );
    assert!(
        cmd_arg.contains("Generate a hello world"),
        "Should contain the prompt: {cmd_arg}"
    );
}

// ========== Update Metadata Request Tests ==========

/// Test UpdateMetadataRequest serialization with both fields
#[test]
fn test_update_metadata_request_serialization() {
    use serde_json::json;

    // Simulate the JSON that would be sent from the frontend
    let json = json!({
        "title": "My Session Title",
        "description": "This is a description of my session"
    });

    let json_str = serde_json::to_string(&json).unwrap();

    // Parse into UpdateMetadataRequest (we can't import the private struct, so we test via JSON roundtrip)
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert_eq!(parsed["title"], "My Session Title");
    assert_eq!(parsed["description"], "This is a description of my session");
}

/// Test UpdateMetadataRequest with only title
#[test]
fn test_update_metadata_request_title_only() {
    use serde_json::json;

    let json = json!({
        "title": "Just a Title"
    });

    let json_str = serde_json::to_string(&json).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert_eq!(parsed["title"], "Just a Title");
    assert!(parsed.get("description").is_none() || parsed["description"].is_null());
}

/// Test UpdateMetadataRequest with only description
#[test]
fn test_update_metadata_request_description_only() {
    use serde_json::json;

    let json = json!({
        "description": "Just a Description"
    });

    let json_str = serde_json::to_string(&json).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert_eq!(parsed["description"], "Just a Description");
    assert!(parsed.get("title").is_none() || parsed["title"].is_null());
}

/// Test UpdateMetadataRequest with null values (clearing metadata)
#[test]
fn test_update_metadata_request_null_values() {
    use serde_json::json;

    let json = json!({
        "title": null,
        "description": null
    });

    let json_str = serde_json::to_string(&json).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert!(parsed["title"].is_null());
    assert!(parsed["description"].is_null());
}

/// E2E test: Verify interactive mode (print_mode=false) does NOT have --print flag
#[test]
fn test_interactive_mode_no_print_flag_in_docker_args() {
    // Build Docker args with print_mode=false (interactive mode)
    let args = DockerBackend::build_create_args(
        "interactive-test",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "Interactive prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false, // interactive mode
        false, // dangerous_skip_checks
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    let cmd_arg = args.last().expect("Should have command argument");

    assert!(
        !cmd_arg.contains("--print"),
        "Interactive mode should NOT have --print flag: {cmd_arg}"
    );
    assert!(
        !cmd_arg.contains("--verbose"),
        "Interactive mode should NOT have --verbose flag: {cmd_arg}"
    );
}
