//! Execution backend implementations for running AI agent sessions.

/// Container configuration shared between Docker and Kubernetes backends.
pub mod container_config;
/// Docker container backend.
pub mod docker;
/// Docker-specific configuration loading.
pub mod docker_config;
/// Git worktree operations.
pub mod git;
/// Kubernetes pod backend.
pub mod kubernetes;
/// Kubernetes-specific configuration loading.
pub mod kubernetes_config;
/// Mock backends for testing.
pub mod mock;
/// Sprites.dev cloud backend.
pub mod sprites;
/// Sprites-specific configuration loading.
pub mod sprites_config;
/// Backend trait definitions.
pub mod traits;
/// Zellij terminal multiplexer backend.
pub mod zellij;

/// Apple Container backend (macOS 26+ only).
#[cfg(target_os = "macos")]
pub mod apple_container;
/// Apple Container configuration loading.
#[cfg(target_os = "macos")]
pub mod apple_container_config;

pub use container_config::{
    DockerConfig, ImageConfig, ImagePullPolicy, RegistryAuth, ResourceLimits,
};
pub use docker::{DockerBackend, DockerProxyConfig};
pub use git::GitBackend;
pub use kubernetes::KubernetesBackend;
pub use kubernetes_config::{KubernetesConfig, KubernetesProxyConfig, ProxyMode};
pub use mock::{MockExecutionBackend, MockGitBackend};
pub use sprites::SpritesBackend;
pub use sprites_config::SpritesConfig;
pub use traits::{
    BackendCapabilities, BackendResourceHealth, CreateOptions, ExecutionBackend, GitOperations,
};
pub use zellij::ZellijBackend;

#[cfg(target_os = "macos")]
pub use apple_container::{AppleContainerBackend, AppleContainerProxyConfig};
#[cfg(target_os = "macos")]
pub use apple_container_config::AppleContainerConfig;
