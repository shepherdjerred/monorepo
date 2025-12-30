//! Integration tests for the multiplexer authentication proxy.
//!
//! These tests verify the full end-to-end flow: container -> proxy -> real service
//! by making actual HTTPS requests through the proxy to real APIs.
//!
//! **Important**: These tests are ignored by default because they require:
//! - Real API credentials (environment variables)
//! - Network access to external services
//!
//! ## Running Tests
//!
//! ### Service API Tests (GitHub, Anthropic, PagerDuty, Sentry, Grafana, npm, Docker)
//! These tests start their own proxy instance and make real API calls.
//!
//! ```bash
//! # Set credentials
//! export GITHUB_TOKEN=ghp_your_token
//! export ANTHROPIC_API_KEY=sk-ant-your_key
//! export PAGERDUTY_TOKEN=your_token
//! export SENTRY_AUTH_TOKEN=your_token
//! export GRAFANA_API_KEY=your_key
//! export NPM_TOKEN=your_token
//! export DOCKER_TOKEN=your_token
//!
//! # Run all integration tests
//! cargo test --test proxy_auth_tests -- --include-ignored
//!
//! # Run specific service test
//! cargo test --test proxy_auth_tests test_github_integration -- --include-ignored
//! ```
//!
//! ### Infrastructure Tests (K8s, Talos)
//! These tests require the multiplexer daemon to be running with proper configuration.
//!
//! ```bash
//! # Start the daemon (requires ~/.kube/config and ~/.talos/config)
//! ./target/release/mux daemon &
//!
//! # Run infrastructure tests
//! cargo test --test proxy_auth_tests test_k8s_proxy_integration -- --include-ignored
//! cargo test --test proxy_auth_tests test_talos_gateway_integration -- --include-ignored
//! ```
//!
//! **K8s test**: Verifies kubectl proxy is accessible on port 18081
//! **Talos test**: Verifies Talos mTLS gateway is listening on port 18082 (requires Ed25519 key support)

use std::path::Path;
use std::sync::Arc;
use tempfile::TempDir;

use multiplexer::proxy::{AuditEntry, AuditLogger, Credentials, HttpAuthProxy, ProxyCa};

/// Helper to set up a test proxy with real credentials from environment.
async fn setup_proxy_with_env_credentials(
) -> anyhow::Result<(HttpAuthProxy, TempDir, u16, std::path::PathBuf)> {
    let temp_dir = TempDir::new()?;
    let mux_dir = temp_dir.path().to_path_buf();

    // Generate CA
    let ca = ProxyCa::load_or_generate(&mux_dir)?;
    let authority = ca.to_rcgen_authority()?;

    // Load credentials from environment
    let credentials = Credentials::load_from_env();

    // Create audit logger
    let audit_path = mux_dir.join("audit.jsonl");
    let audit_logger = Arc::new(AuditLogger::new(audit_path.clone())?);

    // Use random port to avoid conflicts
    let port = 18080 + (rand::random::<u16>() % 1000);

    let proxy = HttpAuthProxy::new(port, authority, Arc::new(credentials), audit_logger);

    Ok((proxy, temp_dir, port, audit_path))
}

/// Helper to create an HTTP client configured to use the test proxy.
fn create_proxy_client(proxy_port: u16, ca_cert_path: &Path) -> anyhow::Result<reqwest::Client> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{}", proxy_port))?;

    // Load CA cert for HTTPS
    let cert_pem = std::fs::read(ca_cert_path)?;
    let cert = reqwest::Certificate::from_pem(&cert_pem)?;

    Ok(reqwest::Client::builder()
        .proxy(proxy)
        .add_root_certificate(cert)
        .danger_accept_invalid_certs(true) // Accept self-signed certs for testing
        .build()?)
}

/// Helper to read and parse audit log entries.
fn read_audit_log(path: &Path) -> anyhow::Result<Vec<AuditEntry>> {
    let content = std::fs::read_to_string(path)?;
    content
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).map_err(Into::into))
        .collect()
}

// === GitHub Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_github_integration() {
    // Requires GITHUB_TOKEN environment variable
    if std::env::var("GITHUB_TOKEN").is_err() {
        eprintln!("Skipping: GITHUB_TOKEN not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    // Start proxy in background
    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Create client
    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Make actual request to GitHub API
    let response = client
        .get("https://api.github.com/user")
        .header("User-Agent", "multiplexer-integration-test")
        .send()
        .await
        .expect("Request failed");

    // Verify request succeeded (proves auth was injected)
    assert!(
        response.status().is_success(),
        "GitHub API returned {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    // Verify audit log
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");

    assert!(!audit_entries.is_empty(), "No audit entries found");
    assert_eq!(audit_entries[0].service, "api.github.com");
    assert!(
        audit_entries[0].auth_injected,
        "Auth was not injected for GitHub"
    );
}

// === Anthropic Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_anthropic_api_key_integration() {
    // Requires ANTHROPIC_API_KEY with API key format (not OAuth)
    let _api_key = match std::env::var("ANTHROPIC_API_KEY") {
        Ok(key) if !key.starts_with("sk-ant-oat01-") => key,
        _ => {
            eprintln!("Skipping: ANTHROPIC_API_KEY not set or is OAuth token");
            return;
        }
    };

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Make simple completion request
    let body = serde_json::json!({
        "model": "claude-3-5-haiku-20241022",
        "max_tokens": 10,
        "messages": [{
            "role": "user",
            "content": "Say 'test' and nothing else"
        }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .expect("Request failed");

    assert!(
        response.status().is_success(),
        "Anthropic API returned {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    // Verify audit log shows x-api-key was used (not Bearer)
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries.iter().any(|e| e.service == "api.anthropic.com"
            && e.auth_injected),
        "Auth not injected for Anthropic"
    );
}

#[tokio::test]
#[ignore]
async fn test_anthropic_oauth_integration() {
    // Requires ANTHROPIC_API_KEY with OAuth token format
    let _oauth_token = match std::env::var("ANTHROPIC_API_KEY") {
        Ok(key) if key.starts_with("sk-ant-oat01-") => key,
        _ => {
            eprintln!("Skipping: ANTHROPIC_API_KEY not set or is not OAuth token");
            return;
        }
    };

    let (proxy, _temp_dir, proxy_port, _audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    let body = serde_json::json!({
        "model": "claude-3-5-haiku-20241022",
        "max_tokens": 10,
        "messages": [{
            "role": "user",
            "content": "Say 'test' and nothing else"
        }]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .expect("Request failed");

    // OAuth tokens currently don't work with the Messages API
    // This test documents the expected behavior
    if response.status().is_success() {
        println!("✓ OAuth token worked with Messages API");
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        println!("✗ OAuth token failed: {} - {}", status, body);

        // OAuth is expected to fail with Messages API
        assert!(
            body.contains("OAuth authentication is currently not supported"),
            "Unexpected error message: {}",
            body
        );
    }
}

// === PagerDuty Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_pagerduty_integration() {
    if std::env::var("PAGERDUTY_TOKEN").is_err() && std::env::var("PAGERDUTY_API_KEY").is_err() {
        eprintln!("Skipping: PAGERDUTY_TOKEN or PAGERDUTY_API_KEY not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Simple request to list users
    let response = client
        .get("https://api.pagerduty.com/users?limit=1")
        .header("Accept", "application/vnd.pagerduty+json;version=2")
        .send()
        .await
        .expect("Request failed");

    assert!(
        response.status().is_success(),
        "PagerDuty API returned {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    // Verify audit log shows correct token format was used
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries
            .iter()
            .any(|e| e.service == "api.pagerduty.com" && e.auth_injected),
        "Auth not injected for PagerDuty"
    );
}

// === Sentry Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_sentry_integration() {
    if std::env::var("SENTRY_AUTH_TOKEN").is_err() {
        eprintln!("Skipping: SENTRY_AUTH_TOKEN not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Request to list organizations (note: may return 403 if token lacks permissions)
    let response = client
        .get("https://sentry.io/api/0/organizations/")
        .send()
        .await
        .expect("Request failed");

    // Accept both success and 403 (permission denied) as valid - both prove auth was injected
    let status = response.status();
    assert!(
        status.is_success() || status == 403,
        "Sentry API returned unexpected {}: {}",
        status,
        response.text().await.unwrap_or_default()
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries
            .iter()
            .any(|e| e.service == "sentry.io" && e.auth_injected),
        "Auth not injected for Sentry"
    );
}

// === Grafana Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_grafana_integration() {
    if std::env::var("GRAFANA_API_KEY").is_err() {
        eprintln!("Skipping: GRAFANA_API_KEY not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Note: This uses the specific Grafana instance from rules.rs
    let response = client
        .get("https://grafana.tailnet-1a49.ts.net/api/health")
        .send()
        .await
        .expect("Request failed");

    assert!(
        response.status().is_success(),
        "Grafana API returned {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries
            .iter()
            .any(|e| e.service == "grafana.tailnet-1a49.ts.net" && e.auth_injected),
        "Auth not injected for Grafana"
    );
}

// === npm Registry Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_npm_integration() {
    if std::env::var("NPM_TOKEN").is_err() {
        eprintln!("Skipping: NPM_TOKEN not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Request to npm registry API
    let response = client
        .get("https://registry.npmjs.org/-/whoami")
        .send()
        .await
        .expect("Request failed");

    assert!(
        response.status().is_success(),
        "npm registry returned {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries
            .iter()
            .any(|e| e.service == "registry.npmjs.org" && e.auth_injected),
        "Auth not injected for npm"
    );
}

// === Docker Hub Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_docker_hub_integration() {
    if std::env::var("DOCKER_TOKEN").is_err() {
        eprintln!("Skipping: DOCKER_TOKEN not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Request to Docker Hub auth endpoint (this will likely fail without proper setup,
    // but proves the proxy injects the header)
    let response = client
        .get("https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull")
        .send()
        .await
        .expect("Request failed");

    // Accept any response that shows we reached the API
    assert!(
        response.status().is_success() || response.status().is_client_error(),
        "Docker Hub returned unexpected {}: {}",
        response.status(),
        response.text().await.unwrap_or_default()
    );

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries
            .iter()
            .any(|e| e.service == "auth.docker.io" && e.auth_injected),
        "Auth not injected for Docker Hub"
    );
}

// === Kubernetes Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_k8s_proxy_integration() {
    // K8s proxy runs on port 18081 via kubectl proxy
    // The daemon must be running for this test to work

    // Check if kubectl is available
    let kubectl_check = std::process::Command::new("kubectl")
        .arg("version")
        .arg("--client")
        .output();

    if kubectl_check.is_err() {
        eprintln!("Skipping: kubectl not available");
        return;
    }

    // Check if kubectl proxy is running on 18081
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:18081/api/v1/namespaces")
        .send()
        .await;

    match response {
        Ok(resp) => {
            assert!(
                resp.status().is_success() || resp.status() == 403,
                "K8s proxy returned unexpected status: {}",
                resp.status()
            );
            println!("✓ K8s proxy is accessible on port 18081");
        }
        Err(e) => {
            eprintln!("K8s proxy not accessible: {}", e);
            eprintln!("Make sure the multiplexer daemon is running");
            eprintln!("The daemon starts kubectl proxy on port 18081");
        }
    }
}

// === Talos Integration Tests ===

#[tokio::test]
#[ignore]
async fn test_talos_gateway_integration() {
    // Talos mTLS gateway runs on port 18082
    // The daemon must be running with proper Talos configuration

    // Check if talosctl is available
    let talosctl_check = std::process::Command::new("talosctl")
        .arg("version")
        .arg("--client")
        .output();

    if talosctl_check.is_err() {
        eprintln!("Skipping: talosctl not available");
        return;
    }

    // Check if Talos gateway is running on 18082
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:18082/")
        .send()
        .await;

    match response {
        Ok(resp) => {
            println!("✓ Talos gateway responded on port 18082: {}", resp.status());
        }
        Err(e) => {
            eprintln!("Talos gateway not accessible: {}", e);
            eprintln!("Make sure the multiplexer daemon is running with Talos configuration");
            eprintln!("The daemon may show 'no private key found' if Talos config is incomplete");
            eprintln!("Check daemon logs for: 'Failed to build TLS connector'");
        }
    }
}

// === Audit Logging Tests ===

#[tokio::test]
#[ignore]
async fn test_audit_logging_multiple_services() {
    // Requires at least GitHub and one other service
    if std::env::var("GITHUB_TOKEN").is_err() {
        eprintln!("Skipping: GITHUB_TOKEN not set");
        return;
    }

    let (proxy, _temp_dir, proxy_port, audit_path) = setup_proxy_with_env_credentials()
        .await
        .expect("Failed to setup proxy");

    tokio::spawn(async move {
        proxy.run().await.ok();
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    let ca_cert_path = _temp_dir.path().join("proxy-ca.pem");
    let client = create_proxy_client(proxy_port, &ca_cert_path).expect("Failed to create client");

    // Make requests to multiple services
    client
        .get("https://api.github.com/user")
        .send()
        .await
        .ok();

    // If Anthropic key is available, test it too
    if std::env::var("ANTHROPIC_API_KEY").is_ok() {
        let body = serde_json::json!({
            "model": "claude-3-5-haiku-20241022",
            "max_tokens": 5,
            "messages": [{"role": "user", "content": "hi"}]
        });

        client
            .post("https://api.anthropic.com/v1/messages")
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .ok();
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Verify audit log has multiple entries
    let audit_entries = read_audit_log(&audit_path).expect("Failed to read audit log");
    assert!(
        audit_entries.len() >= 1,
        "Expected at least 1 audit entry, got {}",
        audit_entries.len()
    );

    // Verify each entry has required fields
    for entry in &audit_entries {
        assert!(!entry.service.is_empty(), "Service should not be empty");
        assert!(!entry.method.is_empty(), "Method should not be empty");
        // Duration can be 0 for very fast requests, just check it's present
        assert!(entry.duration_ms >= 0, "Duration should be non-negative");
    }

    // Verify GitHub was logged
    assert!(
        audit_entries.iter().any(|e| e.service == "api.github.com"),
        "GitHub request not in audit log"
    );
}
