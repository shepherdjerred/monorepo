//! The engine's port onto the TaskNotes API.
//!
//! **This is no longer a host boundary.** It used to be: a shell implemented
//! `create_task(&CreateTaskRequest) -> Result<Task>` and therefore owned the
//! whole wire layer. It is now a *core-internal* seam with exactly two kinds of
//! implementor:
//!
//! * [`TaskNotesClient`](super::client::TaskNotesClient), the real one, which
//!   speaks `/v2` over a host-supplied [`HttpClient`](super::http::HttpClient).
//! * The scenario corpus's in-memory server, which is an independent
//!   implementation of the same contract and exists to be an oracle. Keeping the
//!   seam is what lets the 25 shared scenarios drive the engine's failure
//!   policy without also standing up an HTTP fake — and it keeps the engine
//!   testable without a transport at all.
//!
//! Every mutation takes an optional idempotency key, which the client sends as
//! the `X-Mutation-Id` header. The server's idempotency middleware stores the
//! response against that key and replays it instead of re-applying, which is
//! exactly what makes a crash between server-ack and client-dequeue safe: the
//! queue survives holding a command the server already applied, and re-sending
//! it is a no-op. The key is always the command's own id, so it is stable across
//! restarts.

use crate::{
    Result,
    domain::{CreateTaskRequest, Task, TaskId, TaskStatus, UpdateTaskRequest},
};

/// The absolute completion state of one occurrence of a recurring task.
///
/// Absolute, never a toggle: replaying "the 1st of July is complete" twice
/// leaves the same state, which is what makes a queued command safe to re-send
/// after a crash.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceCompletion {
    /// The occurrence's date, as `YYYY-MM-DD`.
    pub date: String,
    /// The state to set it to.
    pub completed: bool,
}

/// The mutating half of the TaskNotes HTTP API, in domain vocabulary.
pub trait TaskApi: Send + Sync {
    /// Pull every task.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input.
    fn list_tasks(&self) -> Result<Vec<Task>>;

    /// Create a task.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input.
    fn create_task(&self, request: &CreateTaskRequest, mutation_id: Option<&str>) -> Result<Task>;

    /// Apply a partial update to a task.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input.
    fn update_task(
        &self,
        id: &TaskId,
        request: &UpdateTaskRequest,
        mutation_id: Option<&str>,
    ) -> Result<Task>;

    /// Delete a task.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input. A
    /// [`crate::Error::NotFound`] here is treated as success by the engine.
    fn delete_task(&self, id: &TaskId, mutation_id: Option<&str>) -> Result<()>;

    /// Set a task's status to an absolute value.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input.
    fn toggle_task_status(
        &self,
        id: &TaskId,
        status: TaskStatus,
        mutation_id: Option<&str>,
    ) -> Result<Task>;

    /// Set one occurrence of a recurring task to an absolute completion state.
    ///
    /// `instance` is `None` only on the legacy no-body path, which makes the
    /// server toggle its own idea of "today". The engine never takes that
    /// path; it exists so the contract tests can exercise it.
    ///
    /// # Errors
    ///
    /// Any transport or server failure, as the classifier's input.
    fn complete_recurring_instance(
        &self,
        id: &TaskId,
        instance: Option<&InstanceCompletion>,
        mutation_id: Option<&str>,
    ) -> Result<Task>;
}
