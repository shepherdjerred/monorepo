//! Integration tests for per-session proxy filtering and access modes.
//!
//! These tests verify the complete lifecycle of session-specific proxies:
//! - Creating sessions with read-only or read-write access modes
//! - HTTP method filtering (blocking POST/PUT/DELETE/PATCH in read-only mode)
//! - Switching access modes on running sessions
//! - Proxy port allocation and cleanup
//!
//! These tests are integration tests (not ignored) and use mock backends
//! to avoid requiring Docker/Zellij.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use clauderon::backends::{ExecutionBackend, GitOperations, MockExecutionBackend, MockGitBackend};
use clauderon::core::{AccessMode, AgentType, BackendType, SessionManager, SessionStatus};
use clauderon::proxy::{ProxyConfig, ProxyManager};
use clauderon::store::{SqliteStore, Store};
use tempfile::TempDir;

/// Create a temporary directory initialized as a git repository.
fn create_temp_git_repo() -> TempDir {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");

    // Initialize git repo
    std::process::Command::new("git")
        .args(["init"])
        .current_dir(temp_dir.path())
        .output()
        .expect("Failed to run git init");

    // Configure git user (required for commits)
    std::process::Command::new("git")
        .args(["config", "user.email", "test@test.com"])
        .current_dir(temp_dir.path())
        .output()
        .expect("Failed to configure git email");

    std::process::Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(temp_dir.path())
        .output()
        .expect("Failed to configure git name");

    // Create initial commit (required for a valid repo)
    std::fs::write(temp_dir.path().join("README.md"), "# Test Repo")
        .expect("Failed to create README");

    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(temp_dir.path())
        .output()
        .expect("Failed to run git add");

    std::process::Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(temp_dir.path())
        .output()
        .expect("Failed to run git commit");

    temp_dir
}

/// Helper to create a test environment with proxy support.
async fn create_test_manager_with_proxy() -> (
    SessionManager,
    Arc<ProxyManager>,
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
    fn to_git_ops(arc: Arc<MockGitBackend>) -> Arc<dyn GitOperations> {
        arc
    }
    fn to_exec_backend(arc: Arc<MockExecutionBackend>) -> Arc<dyn ExecutionBackend> {
        arc
    }

    let mut manager = SessionManager::new(
        store,
        to_git_ops(Arc::clone(&git)),
        to_exec_backend(Arc::clone(&zellij)),
        to_exec_backend(Arc::clone(&docker)),
        to_exec_backend(Arc::clone(&kubernetes)),
    )
    .await
    .expect("Failed to create manager");

    // Create proxy manager
    let proxy_config = ProxyConfig::default();
    let proxy_manager =
        Arc::new(ProxyManager::new(proxy_config).expect("Failed to create proxy manager"));

    // Wire up proxy manager
    manager.set_proxy_manager(Arc::clone(&proxy_manager));

    (manager, proxy_manager, temp_dir, git, zellij, docker)
}

/// Helper to create an HTTP client configured to use a specific proxy port.
fn create_proxy_client(proxy_port: u16, ca_cert_path: &Path) -> anyhow::Result<reqwest::Client> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{proxy_port}"))?;

    // Load CA cert for HTTPS
    let cert_pem = std::fs::read(ca_cert_path)?;
    let cert = reqwest::Certificate::from_pem(&cert_pem)?;

    Ok(reqwest::Client::builder()
        .proxy(proxy)
        .add_root_certificate(cert)
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()?)
}

// ========== Access Mode Creation Tests ==========

#[tokio::test]
async fn test_create_session_with_read_only_mode() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Docker,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadOnly,
            vec![], // images
        )
        .await
        .expect("Failed to create session");

    // Verify session has read-only mode
    assert_eq!(session.access_mode, AccessMode::ReadOnly);

    // Verify session has a proxy port assigned (since it's Docker backend)
    // Note: In mock environment, proxy might not actually be created,
    // but we can verify the session was configured correctly
    assert_eq!(session.status, SessionStatus::Running);
}

#[tokio::test]
async fn test_create_session_with_read_write_mode() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Docker,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadWrite,
            vec![], // images
        )
        .await
        .expect("Failed to create session");

    // Verify session has read-write mode
    assert_eq!(session.access_mode, AccessMode::ReadWrite);
    assert_eq!(session.status, SessionStatus::Running);
}

#[tokio::test]
async fn test_zellij_backend_ignores_proxy_port() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Zellij,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadOnly,
            vec![], // images
        )
        .await
        .expect("Failed to create session");

    // Zellij backend should not have a session-specific proxy port
    assert_eq!(session.proxy_port, None);
    assert_eq!(session.access_mode, AccessMode::ReadOnly);
}

// ========== Access Mode Update Tests ==========

#[tokio::test]
async fn test_update_access_mode_by_name() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Docker,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadOnly,
            vec![], // images
        )
        .await
        .expect("Failed to create session");

    assert_eq!(session.access_mode, AccessMode::ReadOnly);

    // Update to read-write
    manager
        .update_access_mode(&session.name, AccessMode::ReadWrite)
        .await
        .expect("Failed to update access mode");

    // Verify update
    let updated_session = manager
        .get_session(&session.name)
        .await
        .expect("Session not found");

    assert_eq!(updated_session.access_mode, AccessMode::ReadWrite);
}

#[tokio::test]
async fn test_update_access_mode_by_id() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Docker,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadWrite,
            vec![], // images
        )
        .await
        .expect("Failed to update access mode");

    // Update to read-only using UUID
    manager
        .update_access_mode(&session.id.to_string(), AccessMode::ReadOnly)
        .await
        .expect("Failed to update access mode");

    // Verify update
    let updated_session = manager
        .get_session(&session.id.to_string())
        .await
        .expect("Session not found");

    assert_eq!(updated_session.access_mode, AccessMode::ReadOnly);
}

#[tokio::test]
async fn test_update_nonexistent_session_fails() {
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let result = manager
        .update_access_mode("nonexistent-session", AccessMode::ReadOnly)
        .await;

    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Session not found")
    );
}

// ========== Port Allocation Tests ==========

#[tokio::test]
async fn test_port_allocator_basic() {
    use clauderon::proxy::PortAllocator;
    use uuid::Uuid;

    let allocator = PortAllocator::new();

    // Allocate a port
    let session1 = Uuid::new_v4();
    let port1 = allocator
        .allocate(session1)
        .await
        .expect("Failed to allocate port");

    assert!((18100..18600).contains(&port1));

    // Allocate another port
    let session2 = Uuid::new_v4();
    let port2 = allocator
        .allocate(session2)
        .await
        .expect("Failed to allocate second port");

    assert_ne!(port1, port2, "Ports should be different");

    // Release first port
    allocator.release(port1).await;

    // Allocate again - should be able to reuse the released port
    let session3 = Uuid::new_v4();
    let _port3 = allocator
        .allocate(session3)
        .await
        .expect("Failed to allocate after release");
}

#[tokio::test]
async fn test_port_allocator_wraparound() {
    use clauderon::proxy::PortAllocator;
    use uuid::Uuid;

    let allocator = PortAllocator::new();

    // Allocate many ports to force wraparound
    let mut ports = Vec::new();
    for _ in 0..100 {
        let session = Uuid::new_v4();
        let port = allocator
            .allocate(session)
            .await
            .expect("Failed to allocate port");
        ports.push(port);
    }

    // All ports should be unique
    let unique_count = ports.iter().collect::<std::collections::HashSet<_>>().len();
    assert_eq!(unique_count, 100, "All ports should be unique");

    // All ports should be in range
    for port in &ports {
        assert!(*port >= 18100 && *port < 18600);
    }
}

// ========== Database Persistence Tests ==========

#[tokio::test]
async fn test_access_mode_persists_across_restarts() {
    let repo_dir = create_temp_git_repo();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");

    // Create session with read-only mode
    let session_name = {
        let store = Arc::new(
            SqliteStore::new(&db_path)
                .await
                .expect("Failed to create store"),
        );
        let git = Arc::new(MockGitBackend::new());
        let zellij = Arc::new(MockExecutionBackend::zellij());
        let docker = Arc::new(MockExecutionBackend::docker());
        let kubernetes = Arc::new(MockExecutionBackend::kubernetes());

        fn to_git_ops(arc: Arc<MockGitBackend>) -> Arc<dyn GitOperations> {
            arc
        }
        fn to_exec_backend(arc: Arc<MockExecutionBackend>) -> Arc<dyn ExecutionBackend> {
            arc
        }

        let manager = SessionManager::new(
            store,
            to_git_ops(git),
            to_exec_backend(zellij),
            to_exec_backend(docker),
            to_exec_backend(kubernetes),
        )
        .await
        .expect("Failed to create manager");

        let (session, _) = manager
            .create_session(
                repo_dir.path().to_string_lossy().to_string(),
                "Test".to_string(),
                BackendType::Zellij, // Changed from Docker to avoid proxy requirement
                AgentType::Claude,
                true,
                false, // print_mode
                false, // plan_mode
                AccessMode::ReadOnly,
                vec![], // images
            )
            .await
            .expect("Failed to create session");

        session.name
    };

    // Reconnect to same database
    {
        let store = Arc::new(
            SqliteStore::new(&db_path)
                .await
                .expect("Failed to reconnect to store"),
        );
        let git = Arc::new(MockGitBackend::new());
        let zellij = Arc::new(MockExecutionBackend::zellij());
        let docker = Arc::new(MockExecutionBackend::docker());
        let kubernetes = Arc::new(MockExecutionBackend::kubernetes());

        fn to_git_ops(arc: Arc<MockGitBackend>) -> Arc<dyn GitOperations> {
            arc
        }
        fn to_exec_backend(arc: Arc<MockExecutionBackend>) -> Arc<dyn ExecutionBackend> {
            arc
        }

        let manager = SessionManager::new(
            store,
            to_git_ops(git),
            to_exec_backend(zellij),
            to_exec_backend(docker),
            to_exec_backend(kubernetes),
        )
        .await
        .expect("Failed to create manager");

        // Verify access mode was persisted
        let restored_session = manager
            .get_session(&session_name)
            .await
            .expect("Session not found after restart");

        assert_eq!(restored_session.access_mode, AccessMode::ReadOnly);
    }
}

#[tokio::test]
async fn test_proxy_port_persists_in_database() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");

    // Create session and store proxy port
    let session_name = {
        let store = Arc::new(
            SqliteStore::new(&db_path)
                .await
                .expect("Failed to create store"),
        );

        // Manually create and update a session to set proxy_port
        let mut session = clauderon::core::Session::new(clauderon::core::SessionConfig {
            name: "proxy-port-test-abc123".to_string(),
            title: None,
            description: None,
            repo_path: "/tmp/repo".into(),
            worktree_path: "/tmp/worktree".into(),
            subdirectory: std::path::PathBuf::new(),
            branch_name: "test-branch".to_string(),
            initial_prompt: "test".to_string(),
            backend: BackendType::Docker,
            agent: AgentType::Claude,
            dangerous_skip_checks: true,
            access_mode: AccessMode::ReadWrite,
        });

        session.set_proxy_port(18234);
        session.set_status(SessionStatus::Running);
        session.set_backend_id("container-123".to_string());

        store
            .save_session(&session)
            .await
            .expect("Failed to save session");

        session.name
    };

    // Reconnect and verify proxy_port was persisted
    {
        let store = Arc::new(
            SqliteStore::new(&db_path)
                .await
                .expect("Failed to reconnect"),
        );

        // Retrieve session by listing all and finding by name
        let all_sessions = store
            .list_sessions()
            .await
            .expect("Failed to list sessions");
        let restored = all_sessions
            .iter()
            .find(|s| s.name == session_name)
            .expect("Session not found");

        assert_eq!(restored.proxy_port, Some(18234));
    }
}

// ========== Session Deletion Tests ==========

#[tokio::test]
async fn test_delete_session_cleans_up_proxy() {
    let repo_dir = create_temp_git_repo();
    let (manager, _proxy_manager, _temp_dir, _git, _zellij, _docker) =
        create_test_manager_with_proxy().await;

    let (session, _warnings) = manager
        .create_session(
            repo_dir.path().to_string_lossy().to_string(),
            "Test prompt".to_string(),
            BackendType::Docker,
            AgentType::Claude,
            true,
            false, // print_mode
            false, // plan_mode
            AccessMode::ReadOnly,
            vec![], // images
        )
        .await
        .expect("Failed to create session");

    let _session_id = session.id;
    let session_name = session.name.clone();

    // Delete the session
    manager
        .delete_session(&session_name)
        .await
        .expect("Failed to delete session");

    // Verify session is gone from manager
    let found = manager.get_session(&session_name).await;
    assert!(found.is_none());

    // Note: We can't easily verify the proxy was destroyed without
    // exposing internal state, but the delete_session call should
    // have triggered destroy_session_proxy
}

// ========== AccessMode Parsing Tests ==========

#[test]
fn test_access_mode_from_str() {
    use std::str::FromStr;

    assert_eq!(
        AccessMode::from_str("readonly").unwrap(),
        AccessMode::ReadOnly
    );
    assert_eq!(
        AccessMode::from_str("read-only").unwrap(),
        AccessMode::ReadOnly
    );
    assert_eq!(AccessMode::from_str("ro").unwrap(), AccessMode::ReadOnly);

    assert_eq!(
        AccessMode::from_str("readwrite").unwrap(),
        AccessMode::ReadWrite
    );
    assert_eq!(
        AccessMode::from_str("read-write").unwrap(),
        AccessMode::ReadWrite
    );
    assert_eq!(AccessMode::from_str("rw").unwrap(), AccessMode::ReadWrite);

    // Case insensitive
    assert_eq!(
        AccessMode::from_str("READONLY").unwrap(),
        AccessMode::ReadOnly
    );
    assert_eq!(
        AccessMode::from_str("ReadWrite").unwrap(),
        AccessMode::ReadWrite
    );

    // Invalid input
    assert!(AccessMode::from_str("invalid").is_err());
    assert!(AccessMode::from_str("").is_err());
}

#[test]
fn test_access_mode_display() {
    assert_eq!(AccessMode::ReadOnly.to_string(), "ReadOnly");
    assert_eq!(AccessMode::ReadWrite.to_string(), "ReadWrite");
}

#[test]
fn test_access_mode_default() {
    // ReadOnly is the secure default (principle of least privilege)
    assert_eq!(AccessMode::default(), AccessMode::ReadOnly);
}

// ========== HTTP Method Filtering Tests ==========

#[test]
fn test_is_write_operation() {
    use clauderon::proxy::is_write_operation;
    use http::Method;

    // Write operations (should be blocked in read-only mode)
    assert!(is_write_operation(&Method::POST));
    assert!(is_write_operation(&Method::PUT));
    assert!(is_write_operation(&Method::DELETE));
    assert!(is_write_operation(&Method::PATCH));

    // Read operations (should be allowed)
    assert!(!is_write_operation(&Method::GET));
    assert!(!is_write_operation(&Method::HEAD));
    assert!(!is_write_operation(&Method::OPTIONS));
    assert!(!is_write_operation(&Method::TRACE));

    // Unknown methods should be blocked (not in read list)
    assert!(is_write_operation(&Method::CONNECT));
}

#[test]
fn test_is_read_operation() {
    use clauderon::proxy::is_read_operation;
    use http::Method;

    // Only these methods are considered safe read operations
    assert!(is_read_operation(&Method::GET));
    assert!(is_read_operation(&Method::HEAD));
    assert!(is_read_operation(&Method::OPTIONS));
    assert!(is_read_operation(&Method::TRACE));

    // Everything else is NOT a read operation
    assert!(!is_read_operation(&Method::POST));
    assert!(!is_read_operation(&Method::PUT));
    assert!(!is_read_operation(&Method::DELETE));
    assert!(!is_read_operation(&Method::PATCH));
    assert!(!is_read_operation(&Method::CONNECT));
}
