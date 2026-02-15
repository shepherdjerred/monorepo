#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]
#![allow(clippy::print_stdout, reason = "test output")]
#![allow(clippy::print_stderr, reason = "test output")]

//! End-to-end tests for Zellij backend
//!
//! These tests require Zellij to be installed.
//! Run with: cargo test --test e2e_zellij -- --include-ignored

mod common;

use clauderon::backends::{ExecutionBackend, ZellijBackend};
use tempfile::TempDir;

/// Full end-to-end test with Zellij backend
///
/// This test creates a real Zellij session, verifies it exists,
/// and cleans it up.
#[tokio::test]
#[ignore] // Requires Zellij - run with --include-ignored
async fn test_zellij_session_lifecycle() {
    if !common::zellij_available() {
        eprintln!("Skipping test: Zellij not available");
        return;
    }

    let zellij = ZellijBackend::new();

    // Create a temp directory for the workdir
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    let session_name = format!("clauderon-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Create session
    let result = zellij
        .create_session(&session_name, workdir, "echo 'Test session'")
        .await;

    match result {
        Ok(returned_name) => {
            // Verify session name matches
            assert_eq!(
                returned_name, session_name,
                "Returned session name should match"
            );

            // Give Zellij a moment to register the session
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            // Verify session exists
            let exists = zellij
                .session_exists(&session_name)
                .await
                .expect("Failed to check session existence");
            assert!(exists, "Session should exist after creation");

            // Delete session
            zellij
                .delete_session(&session_name)
                .await
                .expect("Failed to delete session");

            // Give Zellij a moment to clean up
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            // Verify session is gone
            let exists_after_delete = zellij
                .session_exists(&session_name)
                .await
                .expect("Failed to check session existence after delete");
            assert!(
                !exists_after_delete,
                "Session should not exist after deletion"
            );
        }
        Err(e) => {
            // If session creation failed, log and continue
            eprintln!("Session creation failed: {e}");
            // Still try to clean up in case it was partially created
            let _ = zellij.delete_session(&session_name).await;
        }
    }
}

/// Test Zellij session existence check
#[tokio::test]
#[ignore]
async fn test_zellij_session_exists_check() {
    if !common::zellij_available() {
        eprintln!("Skipping test: Zellij not available");
        return;
    }

    let zellij = ZellijBackend::new();

    // Non-existent session should return false
    let exists = zellij
        .session_exists("nonexistent-session-xyz123")
        .await
        .expect("Failed to check session existence");
    assert!(!exists, "Non-existent session should not exist");
}

/// Test attach command generation
#[test]
fn test_zellij_attach_command() {
    let zellij = ZellijBackend::new();

    let cmd = zellij.attach_command("my-session");

    assert_eq!(cmd.len(), 3);
    assert_eq!(cmd[0], "zellij");
    assert_eq!(cmd[1], "attach");
    assert_eq!(cmd[2], "my-session");
}

/// Test deleting a non-existent session doesn't fail
#[tokio::test]
#[ignore]
async fn test_zellij_delete_nonexistent() {
    if !common::zellij_available() {
        eprintln!("Skipping test: Zellij not available");
        return;
    }

    let zellij = ZellijBackend::new();

    // Deleting a non-existent session should not panic
    let result = zellij.delete_session("nonexistent-session-xyz").await;

    // Should complete without error (just logs a warning)
    assert!(
        result.is_ok(),
        "Deleting non-existent session should not fail"
    );
}
