/// Shared container configuration (images, resources, pull policies).
pub mod container_config;
/// Docker execution backend.
pub mod docker;
/// Docker-specific configuration.
pub mod docker_config;
/// Git worktree operations.
pub mod git;
/// Kubernetes execution backend.
pub mod kubernetes;
/// Kubernetes-specific configuration.
pub mod kubernetes_config;
/// Mock backends for testing.
pub mod mock;
/// Sprites (remote VM) execution backend.
pub mod sprites;
/// Sprites-specific configuration.
pub mod sprites_config;
/// Backend trait definitions and shared types.
pub mod traits;
/// Zellij session execution backend.
pub mod zellij;

#[cfg(target_os = "macos")]
/// Apple Container (macOS virtualization) execution backend.
pub mod apple_container;
#[cfg(target_os = "macos")]
/// Apple Container configuration.
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
