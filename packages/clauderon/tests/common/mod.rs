//! Shared test utilities for integration tests

use std::path::Path;
use std::process::Command;

/// Check if git is available on the system
#[must_use]
pub fn git_available() -> bool {
    Command::new("git").arg("--version").output().is_ok()
}

/// Check if zellij is available on the system
#[must_use]
pub fn zellij_available() -> bool {
    Command::new("zellij")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if docker daemon is running and available
#[must_use]
pub fn docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if Kubernetes cluster is accessible via kubectl
#[must_use]
pub fn kubernetes_available() -> bool {
    Command::new("kubectl")
        .args(["cluster-info"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Initialize a git repository in the given directory with an initial commit
///
/// # Panics
///
/// Panics if any git command fails.
pub fn init_git_repo(path: &Path) {
    // Initialize repo
    let output = Command::new("git")
        .args(["init"])
        .current_dir(path)
        .output()
        .expect("Failed to run git init");
    assert!(output.status.success(), "git init failed");

    // Configure user for commits
    Command::new("git")
        .args(["config", "user.email", "test@test.com"])
        .current_dir(path)
        .output()
        .expect("Failed to configure git user.email");

    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(path)
        .output()
        .expect("Failed to configure git user.name");

    // Create initial file
    std::fs::write(path.join("README.md"), "# Test Repository\n")
        .expect("Failed to write README.md");

    // Stage and commit
    let output = Command::new("git")
        .args(["add", "."])
        .current_dir(path)
        .output()
        .expect("Failed to run git add");
    assert!(output.status.success(), "git add failed");

    let output = Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(path)
        .output()
        .expect("Failed to run git commit");
    assert!(
        output.status.success(),
        "git commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Skip the test if docker is not available
#[macro_export]
macro_rules! skip_if_no_docker {
    () => {
        if !common::docker_available() {
            eprintln!("Skipping test: Docker not available");
            return;
        }
    };
}

/// Skip the test if zellij is not available
#[macro_export]
macro_rules! skip_if_no_zellij {
    () => {
        if !common::zellij_available() {
            eprintln!("Skipping test: Zellij not available");
            return;
        }
    };
}

/// Skip the test if Kubernetes is not available
#[macro_export]
macro_rules! skip_if_no_kubernetes {
    () => {
        if !common::kubernetes_available() {
            eprintln!("Skipping test: Kubernetes not available");
            return;
        }
    };
}

/// Check if Claude config directory exists
///
/// Claude Code requires ~/.claude directory with credentials for authentication.
#[must_use]
pub fn claude_config_available() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".claude").exists())
        .unwrap_or(false)
}

/// Skip the test if Claude config is not available
#[macro_export]
macro_rules! skip_if_no_claude_config {
    () => {
        if !common::claude_config_available() {
            eprintln!("Skipping test: Claude config (~/.claude) not available");
            return;
        }
    };
}

/// Check if GitHub credentials are available
#[must_use]
pub fn github_credentials_available() -> bool {
    std::env::var("GITHUB_TOKEN").is_ok()
}

/// Check if Anthropic credentials are available
#[must_use]
pub fn anthropic_credentials_available() -> bool {
    std::env::var("ANTHROPIC_API_KEY").is_ok()
}

/// Check if PagerDuty credentials are available
#[must_use]
pub fn pagerduty_credentials_available() -> bool {
    std::env::var("PAGERDUTY_TOKEN").is_ok() || std::env::var("PAGERDUTY_API_KEY").is_ok()
}

/// Check if any proxy-testable credentials are available
#[must_use]
pub fn any_credentials_available() -> bool {
    github_credentials_available()
        || anthropic_credentials_available()
        || pagerduty_credentials_available()
        || std::env::var("SENTRY_AUTH_TOKEN").is_ok()
        || std::env::var("GRAFANA_API_KEY").is_ok()
}

/// Skip the test if required credentials are not available
#[macro_export]
macro_rules! skip_if_no_credentials {
    () => {
        if !common::any_credentials_available() {
            eprintln!("Skipping test: No API credentials available");
            return;
        }
    };
}
