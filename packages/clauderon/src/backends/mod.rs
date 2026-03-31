/// Shared container configuration (images, resources, pull policies).
pub mod container_config;
/// Docker execution backend.
pub mod docker;
/// Docker-specific configuration.
pub mod docker_config;
/// Git worktree operations.
pub mod git;
/// Mock backends for testing.
pub mod mock;
/// AI Sandbox (Zellij + ai-sandbox) execution backend.
pub mod ai_sandbox;
/// Backend trait definitions and shared types.
pub mod traits;
/// Zellij session execution backend.
pub mod zellij;

pub use container_config::{
    DockerConfig, ImageConfig, ImagePullPolicy, RegistryAuth, ResourceLimits,
};
pub use docker::DockerBackend;
pub use git::GitBackend;
pub use mock::{MockExecutionBackend, MockGitBackend};
pub use traits::{
    BackendCapabilities, BackendResourceHealth, CreateOptions, ExecutionBackend, GitOperations,
};
pub use ai_sandbox::AiSandboxBackend;
pub use zellij::ZellijBackend;
