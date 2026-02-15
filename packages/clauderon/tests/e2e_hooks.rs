#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]
#![allow(clippy::print_stdout, reason = "test output")]
#![allow(clippy::print_stderr, reason = "test output")]
#![allow(clippy::unused_result_ok, reason = "test code")]

//! End-to-end tests for Docker hook HTTP communication
//!
//! These tests verify that:
//! 1. The hook installer correctly creates files inside containers
//! 2. Hook messages can be sent from container to host via HTTP
//!
//! Run with: cargo test --test e2e_hooks -- --include-ignored

mod common;

use std::time::Duration;
use tempfile::TempDir;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Generate a unique container name for tests
fn test_container_name(prefix: &str) -> String {
    format!(
        "clauderon-test-{}-{}",
        prefix,
        &uuid::Uuid::new_v4().to_string()[..8]
    )
}

/// Clean up a container (best effort)
async fn cleanup_container(name: &str) {
    let _ = Command::new("docker")
        .args(["rm", "-f", name])
        .output()
        .await;
}

// =============================================================================
// Hook installer tests
// =============================================================================

#[tokio::test]
#[ignore]
async fn test_hook_installer_creates_files() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = test_container_name("installer");
    let mount_arg = format!("{}:/workspace", temp_dir.path().display());

    // 1. Create container with temp dir as workspace
    let create_output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--rm",
            "--name",
            &container_name,
            "-v",
            &mount_arg,
            "alpine:latest",
            "sleep",
            "30",
        ])
        .output()
        .await
        .expect("Failed to create container");

    if !create_output.status.success() {
        eprintln!(
            "Failed to create container: {}",
            String::from_utf8_lossy(&create_output.stderr)
        );
        return;
    }

    // Install bash (required by hook installer)
    let bash_install = Command::new("docker")
        .args(["exec", &container_name, "apk", "add", "--no-cache", "bash"])
        .output()
        .await
        .expect("Failed to install bash");

    if !bash_install.status.success() {
        cleanup_container(&container_name).await;
        eprintln!(
            "Failed to install bash: {}",
            String::from_utf8_lossy(&bash_install.stderr)
        );
        return;
    }

    // 2. Install hooks
    let install_result = clauderon::hooks::install_hooks_in_container(&container_name).await;

    if let Err(e) = &install_result {
        cleanup_container(&container_name).await;
        panic!("Hook installation failed: {}", e);
    }

    // 3. Verify send_status.sh exists
    let check_script = Command::new("docker")
        .args([
            "exec",
            &container_name,
            "test",
            "-f",
            "/workspace/.clauderon/hooks/send_status.sh",
        ])
        .output()
        .await
        .expect("Failed to check script");

    assert!(check_script.status.success(), "send_status.sh should exist");

    // 4. Verify send_status.sh is executable
    let check_exec = Command::new("docker")
        .args([
            "exec",
            &container_name,
            "test",
            "-x",
            "/workspace/.clauderon/hooks/send_status.sh",
        ])
        .output()
        .await
        .expect("Failed to check executable");

    assert!(
        check_exec.status.success(),
        "send_status.sh should be executable"
    );

    // 5. Verify settings.json exists
    let check_settings = Command::new("docker")
        .args([
            "exec",
            &container_name,
            "test",
            "-f",
            "/workspace/.claude/settings.json",
        ])
        .output()
        .await
        .expect("Failed to check settings");

    assert!(
        check_settings.status.success(),
        "settings.json should exist"
    );

    // 6. Verify settings.json contains hook definitions
    let cat_settings = Command::new("docker")
        .args([
            "exec",
            &container_name,
            "cat",
            "/workspace/.claude/settings.json",
        ])
        .output()
        .await
        .expect("Failed to cat settings");

    let settings_content = String::from_utf8_lossy(&cat_settings.stdout);
    assert!(
        settings_content.contains("PreToolUse"),
        "settings.json should contain PreToolUse hook"
    );
    assert!(
        settings_content.contains("send_status.sh"),
        "settings.json should reference send_status.sh"
    );

    // Cleanup
    cleanup_container(&container_name).await;
}

// =============================================================================
// HTTP hook communication tests
// =============================================================================

/// Test that hooks can send messages via HTTP to the host
/// This is the primary hook communication method for Docker/K8s containers
#[tokio::test]
#[ignore] // Requires Docker
async fn test_http_hook_communication() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    use std::sync::Arc;
    use tokio::sync::Mutex;

    // Start a simple HTTP server on a random port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind TCP listener");
    let port = listener.local_addr().unwrap().port();

    // Store received messages
    let received_messages: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let received_clone = Arc::clone(&received_messages);

    // Spawn HTTP server
    let server_handle = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        // Accept one connection
        if let Ok((mut stream, _)) = listener.accept().await {
            let (reader, mut writer) = stream.split();
            let mut reader = BufReader::new(reader);

            // Read HTTP request
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                    break;
                }
                if line == "\r\n" || line == "\n" {
                    break;
                }
                if line.to_lowercase().starts_with("content-length:") {
                    content_length = line
                        .split(':')
                        .nth(1)
                        .and_then(|s| s.trim().parse().ok())
                        .unwrap_or(0);
                }
            }

            // Read body
            let mut body = vec![0u8; content_length];
            let _ = reader.read_exact(&mut body).await;
            let body_str = String::from_utf8_lossy(&body).to_string();

            // Store received message
            received_clone.lock().await.push(body_str);

            // Send HTTP response
            let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}";
            let _ = writer.write_all(response.as_bytes()).await;
        }
    });

    // Give server time to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    let session_id = uuid::Uuid::new_v4();
    let container_name = test_container_name("http-hook");

    // Start container with hook environment variables
    let create_output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--rm",
            "--name",
            &container_name,
            "-e",
            &format!("CLAUDERON_SESSION_ID={}", session_id),
            "-e",
            &format!("CLAUDERON_HTTP_PORT={}", port),
            // Note: Using host.docker.internal to reach the host from container
            "--add-host=host.docker.internal:host-gateway",
            "alpine:latest",
            "sleep",
            "30",
        ])
        .output()
        .await
        .expect("Failed to start container");

    if !create_output.status.success() {
        eprintln!(
            "Failed to create container: {}",
            String::from_utf8_lossy(&create_output.stderr)
        );
        return;
    }

    // Install curl in container
    let install_output = Command::new("docker")
        .args(["exec", &container_name, "apk", "add", "--no-cache", "curl"])
        .output()
        .await
        .expect("Failed to install curl");

    if !install_output.status.success() {
        cleanup_container(&container_name).await;
        eprintln!(
            "Failed to install curl: {}",
            String::from_utf8_lossy(&install_output.stderr)
        );
        return;
    }

    // Send hook message via curl from inside the container
    let message = format!(
        r#"{{"session_id":"{}","event":{{"type":"PreToolUse"}},"timestamp":"2024-01-01T00:00:00Z"}}"#,
        session_id
    );
    let exec_output = Command::new("docker")
        .args([
            "exec",
            &container_name,
            "curl",
            "-s",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &message,
            &format!("http://host.docker.internal:{}/api/hooks", port),
            "--connect-timeout",
            "5",
        ])
        .output()
        .await
        .expect("Failed to send hook via curl");

    // Wait for server to receive message
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Cleanup
    cleanup_container(&container_name).await;
    server_handle.abort();

    // Verify message was received
    let messages = received_messages.lock().await;
    assert!(
        !messages.is_empty(),
        "Should have received at least one message"
    );
    assert!(
        messages[0].contains(&session_id.to_string()),
        "Message should contain session_id. Got: {}",
        messages[0]
    );
    assert!(
        messages[0].contains("PreToolUse"),
        "Message should contain event type. Got: {}",
        messages[0]
    );

    // Verify curl succeeded
    if !exec_output.status.success() {
        eprintln!(
            "curl stderr: {}",
            String::from_utf8_lossy(&exec_output.stderr)
        );
    }
    assert!(
        exec_output.status.success(),
        "curl should succeed. stderr: {}",
        String::from_utf8_lossy(&exec_output.stderr)
    );
}
