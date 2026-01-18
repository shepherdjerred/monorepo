pub mod container_config;
pub mod docker;
pub mod docker_config;
pub mod git;
pub mod kubernetes;
pub mod kubernetes_config;
pub mod mock;
pub mod sprites;
pub mod sprites_config;
pub mod traits;
pub mod zellij;

#[cfg(target_os = "macos")]
pub mod apple_container;
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
pub use traits::{CreateOptions, ExecutionBackend, GitOperations};
pub use zellij::ZellijBackend;

#[cfg(target_os = "macos")]
pub use apple_container::{AppleContainerBackend, AppleContainerProxyConfig};
#[cfg(target_os = "macos")]
pub use apple_container_config::AppleContainerConfig;
