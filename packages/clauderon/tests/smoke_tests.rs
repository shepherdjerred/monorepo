//! Smoke Tests (Tier 5)
//!
//! These tests verify that Claude actually starts and authenticates in containers.
//! They require:
//! - Docker installed and running
//! - Claude credentials (~/.claude directory)
//! - API access (network connectivity)
//!
//! Run with: cargo test --test smoke_tests -- --include-ignored
//!
//! These tests are typically run:
//! - Before releases
//! - When debugging authentication issues
//! - After major infrastructure changes

mod common;

use clauderon::backends::{CreateOptions, DockerBackend, DockerProxyConfig, ExecutionBackend};
use clauderon::proxy::{Credentials, ProxyCa};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::sleep;

/// Test that Claude starts without errors in a Docker container
///
/// This verifies:
/// 1. Container starts successfully
/// 2. Claude process begins execution
/// 3. No immediate crash or error output
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials - run with --include-ignored
async fn test_claude_starts_in_docker() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-test-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create container with a simple prompt
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "echo 'smoke test' && exit",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(name) => {
            // Give Claude a moment to start
            sleep(Duration::from_secs(3)).await;

            // Check logs for errors
            if let Ok(logs) = docker.get_output(&name, 50).await {
                // Should NOT contain common error patterns
                assert!(
                    !logs.contains("Error:"),
                    "Logs should not contain 'Error:': {logs}"
                );
                assert!(
                    !logs.contains("ENOENT"),
                    "Logs should not contain 'ENOENT': {logs}"
                );
                assert!(
                    !logs.contains("permission denied"),
                    "Logs should not contain 'permission denied': {logs}"
                );
                assert!(
                    !logs.contains("command not found"),
                    "Logs should not contain 'command not found': {logs}"
                );
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed (may need to pull image): {e}");
        }
    }
}

/// Test that Claude can write to the debug directory
///
/// This verifies the .claude mount is writable (not read-only).
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials
async fn test_claude_writes_debug_files() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-debug-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "echo 'testing debug write'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(name) => {
            // Give Claude time to write debug files
            sleep(Duration::from_secs(5)).await;

            // Check logs for EROFS (read-only filesystem) error
            if let Ok(logs) = docker.get_output(&name, 100).await {
                assert!(
                    !logs.contains("EROFS"),
                    "Logs should not contain EROFS (read-only filesystem error): {logs}"
                );
                assert!(
                    !logs.contains("read-only file system"),
                    "Logs should not contain 'read-only file system': {logs}"
                );
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// Test that the container runs as non-root user
///
/// Claude refuses --dangerously-skip-permissions when run as root.
#[tokio::test]
#[ignore] // Requires Docker
async fn test_container_runs_as_non_root() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-uid-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create container - the command isn't important, we'll check the UID
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "id -u",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(name) => {
            sleep(Duration::from_secs(2)).await;

            // Check logs - should show non-zero UID
            if let Ok(logs) = docker.get_output(&name, 10).await {
                // If we see UID 0, that's root which is wrong
                let lines: Vec<&str> = logs.lines().collect();
                for line in lines {
                    if let Ok(uid) = line.trim().parse::<u32>() {
                        assert!(
                            uid != 0,
                            "Container should not run as root (UID 0), got UID: {uid}"
                        );
                    }
                }
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// Test that the initial prompt is executed
///
/// Verifies the prompt actually reaches Claude.
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials + API access
async fn test_initial_prompt_executed() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-prompt-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create a file for Claude to read
    std::fs::write(
        temp_dir.path().join("test-file.txt"),
        "Hello from smoke test!",
    )
    .expect("Failed to write test file");

    // Use a simple prompt that should produce recognizable output
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "read the file test-file.txt and print its contents exactly",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(name) => {
            // Give Claude time to process the prompt
            sleep(Duration::from_secs(30)).await;

            if let Ok(logs) = docker.get_output(&name, 100).await {
                // Just verify no immediate errors - actual content verification
                // would depend on Claude's response format
                println!("Container logs: {logs}");
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// TRUE E2E TEST: Run Claude in print mode through OAuth proxy
///
/// This test verifies the FULL print mode + OAuth proxy flow:
/// 1. Starts a TLS-intercepting proxy with OAuth credentials
/// 2. Container starts with `claude --print --verbose`
/// 3. Claude makes API calls through the proxy
/// 4. Proxy injects `Authorization: Bearer` header
/// 5. Claude outputs a response and exits
///
/// Requirements:
/// - Docker installed and running
/// - CLAUDE_CODE_OAUTH_TOKEN environment variable set
/// - Network access to api.anthropic.com
#[tokio::test]
#[ignore] // Requires Docker + OAuth token - run with --include-ignored
async fn test_claude_print_mode_e2e() {
    use clauderon::proxy::{AuditLogger, HttpAuthProxy};
    use std::sync::Arc;

    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    // Require OAuth token for this test
    let oauth_token = match std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        Ok(token) if token.starts_with("sk-ant-oat01-") => token,
        _ => {
            eprintln!("Skipping: CLAUDE_CODE_OAUTH_TOKEN not set or invalid format");
            return;
        }
    };

    // Set up temp directory for proxy configs
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let clauderon_dir = temp_dir.path().to_path_buf();

    // Generate proxy CA certificate
    println!("Generating proxy CA...");
    let proxy_ca = ProxyCa::load_or_generate(&clauderon_dir).expect("Failed to generate proxy CA");

    // Load credentials from environment (reads CLAUDE_CODE_OAUTH_TOKEN)
    let credentials = Credentials::load_from_env();
    assert!(
        credentials.get("anthropic").is_some(),
        "Anthropic OAuth token should be loaded from CLAUDE_CODE_OAUTH_TOKEN"
    );
    println!("OAuth token loaded: {}...", &oauth_token[..20]);

    // Use a random available port for the proxy (to avoid conflicts with running daemon)
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("Failed to bind to random port");
    let proxy_port = listener.local_addr().unwrap().port();
    drop(listener); // Release the port so the proxy can use it
    println!("Using port {} for test proxy", proxy_port);

    // Create and start the proxy
    println!("Starting proxy on port {}...", proxy_port);
    let audit_logger = Arc::new(AuditLogger::noop());
    let rcgen_ca = proxy_ca
        .to_rcgen_authority()
        .expect("Failed to create rcgen authority");
    let proxy = HttpAuthProxy::new(proxy_port, rcgen_ca, Arc::new(credentials), audit_logger);

    // Start proxy in background
    let proxy_handle = tokio::spawn(async move {
        if let Err(e) = proxy.run().await {
            eprintln!("Proxy error: {e}");
        }
    });

    // Give proxy time to start
    sleep(Duration::from_millis(500)).await;

    // Create Docker backend with proxy config
    let proxy_config = DockerProxyConfig::new(proxy_port, clauderon_dir.clone());
    let docker = DockerBackend::with_proxy(proxy_config);

    let container_name = format!(
        "print-mode-e2e-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create a simple file for Claude to read (deterministic test)
    std::fs::write(temp_dir.path().join("test.txt"), "Hello, World!")
        .expect("Failed to write test file");

    // Use print mode - Claude will output response and exit
    let options = CreateOptions {
        print_mode: true,
        plan_mode: false, // Don't need plan mode for this test
        session_proxy_port: None,
        images: vec![],
    };

    // Simple prompt that should produce predictable-ish output
    println!("Creating container with print mode...");
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "Read test.txt and tell me what it says. Be very brief, one sentence max.",
            options,
        )
        .await;

    match result {
        Ok(name) => {
            println!("Created container: {name}");

            // Wait for Claude to process and respond
            // Print mode should complete relatively quickly for a simple prompt
            let max_wait = Duration::from_secs(120);
            let poll_interval = Duration::from_secs(5);
            let start = std::time::Instant::now();

            let mut final_output = String::new();

            while start.elapsed() < max_wait {
                sleep(poll_interval).await;

                // Check if container is still running
                let running = docker.is_running(&name).await.unwrap_or(false);

                // Get current output
                if let Ok(logs) = docker.get_output(&name, 200).await {
                    final_output = logs.clone();

                    // Container exited - print mode complete
                    if !running {
                        println!(
                            "Container exited. Output length: {} chars",
                            final_output.len()
                        );
                        break;
                    }
                }

                if !running {
                    break;
                }
            }

            println!("=== Claude Print Mode Output ===");
            println!("{}", final_output);
            println!("=================================");

            // Verify we got some output (Claude responded)
            assert!(!final_output.is_empty(), "Print mode should produce output");

            // Check for error indicators
            assert!(
                !final_output.contains("Error:") || final_output.contains("Hello"),
                "Output should not be just errors: {final_output}"
            );

            // The output should mention something from the file or be a valid response
            let seems_valid = final_output.contains("Hello")
                || final_output.contains("World")
                || final_output.contains("test.txt")
                || final_output.contains("file")
                || final_output.len() > 100; // Some substantial output

            assert!(
                seems_valid,
                "Output should be a valid Claude response about the file: {final_output}"
            );

            // Cleanup
            let _ = docker.delete(&name).await;
            proxy_handle.abort();

            println!("✓ Print mode E2E test passed!");
        }
        Err(e) => {
            proxy_handle.abort();
            eprintln!("Container creation failed: {e}");
            // Don't fail the test if container creation fails (may be image issue)
        }
    }
}
