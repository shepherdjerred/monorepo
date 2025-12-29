//! Integration tests for proxy configuration flow.
//!
//! These tests verify that proxy configuration properly flows through
//! to Docker container arguments.

use multiplexer::backends::{DockerBackend, DockerProxyConfig};
use std::path::PathBuf;

/// Test that proxy configuration flows through to Docker container args.
#[test]
fn test_proxy_config_flows_to_container_args() {
    let proxy_config = DockerProxyConfig::new(18080, PathBuf::from("/home/test/.mux"));

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        "test prompt",
        1000,
        "/home/test",
        Some(&proxy_config),
    );

    // Verify HTTP_PROXY is set correctly
    assert!(
        args.iter()
            .any(|a| a.contains("HTTP_PROXY=http://host.docker.internal:18080")),
        "Expected HTTP_PROXY env var, got: {:?}",
        args
    );

    // Verify HTTPS_PROXY is set
    assert!(
        args.iter()
            .any(|a| a.contains("HTTPS_PROXY=http://host.docker.internal:18080")),
        "Expected HTTPS_PROXY env var, got: {:?}",
        args
    );

    // Verify NO_PROXY is set
    assert!(
        args.iter().any(|a| a.contains("NO_PROXY=localhost")),
        "Expected NO_PROXY env var, got: {:?}",
        args
    );

    // Verify CA cert is mounted
    assert!(
        args.iter().any(|a| a.contains("proxy-ca.pem")),
        "Expected CA cert volume mount, got: {:?}",
        args
    );

    // Verify SSL_CERT_FILE points to mounted cert
    assert!(
        args.iter()
            .any(|a| a.contains("SSL_CERT_FILE=/etc/mux/proxy-ca.pem")),
        "Expected SSL_CERT_FILE env var, got: {:?}",
        args
    );

    // Verify NODE_EXTRA_CA_CERTS for Node.js
    assert!(
        args.iter()
            .any(|a| a.contains("NODE_EXTRA_CA_CERTS=/etc/mux/proxy-ca.pem")),
        "Expected NODE_EXTRA_CA_CERTS env var, got: {:?}",
        args
    );

    // Verify REQUESTS_CA_BUNDLE for Python
    assert!(
        args.iter()
            .any(|a| a.contains("REQUESTS_CA_BUNDLE=/etc/mux/proxy-ca.pem")),
        "Expected REQUESTS_CA_BUNDLE env var, got: {:?}",
        args
    );

    // Verify kubeconfig path
    assert!(
        args.iter()
            .any(|a| a.contains("KUBECONFIG=/etc/mux/kube/config")),
        "Expected KUBECONFIG env var, got: {:?}",
        args
    );

    // Verify talosconfig path
    assert!(
        args.iter()
            .any(|a| a.contains("TALOSCONFIG=/etc/mux/talos/config")),
        "Expected TALOSCONFIG env var, got: {:?}",
        args
    );

    // Verify kube config volume mount (read-only)
    assert!(
        args.iter().any(|a| a.contains("/etc/mux/kube:ro")),
        "Expected kube config volume mount, got: {:?}",
        args
    );

    // Verify talos config volume mount (read-only)
    assert!(
        args.iter().any(|a| a.contains("/etc/mux/talos:ro")),
        "Expected talos config volume mount, got: {:?}",
        args
    );
}

/// Test that disabled proxy config doesn't add proxy args.
#[test]
fn test_disabled_proxy_config_no_args() {
    let proxy_config = DockerProxyConfig::disabled();

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        "test prompt",
        1000,
        "/home/test",
        Some(&proxy_config),
    );

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
        "test prompt",
        1000,
        "/home/test",
        None, // No proxy config
    );

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
    // Use a custom port
    let proxy_config = DockerProxyConfig::new(9999, PathBuf::from("/home/test/.mux"));

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        "test prompt",
        1000,
        "/home/test",
        Some(&proxy_config),
    );

    // Verify the custom port is used
    assert!(
        args.iter()
            .any(|a| a.contains("HTTP_PROXY=http://host.docker.internal:9999")),
        "Expected HTTP_PROXY with port 9999, got: {:?}",
        args
    );
    assert!(
        args.iter()
            .any(|a| a.contains("HTTPS_PROXY=http://host.docker.internal:9999")),
        "Expected HTTPS_PROXY with port 9999, got: {:?}",
        args
    );
}

/// Test that mux_dir path is correctly used in volume mounts.
#[test]
fn test_mux_dir_in_volume_mounts() {
    let proxy_config = DockerProxyConfig::new(18080, PathBuf::from("/custom/mux/path"));

    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        "test prompt",
        1000,
        "/home/test",
        Some(&proxy_config),
    );

    // Verify the custom mux dir is used in volume mounts
    assert!(
        args.iter()
            .any(|a| a.contains("/custom/mux/path/proxy-ca.pem")),
        "Expected custom mux dir in CA cert mount, got: {:?}",
        args
    );
    assert!(
        args.iter().any(|a| a.contains("/custom/mux/path/kube")),
        "Expected custom mux dir in kube mount, got: {:?}",
        args
    );
}
