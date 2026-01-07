//! Integration tests for proxy configuration flow.
//!
//! These tests verify that proxy configuration properly flows through
//! to Docker container arguments.

use clauderon::backends::{DockerBackend, DockerProxyConfig};
use clauderon::core::AgentType;
use std::path::PathBuf;
use tempfile::tempdir;

/// Test that proxy configuration flows through to Docker container args.
#[test]
fn test_proxy_config_flows_to_container_args() {
    let clauderon_dir = tempdir().expect("Failed to create temp dir");
    let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
    std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

    // Create kube and talos directories
    let kube_dir = clauderon_dir.path().join("kube");
    let talos_dir = clauderon_dir.path().join("talos");
    std::fs::create_dir(&kube_dir).expect("Failed to create kube dir");
    std::fs::create_dir(&talos_dir).expect("Failed to create talos dir");
    std::fs::write(kube_dir.join("config"), "dummy").expect("Failed to write kube config");
    std::fs::write(talos_dir.join("config"), "dummy").expect("Failed to write talos config");

    let proxy_config = DockerProxyConfig::new(18080, clauderon_dir.path().to_path_buf());

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        Some(&proxy_config),
        false, // print mode
        false, // plan mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        AgentType::Claude,
    )
    .expect("Failed to build args");

    // Verify HTTP_PROXY is set correctly
    assert!(
        args.iter()
            .any(|a| a.contains("HTTP_PROXY=http://host.docker.internal:18080")),
        "Expected HTTP_PROXY env var, got: {args:?}"
    );

    // Verify HTTPS_PROXY is set
    assert!(
        args.iter()
            .any(|a| a.contains("HTTPS_PROXY=http://host.docker.internal:18080")),
        "Expected HTTPS_PROXY env var, got: {args:?}"
    );

    // Verify NO_PROXY is set
    assert!(
        args.iter().any(|a| a.contains("NO_PROXY=localhost")),
        "Expected NO_PROXY env var, got: {args:?}"
    );

    // Verify CA cert is mounted
    assert!(
        args.iter().any(|a| a.contains("proxy-ca.pem")),
        "Expected CA cert volume mount, got: {args:?}"
    );

    // Verify SSL_CERT_FILE points to mounted cert
    assert!(
        args.iter()
            .any(|a| a.contains("SSL_CERT_FILE=/etc/clauderon/proxy-ca.pem")),
        "Expected SSL_CERT_FILE env var, got: {args:?}"
    );

    // Verify NODE_EXTRA_CA_CERTS for Node.js
    assert!(
        args.iter()
            .any(|a| a.contains("NODE_EXTRA_CA_CERTS=/etc/clauderon/proxy-ca.pem")),
        "Expected NODE_EXTRA_CA_CERTS env var, got: {args:?}"
    );

    // Verify REQUESTS_CA_BUNDLE for Python
    assert!(
        args.iter()
            .any(|a| a.contains("REQUESTS_CA_BUNDLE=/etc/clauderon/proxy-ca.pem")),
        "Expected REQUESTS_CA_BUNDLE env var, got: {args:?}"
    );

    // Kubeconfig is no longer mounted (K8s traffic goes through HTTP proxy)
    // Verify talosconfig path
    assert!(
        args.iter()
            .any(|a| a.contains("TALOSCONFIG=/etc/clauderon/talos/config")),
        "Expected TALOSCONFIG env var, got: {args:?}"
    );

    // Kubeconfig volume mount removed (K8s traffic goes through HTTP proxy)
    // Verify talos config volume mount (read-only)
    assert!(
        args.iter().any(|a| a.contains("/etc/clauderon/talos:ro")),
        "Expected talos config volume mount, got: {args:?}"
    );
}

/// Test that disabled proxy config doesn't add proxy args.
#[test]
fn test_disabled_proxy_config_no_args() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,  // No proxy config
        false, // print mode
        false, // plan mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        AgentType::Claude,
    )
    .expect("Failed to build args");

    assert!(
        !args.iter().any(|a| a.contains("HTTP_PROXY")),
        "Disabled proxy should not add HTTP_PROXY"
    );
    assert!(
        !args.iter().any(|a| a.contains("HTTPS_PROXY")),
        "Disabled proxy should not add HTTPS_PROXY"
    );
    assert!(
        !args.iter().any(|a| a.contains("SSL_CERT_FILE")),
        "Disabled proxy should not add SSL_CERT_FILE"
    );
}

/// Test that None proxy config doesn't add proxy args.
#[test]
fn test_none_proxy_config_no_args() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,  // No proxy config
        false, // print mode
        false, // plan mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        AgentType::Claude,
    )
    .expect("Failed to build args");

    assert!(
        !args.iter().any(|a| a.contains("HTTP_PROXY")),
        "None proxy should not add HTTP_PROXY"
    );
    assert!(
        !args.iter().any(|a| a.contains("HTTPS_PROXY")),
        "None proxy should not add HTTPS_PROXY"
    );
}

/// Test that the proxy port is correctly embedded in env vars.
#[test]
fn test_proxy_port_in_env_vars() {
    let clauderon_dir = tempdir().expect("Failed to create temp dir");
    let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
    std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

    // Use a custom port
    let proxy_config = DockerProxyConfig::new(9999, clauderon_dir.path().to_path_buf());

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        Some(&proxy_config),
        false, // print mode
        false, // plan mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        AgentType::Claude,
    )
    .expect("Failed to build args");

    // Verify the custom port is used
    assert!(
        args.iter()
            .any(|a| a.contains("HTTP_PROXY=http://host.docker.internal:9999")),
        "Expected HTTP_PROXY with port 9999, got: {args:?}"
    );
    assert!(
        args.iter()
            .any(|a| a.contains("HTTPS_PROXY=http://host.docker.internal:9999")),
        "Expected HTTPS_PROXY with port 9999, got: {args:?}"
    );
}

/// Test that clauderon_dir path is correctly used in volume mounts.
#[test]
fn test_clauderon_dir_in_volume_mounts() {
    let clauderon_dir = tempdir().expect("Failed to create temp dir");
    let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
    std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

    // Create kube directory
    let kube_dir = clauderon_dir.path().join("kube");
    std::fs::create_dir(&kube_dir).expect("Failed to create kube dir");
    std::fs::write(kube_dir.join("config"), "dummy").expect("Failed to write kube config");

    let proxy_config = DockerProxyConfig::new(18080, clauderon_dir.path().to_path_buf());

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        Some(&proxy_config),
        false, // print mode
        false, // plan mode
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        AgentType::Claude,
    )
    .expect("Failed to build args");

    // Verify the clauderon dir is used in volume mounts (CA cert path contains the temp dir path)
    let clauderon_path = clauderon_dir.path().to_string_lossy();
    assert!(
        args.iter()
            .any(|a| a.contains(&format!("{clauderon_path}/proxy-ca.pem"))),
        "Expected clauderon dir in CA cert mount, got: {args:?}"
    );
    // Kubeconfig mount removed - K8s traffic goes through HTTP proxy instead
}
