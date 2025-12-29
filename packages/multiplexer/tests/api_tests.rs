//! API integration tests

use multiplexer::api::protocol::{CreateSessionRequest, Request, Response};
use multiplexer::core::{AgentType, BackendType, SessionStatus};

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
        name: "test-session".to_string(),
        repo_path: "/home/user/project".to_string(),
        initial_prompt: "Fix the bug".to_string(),
        backend: BackendType::Zellij,
        agent: AgentType::ClaudeCode,
        dangerous_skip_checks: false,
    });

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("CreateSession"));
    assert!(json.contains("test-session"));
    assert!(json.contains("Zellij"));

    let parsed: Request = serde_json::from_str(&json).unwrap();
    match parsed {
        Request::CreateSession(req) => {
            assert_eq!(req.name, "test-session");
            assert_eq!(req.backend, BackendType::Zellij);
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
    let json = serde_json::to_string(&AgentType::ClaudeCode).unwrap();
    assert_eq!(json, r#""ClaudeCode""#);

    let json = serde_json::to_string(&AgentType::Codex).unwrap();
    assert_eq!(json, r#""Codex""#);
}
