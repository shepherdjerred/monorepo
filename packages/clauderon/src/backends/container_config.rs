use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Unified image pull policy for container backends.
///
/// This enum provides a consistent interface across different container runtimes,
/// automatically mapping to the appropriate backend-specific format:
/// - Docker: `--pull=always|missing|never`
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum ImagePullPolicy {
    /// Always pull the latest version of the image (Docker: --pull=always)
    Always,
    /// Pull image only if not present locally (Docker: --pull=missing)
    #[default]
    IfNotPresent,
    /// Never pull, use local cache only; fails if image not found (Docker: --pull=never)
    Never,
}

impl std::fmt::Display for ImagePullPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Always => write!(f, "always"),
            Self::IfNotPresent => write!(f, "if-not-present"),
            Self::Never => write!(f, "never"),
        }
    }
}

impl std::str::FromStr for ImagePullPolicy {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "always" => Ok(Self::Always),
            "if-not-present" | "ifnotpresent" | "missing" => Ok(Self::IfNotPresent),
            "never" => Ok(Self::Never),
            _ => Err(anyhow::anyhow!(
                "Invalid pull policy: '{s}'. Expected: always, if-not-present, or never"
            )),
        }
    }
}

impl ImagePullPolicy {
    /// Convert to Docker CLI flag format.
    ///
    /// Returns the appropriate `--pull` flag value for Docker commands.
    /// Note: `IfNotPresent` returns `None` as it's Docker's default behavior.
    #[must_use]
    pub fn to_docker_flag(self) -> Option<&'static str> {
        match self {
            Self::Always => Some("always"),
            Self::IfNotPresent => None, // Docker's default, no flag needed
            Self::Never => Some("never"),
        }
    }

}

/// Container resource limits in normalized format.
///
/// Supports Docker resource specifications:
/// - CPU as decimal cores (e.g., "2.0"), memory with suffixes (e.g., "2g")
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResourceLimits {
    /// CPU limit. Examples:
    /// - Docker: "2.0" (2 cores), "0.5" (half a core)
    pub cpu: Option<String>,

    /// Memory limit. Examples:
    /// - Docker: "2g" (2 gigabytes), "512m" (512 megabytes)
    pub memory: Option<String>,
}

impl ResourceLimits {
    /// Validate resource limit format.
    ///
    /// Checks that CPU and memory values follow expected patterns.
    /// Does not validate against system constraints.
    ///
    /// # Errors
    ///
    /// Returns an error if CPU or memory limits have invalid format.
    pub fn validate(&self) -> anyhow::Result<()> {
        if let Some(cpu) = &self.cpu {
            validate_cpu_limit(cpu)?;
        }

        if let Some(memory) = &self.memory {
            validate_memory_limit(memory)?;
        }

        Ok(())
    }

    /// Convert to Docker CLI arguments.
    ///
    /// Returns a vector of Docker run arguments (e.g., `["--cpus", "2.0", "--memory", "2g"]`).
    #[must_use]
    pub fn to_docker_args(&self) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(cpu) = &self.cpu {
            args.push("--cpus".to_owned());
            args.push(cpu.clone());
        }

        if let Some(memory) = &self.memory {
            args.push("--memory".to_owned());
            args.push(memory.clone());
        }

        args
    }
}

/// Validate CPU limit format.
///
/// Accepts:
/// - Decimal numbers: "2.0", "0.5"
/// - Millicores: "2000m", "500m"
fn validate_cpu_limit(cpu: &str) -> anyhow::Result<()> {
    // Check for millicores format (e.g., "2000m")
    if let Some(stripped) = cpu.strip_suffix('m') {
        stripped.parse::<u64>().map_err(|e| {
            anyhow::anyhow!(
                "Invalid CPU limit: '{cpu}'. Millicores must be a positive integer (e.g., '2000m'): {e}"
            )
        })?;
        return Ok(());
    }

    // Check for decimal format (e.g., "2.0")
    cpu.parse::<f64>()
        .map_err(|e| {
            anyhow::anyhow!(
                "Invalid CPU limit: '{cpu}'. Expected decimal (e.g., '2.0') or millicores (e.g., '2000m'): {e}"
            )
        })
        .and_then(|val| {
            if val <= 0.0 {
                Err(anyhow::anyhow!("CPU limit must be positive, got: {cpu}"))
            } else {
                Ok(())
            }
        })
}

/// Validate memory limit format.
///
/// Accepts suffixes: k, m, g (decimal), K, M, G, Ki, Mi, Gi (binary)
fn validate_memory_limit(memory: &str) -> anyhow::Result<()> {
    let valid_suffixes = ["k", "m", "g", "K", "M", "G", "Ki", "Mi", "Gi", "Ti"];

    // Find if string ends with a valid suffix
    let has_valid_suffix = valid_suffixes.iter().any(|suffix| memory.ends_with(suffix));

    if !has_valid_suffix {
        return Err(anyhow::anyhow!(
            "Invalid memory limit: '{memory}'. Must include suffix: k, m, g, K, M, G, Ki, Mi, Gi, Ti"
        ));
    }

    // Extract numeric part (everything except the suffix)
    let numeric_part = valid_suffixes
        .iter()
        .find_map(|suffix| memory.strip_suffix(suffix))
        .ok_or_else(|| anyhow::anyhow!("Failed to parse memory limit: {memory}"))?;

    // Validate numeric part
    numeric_part
        .parse::<f64>()
        .map_err(|e| {
            anyhow::anyhow!(
                "Invalid memory limit: '{memory}'. Numeric part must be a positive number: {e}"
            )
        })
        .and_then(|val| {
            if val <= 0.0 {
                Err(anyhow::anyhow!(
                    "Memory limit must be positive, got: {memory}"
                ))
            } else {
                Ok(())
            }
        })
}

/// Registry authentication credentials.
///
/// Supports multiple authentication methods:
/// 1. Docker config file (recommended): Uses existing `docker login` credentials
/// 2. Custom config file: Points to a specific Docker config.json
///
/// Note: Inline username/password is intentionally NOT supported for security reasons.
/// Passwords should never be passed as CLI arguments where they're visible in process lists.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegistryAuth {
    /// Registry hostname (e.g., "ghcr.io", "docker.io")
    pub registry: String,

    /// Username (optional, for display/reference only)
    /// Not used directly; authentication happens via config file
    pub username: Option<String>,

    /// Password or token (NEVER serialized, loaded from secrets at runtime)
    #[serde(skip)]
    pub password: Option<String>,

    /// Path to Docker config file containing authentication.
    /// If None, Docker uses default ~/.docker/config.json
    pub config_file: Option<PathBuf>,
}

/// Image configuration with pull policy and authentication.
///
/// Can be used for both per-session overrides and global defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageConfig {
    /// Full image name with optional tag (e.g., "ghcr.io/user/repo:tag")
    ///
    /// Format: `[registry/]repository[:tag]`
    /// - If registry omitted, defaults to Docker Hub
    /// - If tag omitted, defaults to `:latest`
    pub image: String,

    /// Image pull policy
    #[serde(default)]
    pub pull_policy: ImagePullPolicy,

    /// Optional registry authentication
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_auth: Option<RegistryAuth>,
}

impl ImageConfig {
    /// Validate image name format.
    ///
    /// Checks for:
    /// - Valid characters (alphanumeric, dots, hyphens, underscores, slashes, colons)
    /// - Reasonable length (max 256 characters)
    /// - No shell metacharacters or path traversal attempts
    ///
    /// # Errors
    ///
    /// Returns an error if the image name is invalid or contains unsafe characters.
    pub fn validate(&self) -> anyhow::Result<()> {
        validate_image_name(&self.image)
    }
}

/// Validate Docker image name format.
///
/// Ensures image name follows container registry naming conventions and
/// doesn't contain characters that could be exploited for command injection.
fn validate_image_name(image: &str) -> anyhow::Result<()> {
    if image.is_empty() {
        return Err(anyhow::anyhow!("Image name cannot be empty"));
    }

    if image.len() > 256 {
        return Err(anyhow::anyhow!(
            "Image name too long ({} chars). Maximum is 256 characters",
            image.len()
        ));
    }

    // Check for dangerous characters that could enable command injection
    let dangerous_chars = ['$', '`', '&', '|', ';', '\n', '\r', '\\'];
    if image.chars().any(|c| dangerous_chars.contains(&c)) {
        return Err(anyhow::anyhow!(
            "Image name contains invalid characters. Only alphanumeric, dots, hyphens, slashes, underscores, and colons are allowed"
        ));
    }

    // Basic format validation: registry/repo:tag
    // Allow alphanumeric, dots, hyphens, underscores, slashes, colons
    let valid_chars = image
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '/' | ':'));

    if !valid_chars {
        return Err(anyhow::anyhow!(
            "Image name '{image}' contains invalid characters"
        ));
    }

    Ok(())
}

/// Generate plugin configuration for containers.
///
/// Creates a known_marketplaces.json file with container-adjusted paths that point to
/// the mounted plugin directories. Plugin files themselves are mounted read-only from
/// the host, so this only generates the configuration metadata.
pub fn generate_plugin_config(
    clauderon_dir: &std::path::Path,
    plugin_manifest: &crate::plugins::PluginManifest,
) -> anyhow::Result<()> {
    use anyhow::Context;

    let plugins_dir = clauderon_dir.join("plugins");
    std::fs::create_dir_all(&plugins_dir).context("Failed to create plugins directory")?;

    // Transform marketplace paths from host to container paths
    let container_marketplaces =
        transform_marketplace_paths_for_container(&plugin_manifest.marketplace_configs);

    // Write known_marketplaces.json with container paths
    let marketplaces_path = plugins_dir.join("known_marketplaces.json");
    std::fs::write(
        &marketplaces_path,
        serde_json::to_string_pretty(&container_marketplaces)?,
    )
    .with_context(|| {
        format!(
            "Failed to write known_marketplaces.json to {}",
            marketplaces_path.display()
        )
    })?;

    tracing::debug!(
        "Generated plugin config at {} with {} marketplaces",
        marketplaces_path.display(),
        plugin_manifest.installed_plugins.len()
    );

    Ok(())
}

/// Transform marketplace configuration paths from host to container paths.
///
/// Replaces host-specific paths (e.g., /Users/foo/.claude/plugins/...) with container
/// paths (e.g., /workspace/.claude/plugins/...) since HOME=/workspace in containers.
fn transform_marketplace_paths_for_container(host_config: &serde_json::Value) -> serde_json::Value {
    let mut container_config = host_config.clone();

    if let Some(obj) = container_config.as_object_mut() {
        for (_marketplace_name, marketplace_data) in obj.iter_mut() {
            if let Some(install_location) = marketplace_data.get_mut("installLocation")
                && let Some(path_str) = install_location.as_str()
            {
                if path_str.contains(".claude/plugins/marketplaces") {
                    if let Some(idx) = path_str.find(".claude/plugins/marketplaces") {
                        let marketplace_relative = &path_str[idx..];
                        let container_path = format!("/workspace/{marketplace_relative}");
                        *install_location = serde_json::Value::String(container_path);
                    }
                }
            }
        }
    }

    container_config
}

/// Docker backend global configuration.
///
/// Loaded from `~/.clauderon/docker-config.toml` and provides default values
/// for all Docker container sessions. Can be overridden per-session via CreateOptions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConfig {
    /// Default container image configuration
    pub image: ImageConfig,

    /// Optional default resource limits
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<ResourceLimits>,

    /// Additional Docker run flags (advanced users only)
    ///
    /// These are passed directly to `docker run`. Use with caution.
    /// Example: `["--cap-add=SYS_PTRACE", "--security-opt=seccomp=unconfined"]`
    #[serde(default)]
    pub extra_flags: Vec<String>,

    /// Use Docker volumes instead of bind mounts (default: false)
    ///
    /// When enabled, Docker creates a named volume for each session and clones
    /// repositories into it. This enables:
    /// - Remote Docker hosts without local filesystem access
    /// - Truly isolated sessions that don't rely on local worktrees
    ///
    /// When disabled (default), bind mounts local worktrees directly into containers.
    #[serde(default)]
    pub use_volume_mode: bool,
}

impl Default for DockerConfig {
    fn default() -> Self {
        Self {
            image: ImageConfig {
                image: "ghcr.io/shepherdjerred/dotfiles:latest".to_owned(),
                pull_policy: ImagePullPolicy::IfNotPresent,
                registry_auth: None,
            },
            resources: None,
            extra_flags: Vec::new(),
            use_volume_mode: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_pull_policy_default() {
        assert_eq!(ImagePullPolicy::default(), ImagePullPolicy::IfNotPresent);
    }

    #[test]
    fn test_image_pull_policy_from_str() {
        assert_eq!(
            "always".parse::<ImagePullPolicy>().unwrap(),
            ImagePullPolicy::Always
        );
        assert_eq!(
            "if-not-present".parse::<ImagePullPolicy>().unwrap(),
            ImagePullPolicy::IfNotPresent
        );
        assert_eq!(
            "never".parse::<ImagePullPolicy>().unwrap(),
            ImagePullPolicy::Never
        );
        assert!("invalid".parse::<ImagePullPolicy>().is_err());
    }

    #[test]
    fn test_image_pull_policy_docker_flag() {
        assert_eq!(ImagePullPolicy::Always.to_docker_flag(), Some("always"));
        assert_eq!(ImagePullPolicy::IfNotPresent.to_docker_flag(), None);
        assert_eq!(ImagePullPolicy::Never.to_docker_flag(), Some("never"));
    }

    #[test]
    fn test_validate_cpu_limit() {
        // Valid formats
        assert!(validate_cpu_limit("2.0").is_ok());
        assert!(validate_cpu_limit("0.5").is_ok());
        assert!(validate_cpu_limit("2000m").is_ok());
        assert!(validate_cpu_limit("500m").is_ok());

        // Invalid formats
        assert!(validate_cpu_limit("").is_err());
        assert!(validate_cpu_limit("-1.0").is_err());
        assert!(validate_cpu_limit("abc").is_err());
        assert!(validate_cpu_limit("2.0m").is_err()); // Can't have decimal with 'm'
    }

    #[test]
    fn test_validate_memory_limit() {
        // Valid formats
        assert!(validate_memory_limit("2g").is_ok());
        assert!(validate_memory_limit("512m").is_ok());
        assert!(validate_memory_limit("2Gi").is_ok());
        assert!(validate_memory_limit("512Mi").is_ok());
        assert!(validate_memory_limit("1024K").is_ok());

        // Invalid formats
        assert!(validate_memory_limit("").is_err());
        assert!(validate_memory_limit("2").is_err()); // Missing suffix
        assert!(validate_memory_limit("abc").is_err());
        assert!(validate_memory_limit("-512m").is_err());
    }

    #[test]
    fn test_resource_limits_to_docker_args() {
        let limits = ResourceLimits {
            cpu: Some("2.0".to_owned()),
            memory: Some("2g".to_owned()),
        };
        let args = limits.to_docker_args();
        assert_eq!(args, vec!["--cpus", "2.0", "--memory", "2g"]);

        let limits_cpu_only = ResourceLimits {
            cpu: Some("1.5".to_owned()),
            memory: None,
        };
        let args = limits_cpu_only.to_docker_args();
        assert_eq!(args, vec!["--cpus", "1.5"]);
    }

    #[test]
    fn test_validate_image_name() {
        // Valid names
        assert!(validate_image_name("ubuntu").is_ok());
        assert!(validate_image_name("ubuntu:latest").is_ok());
        assert!(validate_image_name("ghcr.io/user/repo:tag").is_ok());
        assert!(validate_image_name("registry.example.com:5000/namespace/repo:v1.0.0").is_ok());

        // Invalid names
        assert!(validate_image_name("").is_err()); // Empty
        assert!(validate_image_name("image; rm -rf /").is_err()); // Command injection
        assert!(validate_image_name("image$(whoami)").is_err()); // Command substitution
        assert!(validate_image_name("image`whoami`").is_err()); // Command substitution
        assert!(validate_image_name("image && ls").is_err()); // Command chaining
        assert!(validate_image_name("image\\nmalicious").is_err()); // Newline
    }

    #[test]
    fn test_docker_config_default() {
        let config = DockerConfig::default();
        assert_eq!(config.image.image, "ghcr.io/shepherdjerred/dotfiles:latest");
        assert_eq!(config.image.pull_policy, ImagePullPolicy::IfNotPresent);
        assert!(config.resources.is_none());
        assert!(config.extra_flags.is_empty());
    }

    #[test]
    fn test_generate_plugin_config() {
        use crate::plugins::{DiscoveredPlugin, PluginManifest};

        let dir = tempfile::tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        let manifest = PluginManifest {
            marketplace_configs: serde_json::json!({
                "test-marketplace": {
                    "installLocation": "/home/user/.claude/plugins/marketplaces/test-marketplace",
                    "source": {
                        "source": "github",
                        "repo": "test/test"
                    }
                }
            }),
            installed_plugins: vec![DiscoveredPlugin {
                name: "test-plugin".to_owned(),
                marketplace: "test-marketplace".to_owned(),
                path: std::path::PathBuf::from(
                    "/home/user/.claude/plugins/marketplaces/test-marketplace/plugins/test-plugin",
                ),
            }],
        };

        generate_plugin_config(&clauderon_dir, &manifest).unwrap();

        let marketplaces_path = clauderon_dir.join("plugins/known_marketplaces.json");
        assert!(marketplaces_path.exists());

        let content = std::fs::read_to_string(&marketplaces_path).unwrap();
        assert!(content.contains("/workspace/.claude/plugins/marketplaces"));
    }

    #[test]
    fn test_generate_plugin_config_creates_directory() {
        use crate::plugins::PluginManifest;

        let dir = tempfile::tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        let manifest = PluginManifest::empty();
        generate_plugin_config(&clauderon_dir, &manifest).unwrap();

        assert!(clauderon_dir.join("plugins").exists());
    }

    #[test]
    fn test_transform_marketplace_paths() {
        let host_config = serde_json::json!({
            "official": {
                "installLocation": "/Users/foo/.claude/plugins/marketplaces/official",
                "source": {"source": "github"}
            },
            "custom": {
                "installLocation": "/home/user/.claude/plugins/marketplaces/custom",
                "source": {"source": "local"}
            }
        });

        let container_config = transform_marketplace_paths_for_container(&host_config);

        let official_location = container_config["official"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(
            official_location,
            "/workspace/.claude/plugins/marketplaces/official"
        );

        let custom_location = container_config["custom"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(
            custom_location,
            "/workspace/.claude/plugins/marketplaces/custom"
        );
    }

    #[test]
    fn test_transform_marketplace_paths_no_match() {
        let host_config = serde_json::json!({
            "test": {
                "installLocation": "/some/other/path",
                "source": {"source": "github"}
            }
        });

        let container_config = transform_marketplace_paths_for_container(&host_config);

        let location = container_config["test"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(location, "/some/other/path");
    }

    #[test]
    fn test_transform_marketplace_paths_empty_config() {
        let host_config = serde_json::json!({});
        let container_config = transform_marketplace_paths_for_container(&host_config);
        assert!(container_config.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_image_config_validate() {
        let valid_config = ImageConfig {
            image: "ghcr.io/user/repo:tag".to_owned(),
            pull_policy: ImagePullPolicy::IfNotPresent,
            registry_auth: None,
        };
        assert!(valid_config.validate().is_ok());

        let invalid_config = ImageConfig {
            image: "bad;image".to_owned(),
            pull_policy: ImagePullPolicy::Always,
            registry_auth: None,
        };
        assert!(invalid_config.validate().is_err());
    }
}
