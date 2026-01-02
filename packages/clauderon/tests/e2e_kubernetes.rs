//! End-to-end tests for Kubernetes backend
//!
//! These tests require a Kubernetes cluster to be accessible via kubectl.
//! Run with: cargo test --test e2e_kubernetes -- --include-ignored

mod common;

use clauderon::backends::{CreateOptions, ExecutionBackend, KubernetesBackend, KubernetesConfig};
use tempfile::TempDir;

/// Full end-to-end test with Kubernetes backend
///
/// This test creates a real Kubernetes pod, verifies it exists,
/// and cleans it up.
#[tokio::test]
#[ignore] // Requires Kubernetes - run with --include-ignored
async fn test_kubernetes_pod_lifecycle() {
    if !common::kubernetes_available() {
        eprintln!("Skipping test: Kubernetes not available");
        return;
    }

    let config = KubernetesConfig::load_or_default();
    let kubernetes = match KubernetesBackend::new(config).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("Failed to create Kubernetes backend: {}", e);
            return;
        }
    };

    // Create a temp directory for the workdir
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    // Initialize a git repository in the temp directory
    common::init_git_repo(workdir);

    let pod_name = format!("test-{}", uuid::Uuid::new_v4().to_string()[..8].to_string());

    // Create pod (using ExecutionBackend trait method)
    let result = kubernetes
        .create(&pod_name, workdir, "echo 'Test pod'", CreateOptions::default())
        .await;

    match result {
        Ok(returned_name) => {
            // Verify pod was created
            assert!(
                returned_name.starts_with("clauderon-"),
                "Pod name should start with clauderon-"
            );

            // Verify pod exists (using ExecutionBackend trait method)
            let exists = kubernetes
                .exists(&returned_name)
                .await
                .expect("Failed to check pod existence");
            assert!(exists, "Pod should exist after creation");

            // Get logs (pod might take time to start)
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            let logs = kubernetes.get_output(&returned_name, 10).await;

            if let Ok(log_output) = logs {
                println!("Pod logs: {}", log_output);
            }

            // Delete pod (using ExecutionBackend trait method)
            kubernetes
                .delete(&returned_name)
                .await
                .expect("Failed to delete pod");

            // Verify pod is gone (using ExecutionBackend trait method)
            // Note: pod deletion is async, might take a moment
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let exists_after_delete = kubernetes
                .exists(&returned_name)
                .await
                .expect("Failed to check pod existence after delete");
            assert!(
                !exists_after_delete,
                "Pod should not exist after deletion"
            );
        }
        Err(e) => {
            // If pod creation failed (e.g., namespace doesn't exist, image not available), skip
            eprintln!("Pod creation failed: {}", e);
            return;
        }
    }
}

/// Test Kubernetes pod existence check
#[tokio::test]
#[ignore]
async fn test_kubernetes_pod_exists_check() {
    if !common::kubernetes_available() {
        eprintln!("Skipping test: Kubernetes not available");
        return;
    }

    let config = KubernetesConfig::load_or_default();
    let kubernetes = match KubernetesBackend::new(config).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("Failed to create Kubernetes backend: {}", e);
            return;
        }
    };

    // Non-existent pod should return false (using ExecutionBackend trait method)
    let exists = kubernetes
        .exists("clauderon-nonexistent-pod-xyz123")
        .await
        .expect("Failed to check pod existence");
    assert!(!exists, "Non-existent pod should not exist");
}

/// Test attach command generation
///
/// The attach command should use kubectl attach with the correct flags
#[tokio::test]
async fn test_kubernetes_attach_command() {
    // Skip if k8s not available
    if kube::Client::try_default().await.is_err() {
        eprintln!("Skipping test: Kubernetes not available");
        return;
    }

    let config = KubernetesConfig::load_or_default();
    let kubernetes = KubernetesBackend::new(config).await.unwrap();

    let cmd = kubernetes.attach_command("test-pod");

    // Should use kubectl attach
    assert_eq!(cmd[0], "kubectl", "Should use kubectl");
    assert_eq!(cmd[1], "attach", "Should use attach command");
    assert_eq!(cmd[2], "-it", "Should attach interactively");

    // Should include namespace flag
    assert!(cmd.contains(&"-n".to_string()), "Should include -n flag");

    // Should reference pod name
    assert!(
        cmd.contains(&"test-pod".to_string()),
        "Should reference pod name"
    );

    // Should specify container
    assert!(cmd.contains(&"-c".to_string()), "Should include -c flag");
    assert!(
        cmd.contains(&"claude".to_string()),
        "Should specify claude container"
    );
}

/// Test deleting a non-existent pod doesn't fail
#[tokio::test]
#[ignore]
async fn test_kubernetes_delete_nonexistent() {
    if !common::kubernetes_available() {
        eprintln!("Skipping test: Kubernetes not available");
        return;
    }

    let config = KubernetesConfig::load_or_default();
    let kubernetes = match KubernetesBackend::new(config).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("Failed to create Kubernetes backend: {}", e);
            return;
        }
    };

    // Deleting a non-existent pod should not panic (using ExecutionBackend trait method)
    let result = kubernetes.delete("clauderon-nonexistent-pod-xyz").await;

    // Should complete without error (just logs a warning)
    assert!(
        result.is_ok(),
        "Deleting non-existent pod should not fail"
    );
}
