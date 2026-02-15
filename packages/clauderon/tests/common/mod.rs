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
    // Install rustls crypto provider (required by kube client)
    let _ = rustls::crypto::ring::default_provider().install_default();

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

    // Disable commit signing for tests
    Command::new("git")
        .args(["config", "commit.gpgsign", "false"])
        .current_dir(path)
        .output()
        .expect("Failed to disable commit signing");

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
    dirs::home_dir().is_some_and(|h| h.join(".claude").exists())
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

/// Check if gh CLI is installed and authenticated
#[must_use]
pub fn gh_authenticated() -> bool {
    Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
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

/// Check if Sprites API is accessible (via SPRITES_TOKEN env var)
#[must_use]
pub fn sprites_available() -> bool {
    std::env::var("SPRITES_TOKEN")
        .map(|t| !t.is_empty())
        .unwrap_or(false)
}

/// Check if sprite CLI is installed (required for PTY attachment)
#[must_use]
pub fn sprite_cli_available() -> bool {
    Command::new("sprite")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Skip the test if Sprites is not available
#[macro_export]
macro_rules! skip_if_no_sprites {
    () => {
        if !common::sprites_available() {
            eprintln!("Skipping test: SPRITES_TOKEN not set");
            return;
        }
    };
}

/// Skip the test if sprite CLI is not installed
#[macro_export]
macro_rules! skip_if_no_sprite_cli {
    () => {
        if !common::sprite_cli_available() {
            eprintln!("Skipping test: sprite CLI not installed");
            return;
        }
    };
}

/// Initialize a git repository with a specified remote URL
///
/// This is useful for Sprites tests where a remote URL must be configured.
///
/// # Panics
///
/// Panics if any git command fails.
pub fn init_git_repo_with_remote(path: &Path, remote_url: &str) {
    init_git_repo(path);
    let output = Command::new("git")
        .args(["remote", "add", "origin", remote_url])
        .current_dir(path)
        .output()
        .expect("Failed to add git remote");
    assert!(
        output.status.success(),
        "git remote add failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Initialize a git repository with a remote and create a specific branch
///
/// Creates an initial commit, adds the remote, and optionally creates a new branch.
///
/// # Panics
///
/// Panics if any git command fails.
pub fn init_git_repo_with_branch(path: &Path, remote_url: &str, branch_name: &str) {
    init_git_repo_with_remote(path, remote_url);

    // Create and checkout new branch if not main/master
    if branch_name != "main" && branch_name != "master" {
        let output = Command::new("git")
            .args(["checkout", "-b", branch_name])
            .current_dir(path)
            .output()
            .expect("Failed to create branch");
        assert!(
            output.status.success(),
            "git checkout -b failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

/// Force destroy a sprite using the CLI
///
/// Uses `sprite -s <name> destroy --force` for reliable cleanup.
/// This should be used instead of the backend's delete method for test cleanup.
#[allow(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "test cleanup output"
)]
pub fn force_destroy_sprite(name: &str) {
    if name.is_empty() {
        return;
    }
    let output = Command::new("sprite")
        .args(["-s", name, "destroy", "--force"])
        .output();
    match output {
        Ok(o) => {
            if !o.status.success() {
                eprintln!(
                    "Warning: sprite destroy failed for {}: {}",
                    name,
                    String::from_utf8_lossy(&o.stderr)
                );
            } else {
                println!("Cleaned up sprite: {name}");
            }
        }
        Err(e) => {
            eprintln!("Warning: Failed to run sprite destroy for {name}: {e}");
        }
    }
}

/// RAII guard for sprite cleanup
///
/// Ensures the sprite is destroyed even if the test panics.
/// Usage:
/// ```ignore
/// let guard = SpriteCleanupGuard::new("sprite-name".to_string());
/// // ... test code ...
/// guard.disarm(); // Optional: prevent cleanup if test wants to keep sprite
/// ```
pub struct SpriteCleanupGuard {
    name: Option<String>,
}

impl SpriteCleanupGuard {
    /// Create a new cleanup guard for the given sprite name
    #[must_use]
    pub fn new(name: String) -> Self {
        Self { name: Some(name) }
    }

    /// Set the sprite name after creation (useful when name is returned by API)
    pub fn set_name(&mut self, name: String) {
        self.name = Some(name);
    }

    /// Disarm the guard to prevent cleanup on drop
    pub fn disarm(&mut self) {
        self.name = None;
    }

    /// Get the sprite name
    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
}

impl Drop for SpriteCleanupGuard {
    fn drop(&mut self) {
        if let Some(name) = &self.name {
            force_destroy_sprite(name);
        }
    }
}

/// Isolated test environment with custom filesystem and environment setup
///
/// Creates temporary directories and manages environment variables for isolated testing.
/// This is useful for testing configuration scenarios without affecting the host system.
pub struct IsolatedEnv {
    pub temp_dir: tempfile::TempDir,
    pub home_dir: std::path::PathBuf,
    pub kube_config_path: Option<std::path::PathBuf>,
}

impl IsolatedEnv {
    /// Create environment with no kubeconfig
    ///
    /// # Errors
    ///
    /// Returns an error if temporary directory creation fails
    pub fn no_kubeconfig() -> anyhow::Result<Self> {
        let temp_dir = tempfile::TempDir::new()?;
        let home_dir = temp_dir.path().join("home");
        std::fs::create_dir_all(&home_dir)?;

        Ok(Self {
            temp_dir,
            home_dir,
            kube_config_path: None,
        })
    }

    /// Create environment with invalid kubeconfig (malformed YAML)
    ///
    /// # Errors
    ///
    /// Returns an error if directory or file creation fails
    pub fn invalid_kubeconfig() -> anyhow::Result<Self> {
        let temp_dir = tempfile::TempDir::new()?;
        let home_dir = temp_dir.path().join("home");
        std::fs::create_dir_all(home_dir.join(".kube"))?;

        let kube_config_path = home_dir.join(".kube/config");
        std::fs::write(&kube_config_path, "invalid: yaml: content: [[[malformed")?;

        Ok(Self {
            temp_dir,
            home_dir,
            kube_config_path: Some(kube_config_path),
        })
    }

    /// Create environment with empty kubeconfig file
    ///
    /// # Errors
    ///
    /// Returns an error if directory or file creation fails
    pub fn empty_kubeconfig() -> anyhow::Result<Self> {
        let temp_dir = tempfile::TempDir::new()?;
        let home_dir = temp_dir.path().join("home");
        std::fs::create_dir_all(home_dir.join(".kube"))?;

        let kube_config_path = home_dir.join(".kube/config");
        std::fs::write(&kube_config_path, "")?;

        Ok(Self {
            temp_dir,
            home_dir,
            kube_config_path: Some(kube_config_path),
        })
    }

    /// Get environment variables to use for this isolated env
    ///
    /// Returns a vector of (key, value) pairs that should be set for testing.
    #[must_use]
    pub fn env_vars(&self) -> Vec<(&str, String)> {
        let mut vars = vec![("HOME", self.home_dir.to_string_lossy().to_string())];
        if let Some(ref path) = self.kube_config_path {
            vars.push(("KUBECONFIG", path.to_string_lossy().to_string()));
        } else {
            // Set empty string to clear KUBECONFIG
            vars.push(("KUBECONFIG", String::new()));
        }
        vars
    }
}
