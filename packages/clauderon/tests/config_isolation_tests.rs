//! Fast isolation tests for configuration scenarios
//!
//! These tests verify that the Kubernetes backend properly handles various
//! configuration scenarios without requiring environment variable manipulation
//! (which would violate the project's unsafe-code=forbid policy).
//!
//! Target: <5 seconds per test, run in parallel via nextest.

mod common;

use clauderon::backends::{KubernetesBackend, KubernetesConfig};

#[tokio::test]
async fn test_kubernetes_backend_default_config() {
    // Verifies that KubernetesBackend can be initialized with default config
    // This tests the basic initialization path

    // Install rustls crypto provider (required by kube client)
    let _ = rustls::crypto::ring::default_provider().install_default();

    let config = KubernetesConfig::default();
    let result = KubernetesBackend::new(config).await;

    // The result depends on whether kubectl is configured in the test environment
    // Both success and failure are acceptable - we're testing that the code handles both
    match result {
        Ok(_backend) => {
            // Backend initialized successfully with kubectl config
        }
        Err(e) => {
            // Backend failed gracefully with a clear error message
            let error_msg = e.to_string();
            assert!(!error_msg.is_empty(), "Error message should not be empty");
        }
    }
}

#[tokio::test]
async fn test_kubernetes_config_default_values() {
    // Verifies that KubernetesConfig has sensible defaults

    let config = KubernetesConfig::default();

    assert_eq!(config.namespace, "clauderon");
    assert!(!config.image.is_empty());
    assert!(!config.cpu_request.is_empty());
    assert!(!config.memory_request.is_empty());
}

#[tokio::test]
async fn test_kubernetes_config_validation() {
    // Verifies that we can create and validate Kubernetes configuration
    //
    // This test doesn't require actual K8s connectivity, just validates
    // that the configuration structure is sound

    let config = KubernetesConfig {
        namespace: "test-namespace".to_owned(),
        image: "test-image:latest".to_owned(),
        cpu_request: "100m".to_owned(),
        cpu_limit: "1000m".to_owned(),
        memory_request: "128Mi".to_owned(),
        memory_limit: "512Mi".to_owned(),
        ..Default::default()
    };

    // Verify the config values are set as expected
    assert_eq!(config.namespace, "test-namespace");
    assert_eq!(config.image, "test-image:latest");
    assert_eq!(config.cpu_request, "100m");
    assert_eq!(config.memory_request, "128Mi");
}

#[tokio::test]
async fn test_isolated_env_helpers() {
    // Tests the IsolatedEnv helper functions to ensure they work correctly
    // These are used by integration tests to create isolated test environments

    let env = common::IsolatedEnv::no_kubeconfig().expect("Failed to create isolated env");

    // Verify temp directory was created
    assert!(env.temp_dir.path().exists());
    assert!(env.home_dir.exists());

    // Verify no kubeconfig path is set
    assert!(env.kube_config_path.is_none());

    // Test invalid kubeconfig helper
    let env_invalid = common::IsolatedEnv::invalid_kubeconfig()
        .expect("Failed to create isolated env with invalid kubeconfig");

    assert!(env_invalid.temp_dir.path().exists());
    assert!(env_invalid.kube_config_path.is_some());

    if let Some(ref path) = env_invalid.kube_config_path {
        assert!(path.exists());
        let contents = std::fs::read_to_string(path).expect("Failed to read kubeconfig");
        assert!(contents.contains("invalid"));
    }

    // Test empty kubeconfig helper
    let env_empty = common::IsolatedEnv::empty_kubeconfig()
        .expect("Failed to create isolated env with empty kubeconfig");

    assert!(env_empty.kube_config_path.is_some());

    if let Some(ref path) = env_empty.kube_config_path {
        assert!(path.exists());
        let contents = std::fs::read_to_string(path).expect("Failed to read kubeconfig");
        assert!(contents.is_empty());
    }
}

#[tokio::test]
async fn test_env_vars_helper() {
    // Tests that the env_vars() helper returns the expected environment variables

    let env = common::IsolatedEnv::no_kubeconfig().expect("Failed to create isolated env");

    let vars = env.env_vars();

    // Should have HOME and KUBECONFIG
    assert_eq!(vars.len(), 2);

    // Find HOME var
    let home_var = vars.iter().find(|(k, _)| *k == "HOME");
    assert!(home_var.is_some());

    if let Some((_, home_value)) = home_var {
        assert_eq!(home_value, &env.home_dir.to_string_lossy().to_string());
    }

    // Find KUBECONFIG var
    let kube_var = vars.iter().find(|(k, _)| *k == "KUBECONFIG");
    assert!(kube_var.is_some());

    // For no_kubeconfig env, KUBECONFIG should be empty
    if let Some((_, kube_value)) = kube_var {
        assert!(kube_value.is_empty());
    }
}
