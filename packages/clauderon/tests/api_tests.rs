//! API integration tests

use clauderon::api::protocol::{CreateSessionRequest, Request, Response};
use clauderon::backends::DockerBackend;
use clauderon::core::{AgentType, BackendType, SessionStatus};
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
        repo_path: "/home/user/project".to_string(),
        initial_prompt: "Fix the bug".to_string(),
        backend: BackendType::Zellij,
        agent: AgentType::Claude,
        dangerous_skip_checks: false,
        print_mode: false,
        plan_mode: true,
        access_mode: Default::default(),
        images: vec![],
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
        id: "abc123".to_string(),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("GetSession"));
    assert!(json.contains("abc123"));
}

#[test]
fn test_response_serialization() {
    let response = Response::Created {
        id: "session-123".to_string(),
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
        id: "session-456".to_string(),
        warnings: Some(vec!["Post-checkout hook failed".to_string()]),
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
        code: "NOT_FOUND".to_string(),
        message: "Session not found".to_string(),
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
    let json = serde_json::to_string(&AgentType::Claude).unwrap();
    assert_eq!(json, r#""Claude""#);
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
        repo_path: "/tmp/repo".to_string(),
        initial_prompt: "Generate a hello world".to_string(),
        backend: BackendType::Docker,
        agent: AgentType::Claude,
        dangerous_skip_checks: true,
        print_mode: true,
        plan_mode: false,
        access_mode: Default::default(),
        images: vec![],
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
    let json = r#"{"type":"CreateSession","payload":{"repo_path":"/tmp","initial_prompt":"test","backend":"Docker","agent":"Claude","dangerous_skip_checks":false}}"#;

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
        print_mode,
        true, // dangerous_skip_checks - pass true to get --dangerously-skip-permissions
        &[],  // images
        None, // git user name
        None, // git user email
        None, // session_id
        None, // http_port
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
        false, // interactive mode
        false, // plan_mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
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
