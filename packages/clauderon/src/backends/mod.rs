pub mod docker;
pub mod git;
pub mod mock;
pub mod traits;
pub mod zellij;

pub use docker::{DockerBackend, DockerProxyConfig};
pub use git::GitBackend;
pub use mock::{MockExecutionBackend, MockGitBackend};
pub use traits::{CreateOptions, ExecutionBackend, GitOperations};
pub use zellij::ZellijBackend;
