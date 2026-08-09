//! The in-memory TaskNotes server.
//!
//! **This is a spec, not a mock.** It mirrors the real server's idempotency
//! middleware: a mutation carrying an `X-Mutation-Id` the server has already
//! applied gets the *stored response* back without re-applying. That single
//! behaviour is what makes a crash between server-ack and client-dequeue safe,
//! so the fake has to model it or the crash scenarios would prove nothing.
//!
//! It is deliberately an **independent implementation**: it does not call the
//! core's rebase, its command algebra, or its field-application helpers. An
//! oracle that shares code with the thing it checks is not an oracle.
//!
//! Controls, all driven by the scenario corpus: [`FakeServer::seed`],
//! [`FakeServer::go_offline`] / [`FakeServer::go_online`],
//! [`FakeServer::fail_next`], [`FakeServer::inject_server_edit`], plus a call
//! log for exactly-once assertions.

use std::sync::Mutex;

use indexmap::IndexMap;
use tasknotes_core::{
    Error, Result,
    domain::{
        CreateTaskRequest, ExtraFields, Priority, Task, TaskId, TaskStatus, UpdateTaskRequest,
    },
    sync::{InstanceCompletion, TaskApi},
};

use super::harness::{ManualClock, local_ymd};

/// Every wire call the engine can make.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, PartialOrd, Ord,
)]
#[serde(rename_all = "camelCase")]
pub enum MutationMethod {
    /// Create a task.
    CreateTask,
    /// Update a task.
    UpdateTask,
    /// Delete a task.
    DeleteTask,
    /// Set a task's status.
    ToggleTaskStatus,
    /// Set an occurrence's completion state.
    CompleteRecurringInstance,
    /// Pull every task.
    ListTasks,
}

/// One entry in the call log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallLogEntry {
    /// Which method was called.
    pub method: MutationMethod,
    /// The task id the call addressed, where there is one.
    pub id: Option<String>,
    /// The idempotency key the call carried.
    pub mutation_id: Option<String>,
    /// True when the idempotency store answered without re-applying.
    pub replayed: bool,
    /// True when the call actually mutated server state.
    pub applied: bool,
}

/// The response the idempotency store remembers against a mutation id.
#[derive(Debug, Clone)]
enum StoredResponse {
    Task(Box<Task>),
    Void,
}

/// What the gate decided about an incoming call.
enum Gate {
    Proceed,
    Fail(Error),
    Replay(StoredResponse),
}

#[derive(Debug, Default)]
struct ServerState {
    tasks: IndexMap<TaskId, Task>,
    calls: Vec<CallLogEntry>,
    offline: bool,
    fail_next: Vec<(MutationMethod, Error)>,
    idempotency: IndexMap<String, StoredResponse>,
    create_counter: u64,
}

/// The in-memory server.
pub struct FakeServer {
    clock: std::sync::Arc<ManualClock>,
    state: Mutex<ServerState>,
}

impl core::fmt::Debug for FakeServer {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.debug_struct("FakeServer").finish_non_exhaustive()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().expect("the harness is single-threaded")
}

/// The task every seeded fixture starts from.
///
/// Mirrors the TypeScript `makeTask` defaults exactly, down to the id: a
/// scenario that seeds `{}` gets `TaskNotes/test.md`.
pub fn default_task() -> Task {
    Task {
        id: TaskId::parse("TaskNotes/test.md").expect("a literal task id"),
        path: "TaskNotes/test.md".to_owned(),
        title: "Test".to_owned(),
        status: TaskStatus::Open,
        priority: Priority::Normal,
        due: None,
        scheduled: None,
        contexts: Vec::new(),
        projects: Vec::new(),
        tags: Vec::new(),
        recurrence: None,
        recurrence_anchor: None,
        complete_instances: Vec::new(),
        skipped_instances: Vec::new(),
        completed_date: None,
        date_created: None,
        date_modified: None,
        time_estimate: None,
        time_entries: Vec::new(),
        blocked_by: Vec::new(),
        reminders: Vec::new(),
        archived: false,
        total_tracked_time: 0,
        is_blocked: false,
        is_blocking: false,
        extra_fields: ExtraFields::default(),
        details: None,
    }
}

/// Write every field a create names onto a task.
///
/// The server's own field-application pass, written out independently of the
/// core's.
fn write_create_fields(task: &mut Task, request: &CreateTaskRequest) {
    task.title = request.title.as_str().to_owned();
    if let Some(ref details) = request.details {
        task.details = Some(details.clone());
    }
    if let Some(status) = request.status {
        task.status = status;
    }
    if let Some(priority) = request.priority {
        task.priority = priority;
    }
    if let Some(ref due) = request.due {
        task.due = Some(due.clone());
    }
    if let Some(ref scheduled) = request.scheduled {
        task.scheduled = Some(scheduled.clone());
    }
    if let Some(ref contexts) = request.contexts {
        task.contexts.clone_from(contexts);
    }
    if let Some(ref projects) = request.projects {
        task.projects.clone_from(projects);
    }
    if let Some(ref tags) = request.tags {
        task.tags.clone_from(tags);
    }
    if let Some(ref recurrence) = request.recurrence {
        task.recurrence = Some(recurrence.clone());
    }
    if let Some(anchor) = request.recurrence_anchor {
        task.recurrence_anchor = Some(anchor);
    }
    if let Some(estimate) = request.time_estimate {
        task.time_estimate = Some(estimate);
    }
    if let Some(ref extra) = request.extra_fields {
        task.extra_fields = extra.clone();
    }
}

/// Write every field an update names onto a task, honouring `null` as delete.
fn write_update_fields(task: &mut Task, request: &UpdateTaskRequest) {
    if let Some(ref title) = request.title {
        task.title = title.as_str().to_owned();
    }
    if !request.details.is_unchanged() {
        task.details = request.details.value().cloned();
    }
    if let Some(status) = request.status {
        task.status = status;
    }
    if let Some(priority) = request.priority {
        task.priority = priority;
    }
    if !request.due.is_unchanged() {
        task.due = request.due.value().cloned();
    }
    if !request.scheduled.is_unchanged() {
        task.scheduled = request.scheduled.value().cloned();
    }
    if let Some(ref contexts) = request.contexts {
        task.contexts.clone_from(contexts);
    }
    if let Some(ref projects) = request.projects {
        task.projects.clone_from(projects);
    }
    if let Some(ref tags) = request.tags {
        task.tags.clone_from(tags);
    }
    if !request.recurrence.is_unchanged() {
        task.recurrence = request.recurrence.value().cloned();
    }
    if !request.recurrence_anchor.is_unchanged() {
        task.recurrence_anchor = request.recurrence_anchor.value().copied();
    }
    if !request.time_estimate.is_unchanged() {
        task.time_estimate = request.time_estimate.value().copied();
    }
    if let Some(ref extra) = request.extra_fields {
        task.extra_fields = extra.clone();
    }
}

impl FakeServer {
    /// A server that reads the scenario's clock.
    pub fn new(clock: std::sync::Arc<ManualClock>) -> Self {
        Self {
            clock,
            state: Mutex::new(ServerState::default()),
        }
    }

    /// Put tasks into the vault.
    pub fn seed(&self, tasks: impl IntoIterator<Item = Task>) {
        let mut state = lock(&self.state);
        for task in tasks {
            state.tasks.insert(task.id.clone(), task);
        }
    }

    /// A total outage: every call fails with a connection error.
    pub fn go_offline(&self) {
        lock(&self.state).offline = true;
    }

    /// Restore service.
    pub fn go_online(&self) {
        lock(&self.state).offline = false;
    }

    /// Inject a one-shot failure for the next call to one method.
    pub fn fail_next(&self, method: MutationMethod, error: Error) {
        lock(&self.state).fail_next.push((method, error));
    }

    /// Apply a concurrent Obsidian edit straight to the vault.
    ///
    /// # Errors
    ///
    /// The task does not exist. A scenario that mistypes an id should fail
    /// loudly rather than silently assert on nothing.
    pub fn inject_server_edit(
        &self,
        id: &TaskId,
        patch: impl FnOnce(&mut Task),
    ) -> core::result::Result<(), String> {
        let mut state = lock(&self.state);
        let task = state
            .tasks
            .get_mut(id)
            .ok_or_else(|| format!("inject_server_edit: unknown task {id}"))?;
        patch(task);
        Ok(())
    }

    /// The vault, in insertion order.
    pub fn tasks(&self) -> IndexMap<TaskId, Task> {
        lock(&self.state).tasks.clone()
    }

    /// Every call, in order.
    pub fn calls(&self) -> Vec<CallLogEntry> {
        lock(&self.state).calls.clone()
    }

    /// Log a call, then decide whether it may proceed.
    ///
    /// Order matters and mirrors the real middleware stack: the call is logged
    /// first (so a failed or offline call still counts), then the outage, then
    /// the injected one-shot failure, then the idempotency store.
    fn gate(
        state: &mut ServerState,
        method: MutationMethod,
        id: Option<String>,
        mutation_id: Option<&str>,
    ) -> Gate {
        state.calls.push(CallLogEntry {
            method,
            id,
            mutation_id: mutation_id.map(str::to_owned),
            replayed: false,
            applied: false,
        });

        if state.offline {
            return Gate::Fail(Error::connection_with("FakeServer is offline"));
        }
        if let Some(index) = state
            .fail_next
            .iter()
            .position(|&(candidate, _)| candidate == method)
        {
            let (_, error) = state.fail_next.remove(index);
            return Gate::Fail(error);
        }
        if let Some(mutation_id) = mutation_id
            && let Some(stored) = state.idempotency.get(mutation_id).cloned()
        {
            if let Some(entry) = state.calls.last_mut() {
                entry.replayed = true;
            }
            return Gate::Replay(stored);
        }
        Gate::Proceed
    }

    /// Mark the in-flight call as applied and remember its response.
    fn remember(state: &mut ServerState, mutation_id: Option<&str>, response: StoredResponse) {
        if let Some(entry) = state.calls.last_mut() {
            entry.applied = true;
        }
        if let Some(mutation_id) = mutation_id {
            state.idempotency.insert(mutation_id.to_owned(), response);
        }
    }

    /// Unwrap a replayed response that must be a task.
    fn replayed_task(stored: StoredResponse, method: MutationMethod) -> Result<Task> {
        match stored {
            StoredResponse::Task(task) => Ok(*task),
            StoredResponse::Void => Err(Error::invariant(format!(
                "the idempotency store held a void response for {method:?}"
            ))),
        }
    }
}

impl TaskApi for FakeServer {
    fn list_tasks(&self) -> Result<Vec<Task>> {
        let mut state = lock(&self.state);
        // A pull carries no idempotency key: it mutates nothing, so replaying
        // it is meaningless.
        match Self::gate(&mut state, MutationMethod::ListTasks, None, None) {
            Gate::Fail(error) => Err(error),
            Gate::Proceed | Gate::Replay(_) => Ok(state.tasks.values().cloned().collect()),
        }
    }

    fn create_task(&self, request: &CreateTaskRequest, mutation_id: Option<&str>) -> Result<Task> {
        let mut state = lock(&self.state);
        match Self::gate(&mut state, MutationMethod::CreateTask, None, mutation_id) {
            Gate::Fail(error) => return Err(error),
            Gate::Replay(stored) => {
                return Self::replayed_task(stored, MutationMethod::CreateTask);
            }
            Gate::Proceed => {}
        }

        state.create_counter = state.create_counter.saturating_add(1);
        let path = format!(
            "TaskNotes/{}-{}.md",
            request.title.as_str(),
            state.create_counter
        );
        let id = TaskId::parse(path.clone()).map_err(|error| {
            Error::validation(format!("the title made an illegal path: {error}"))
        })?;
        let stamp = chrono::DateTime::from_timestamp_millis(self.clock.now())
            .map(|instant| instant.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());

        let mut task = default_task();
        task.id = id.clone();
        task.path = path;
        task.date_created.clone_from(&stamp);
        task.date_modified = stamp;
        write_create_fields(&mut task, request);

        state.tasks.insert(id, task.clone());
        Self::remember(
            &mut state,
            mutation_id,
            StoredResponse::Task(Box::new(task.clone())),
        );
        Ok(task)
    }

    fn update_task(
        &self,
        id: &TaskId,
        request: &UpdateTaskRequest,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let mut state = lock(&self.state);
        match Self::gate(
            &mut state,
            MutationMethod::UpdateTask,
            Some(id.as_str().to_owned()),
            mutation_id,
        ) {
            Gate::Fail(error) => return Err(error),
            Gate::Replay(stored) => {
                return Self::replayed_task(stored, MutationMethod::UpdateTask);
            }
            Gate::Proceed => {}
        }

        let Some(existing) = state.tasks.get(id).cloned() else {
            return Err(Error::not_found("Task", id.as_str()));
        };
        let mut updated = existing;
        write_update_fields(&mut updated, request);
        state.tasks.insert(id.clone(), updated.clone());
        Self::remember(
            &mut state,
            mutation_id,
            StoredResponse::Task(Box::new(updated.clone())),
        );
        Ok(updated)
    }

    fn delete_task(&self, id: &TaskId, mutation_id: Option<&str>) -> Result<()> {
        let mut state = lock(&self.state);
        match Self::gate(
            &mut state,
            MutationMethod::DeleteTask,
            Some(id.as_str().to_owned()),
            mutation_id,
        ) {
            Gate::Fail(error) => return Err(error),
            // A replayed delete answers success without touching the vault —
            // which is exactly the crash-replay case.
            Gate::Replay(_) => return Ok(()),
            Gate::Proceed => {}
        }

        if !state.tasks.contains_key(id) {
            return Err(Error::not_found("Task", id.as_str()));
        }
        state.tasks.shift_remove(id);
        Self::remember(&mut state, mutation_id, StoredResponse::Void);
        Ok(())
    }

    fn toggle_task_status(
        &self,
        id: &TaskId,
        status: TaskStatus,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let mut state = lock(&self.state);
        match Self::gate(
            &mut state,
            MutationMethod::ToggleTaskStatus,
            Some(id.as_str().to_owned()),
            mutation_id,
        ) {
            Gate::Fail(error) => return Err(error),
            Gate::Replay(stored) => {
                return Self::replayed_task(stored, MutationMethod::ToggleTaskStatus);
            }
            Gate::Proceed => {}
        }

        let Some(mut updated) = state.tasks.get(id).cloned() else {
            return Err(Error::not_found("Task", id.as_str()));
        };
        updated.status = status;
        state.tasks.insert(id.clone(), updated.clone());
        Self::remember(
            &mut state,
            mutation_id,
            StoredResponse::Task(Box::new(updated.clone())),
        );
        Ok(updated)
    }

    fn complete_recurring_instance(
        &self,
        id: &TaskId,
        instance: Option<&InstanceCompletion>,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let mut state = lock(&self.state);
        match Self::gate(
            &mut state,
            MutationMethod::CompleteRecurringInstance,
            Some(id.as_str().to_owned()),
            mutation_id,
        ) {
            Gate::Fail(error) => return Err(error),
            Gate::Replay(stored) => {
                return Self::replayed_task(stored, MutationMethod::CompleteRecurringInstance);
            }
            Gate::Proceed => {}
        }

        let Some(mut updated) = state.tasks.get(id).cloned() else {
            return Err(Error::not_found("Task", id.as_str()));
        };

        match instance {
            None => {
                // Legacy fallback: toggle the server's own idea of "today",
                // derived from the *device-local* calendar. This is the branch
                // the `local_naive` fixtures exist for.
                let today = local_ymd(self.clock.now());
                if updated.complete_instances.contains(&today) {
                    updated.complete_instances.retain(|entry| *entry != today);
                } else {
                    updated.complete_instances.push(today);
                }
            }
            Some(instance) => {
                // Absolute set-semantics. Setting the same state twice is a
                // no-op, not a toggle — that is what makes a replayed command
                // safe.
                let present = updated.complete_instances.contains(&instance.date);
                if instance.completed && !present {
                    updated.complete_instances.push(instance.date.clone());
                } else if !instance.completed && present {
                    updated
                        .complete_instances
                        .retain(|entry| *entry != instance.date);
                }
            }
        }

        state.tasks.insert(id.clone(), updated.clone());
        Self::remember(
            &mut state,
            mutation_id,
            StoredResponse::Task(Box::new(updated.clone())),
        );
        Ok(updated)
    }
}
