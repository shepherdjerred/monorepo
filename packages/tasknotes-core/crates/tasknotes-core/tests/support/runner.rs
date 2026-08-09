//! The scenario interpreter: seventeen verbs and seventeen assertions.
//!
//! Actions run in order against a freshly built world; assertions are
//! declarative and run afterwards, against either the final world or a named
//! snapshot. A snapshot captures durable storage **and** the observable state
//! at one instant, and stays reusable after later actions — which is how a
//! crash scenario relaunches from *deliberately stale* durable state.

use std::{collections::BTreeMap, sync::Arc};

use indexmap::IndexMap;
use serde_json::{Value, json};
use tasknotes_core::{
    Error,
    domain::{Task, TaskId},
    store::TaskStore,
    sync::{
        Clock, Command, CommandInput, DeadLetterEntry, InstanceCompletion, QueueStorage,
        Randomness, RetryScheduler, SyncEngine, SyncState, TaskApi, TaskCacheStorage,
    },
};

use super::{
    fake_server::{CallLogEntry, FakeServer, default_task},
    harness::{
        DEFAULT_CLOCK_MS, HalfUnitRandomness, ManualClock, ManualScheduler, MemoryCacheStorage,
        MemoryQueueStorage, local_naive_millis,
    },
    model::{
        Action, Assertion, CallLogField, ClientCall, CountExpr, DispatchInput, FixtureTime,
        Scenario, TaskFields, TaskRef, TaskSource,
    },
};

/// A failure, with enough context to name the fixture and the exact clause.
type Outcome<T> = core::result::Result<T, String>;

/// Everything an assertion can look at, frozen at one instant.
#[derive(Debug, Clone)]
pub struct WorldView {
    pending_count: usize,
    pending_commands: Vec<Command>,
    store_tasks: IndexMap<TaskId, Task>,
    dead_letters: Vec<DeadLetterEntry>,
    last_sync_time: Option<i64>,
    engine_state: SyncState,
    scheduler_delays: Vec<i64>,
    server_tasks: IndexMap<TaskId, Task>,
    server_calls: Vec<CallLogEntry>,
}

impl WorldView {
    fn tasks(&self, source: TaskSource) -> &IndexMap<TaskId, Task> {
        match source {
            TaskSource::Store => &self.store_tasks,
            TaskSource::Server => &self.server_tasks,
        }
    }
}

/// Durable client storage plus the observable state, captured together.
struct SnapshotRecord {
    queue_storage: MemoryQueueStorage,
    cache_storage: MemoryCacheStorage,
    view: WorldView,
}

/// The simulated world: the client, and everything it talks to.
pub struct World {
    /// The manual clock every component reads.
    pub clock: Arc<ManualClock>,
    /// The in-memory server, which survives a relaunch.
    pub server: Arc<FakeServer>,
    /// Durable queue bytes.
    pub queue_storage: Arc<MemoryQueueStorage>,
    /// Durable base-cache bytes.
    pub cache_storage: Arc<MemoryCacheStorage>,
    /// The manual retry scheduler, which does **not** survive a relaunch.
    pub scheduler: Arc<ManualScheduler>,
    /// The client under test.
    pub engine: SyncEngine,
}

/// One scenario's run.
pub struct RunState {
    world: World,
    auto_sync: bool,
    results: BTreeMap<String, Value>,
    task_ids: BTreeMap<String, TaskId>,
    snapshots: BTreeMap<String, SnapshotRecord>,
}

/// Wire a fresh client over an existing clock and server.
///
/// Note what is *not* rebuilt on a relaunch: the clock and the server. The
/// server is what remembers which mutation ids it already applied, and
/// forgetting that would make every crash scenario trivially pass.
pub fn build_world(
    clock: Arc<ManualClock>,
    server: Arc<FakeServer>,
    queue_storage: Arc<MemoryQueueStorage>,
    cache_storage: Arc<MemoryCacheStorage>,
    auto_sync: bool,
) -> World {
    let scheduler = Arc::new(ManualScheduler::default());
    let random = Arc::new(HalfUnitRandomness);

    // Named bindings rather than `as Arc<dyn _>`: unsizing is the one coercion
    // `as` performs that is genuinely lossless, but the workspace bans the
    // operator outright and a type annotation says the same thing.
    let queue: Arc<dyn QueueStorage> = queue_storage.clone();
    let cache: Arc<dyn TaskCacheStorage> = cache_storage.clone();
    let ticker: Arc<dyn Clock> = clock.clone();
    let dice: Arc<dyn Randomness> = random.clone();
    let timers: Arc<dyn RetryScheduler> = scheduler.clone();
    let api: Arc<dyn TaskApi> = server.clone();

    let store = TaskStore::new(queue, cache, Arc::clone(&ticker), Arc::clone(&dice));
    let engine = SyncEngine::new(Some(api), store, ticker, timers, dice, auto_sync);
    World {
        clock,
        server,
        queue_storage,
        cache_storage,
        scheduler,
        engine,
    }
}

fn capture_view(world: &World) -> WorldView {
    let store = world.engine.store();
    let snapshot = store.snapshot();
    WorldView {
        pending_count: store.queue().pending().len(),
        pending_commands: store.queue().pending().to_vec(),
        store_tasks: snapshot.tasks.clone(),
        dead_letters: snapshot.dead_letters.clone(),
        last_sync_time: snapshot.last_sync_time,
        engine_state: world.engine.status().state,
        scheduler_delays: world.scheduler.pending_delays(),
        server_tasks: world.server.tasks(),
        server_calls: world.server.calls(),
    }
}

fn resolve_time(time: &FixtureTime) -> Outcome<i64> {
    match *time {
        FixtureTime::EpochMs { value } => Ok(value),
        FixtureTime::LocalNaive { ref value } => local_naive_millis(value),
    }
}

fn task_id(raw: &str) -> Outcome<TaskId> {
    TaskId::parse(raw).map_err(|error| format!("{raw:?} is not a task id: {error}"))
}

fn find_by_title(tasks: &IndexMap<TaskId, Task>, title: &str) -> Option<TaskId> {
    tasks
        .values()
        .find(|task| task.title == title)
        .map(|task| task.id.clone())
}

/// Overwrite the fields a fixture names on a task.
fn apply_task_fields(task: &mut Task, fields: &TaskFields) -> Outcome<()> {
    if let Some(ref id) = fields.id {
        task.id = task_id(id)?;
    }
    if let Some(ref path) = fields.path {
        task.path.clone_from(path);
    }
    if let Some(ref title) = fields.title {
        task.title.clone_from(title);
    }
    if let Some(status) = fields.status {
        task.status = status;
    }
    if let Some(priority) = fields.priority {
        task.priority = priority;
    }
    if let Some(ref due) = fields.due {
        task.due = Some(due.clone());
    }
    if let Some(ref scheduled) = fields.scheduled {
        task.scheduled = Some(scheduled.clone());
    }
    if let Some(ref recurrence) = fields.recurrence {
        task.recurrence = Some(recurrence.clone());
    }
    if let Some(ref instances) = fields.complete_instances {
        task.complete_instances.clone_from(instances);
    }
    if let Some(ref instances) = fields.skipped_instances {
        task.skipped_instances.clone_from(instances);
    }
    if let Some(ref contexts) = fields.contexts {
        task.contexts = parse_names(contexts, "context")?;
    }
    if let Some(ref projects) = fields.projects {
        task.projects = parse_names(projects, "project")?;
    }
    if let Some(ref tags) = fields.tags {
        task.tags = parse_names(tags, "tag")?;
    }
    if let Some(archived) = fields.archived {
        task.archived = archived;
    }
    if let Some(ref details) = fields.details {
        task.details = Some(details.clone());
    }
    Ok(())
}

fn parse_names<T>(values: &[String], noun: &str) -> Outcome<Vec<T>>
where
    T: TryFrom<String, Error = Error>,
{
    values
        .iter()
        .map(|value| {
            T::try_from(value.clone()).map_err(|error| format!("bad {noun} {value:?}: {error}"))
        })
        .collect()
}

/// Walk a dotted path; numeric segments index arrays.
fn read_path<'value>(root: &'value Value, path: &str) -> Option<&'value Value> {
    let mut current = root;
    for segment in path.split('.') {
        current = match *current {
            Value::Array(ref items) => items.get(segment.parse::<usize>().ok()?)?,
            Value::Object(ref map) => map.get(segment)?,
            _ => return None,
        };
    }
    Some(current)
}

fn to_value<T: serde::Serialize>(value: &T) -> Outcome<Value> {
    serde_json::to_value(value).map_err(|error| format!("could not render as JSON: {error}"))
}

fn ok_result(value: Value) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("ok".to_owned(), Value::Bool(true));
    object.insert("value".to_owned(), value);
    Value::Object(object)
}

fn err_result(error: &Error) -> Outcome<Value> {
    Ok(json!({ "ok": false, "error": to_value(error)? }))
}

fn result_of<T: serde::Serialize>(outcome: tasknotes_core::Result<T>) -> Outcome<Value> {
    match outcome {
        Ok(value) => Ok(ok_result(to_value(&value)?)),
        Err(ref error) => err_result(error),
    }
}

impl RunState {
    /// The id a *action* verb means by a task reference.
    ///
    /// Titles are looked up in the visible store first and the server second,
    /// which is how a scenario can address a task it only ever seeded
    /// server-side.
    fn action_task_id(&self, reference: &TaskRef) -> Outcome<TaskId> {
        match *reference {
            TaskRef::Title { ref value } => {
                let visible = &self.world.engine.store().snapshot().tasks;
                find_by_title(visible, value)
                    .or_else(|| find_by_title(&self.world.server.tasks(), value))
                    .ok_or_else(|| format!("no task titled {value:?} in the store or the server"))
            }
            TaskRef::Id { .. } | TaskRef::Ref { .. } | TaskRef::ResolvedRef { .. } => {
                self.resolve_task_ref(reference, &IndexMap::new())
            }
        }
    }

    /// The id an *assertion* means by a task reference.
    ///
    /// `collection` is consulted only for `by: "title"`; ids and bound refs
    /// resolve against the live world, since ids are stable and the alias map
    /// only ever grows.
    fn resolve_task_ref(
        &self,
        reference: &TaskRef,
        collection: &IndexMap<TaskId, Task>,
    ) -> Outcome<TaskId> {
        match *reference {
            TaskRef::Id { ref value } => task_id(value),
            TaskRef::Ref { ref value } => self.bound_task_id(value),
            TaskRef::ResolvedRef { ref value } => Ok(self
                .world
                .engine
                .store()
                .resolve_task_id(&self.bound_task_id(value)?)),
            TaskRef::Title { ref value } => find_by_title(collection, value)
                .ok_or_else(|| format!("no task titled {value:?} in the inspected set")),
        }
    }

    fn bound_task_id(&self, name: &str) -> Outcome<TaskId> {
        self.task_ids
            .get(name)
            .cloned()
            .ok_or_else(|| format!("no task bound to ref {name:?}"))
    }

    fn bound_result(&self, name: &str) -> Outcome<&Value> {
        self.results
            .get(name)
            .ok_or_else(|| format!("no result bound to ref {name:?}"))
    }

    /// The named snapshot's frozen state, or the live world when `at` is
    /// absent.
    fn view_at(&self, at: Option<&String>) -> Outcome<WorldView> {
        match at {
            None => Ok(capture_view(&self.world)),
            Some(name) => self
                .snapshots
                .get(name)
                .map(|record| record.view.clone())
                .ok_or_else(|| format!("unknown snapshot {name:?}")),
        }
    }

    fn count_of(&self, expr: &CountExpr, metric: impl Fn(&WorldView) -> usize) -> Outcome<usize> {
        match *expr {
            CountExpr::Literal { value } => {
                usize::try_from(value).map_err(|_ignored| format!("{value} is not a valid count"))
            }
            CountExpr::Snapshot { ref name } => Ok(metric(&self.view_at(Some(name))?)),
        }
    }

    /// The state the determinism meta-assertion compares.
    ///
    /// Deliberately excludes command ids and temp ids: both carry randomness by
    /// design, and pinning them would assert the opposite of what the scenario
    /// means.
    fn end_state_digest(&self) -> Outcome<Value> {
        let store = self.world.engine.store();
        Ok(json!({
            "serverTasks": entries(&self.world.server.tasks())?,
            "view": entries(&store.snapshot().tasks)?,
            "pending": store.snapshot().pending_count,
        }))
    }
}

fn entries(tasks: &IndexMap<TaskId, Task>) -> Outcome<Value> {
    tasks
        .iter()
        .map(|(id, task)| Ok(json!([id.as_str(), to_value(task)?])))
        .collect::<Outcome<Vec<Value>>>()
        .map(Value::Array)
}

fn call_log_field(entry: &CallLogEntry, field: CallLogField) -> Value {
    match field {
        CallLogField::Method => match serde_json::to_value(entry.method) {
            Ok(value) => value,
            Err(_ignored) => Value::Null,
        },
        CallLogField::Id => entry
            .id
            .as_ref()
            .map_or(Value::Null, |id| Value::String(id.clone())),
        CallLogField::MutationId => entry
            .mutation_id
            .as_ref()
            .map_or(Value::Null, |id| Value::String(id.clone())),
        CallLogField::Replayed => Value::Bool(entry.replayed),
        CallLogField::Applied => Value::Bool(entry.applied),
    }
}

/// Build a fresh world and run every action of a scenario in order.
///
/// # Errors
///
/// The first action that cannot be carried out, with its reason.
pub fn run_actions(scenario: &Scenario) -> Outcome<RunState> {
    let auto_sync = scenario.setup.auto_sync.unwrap_or(false);
    let start = match scenario.setup.clock {
        None => DEFAULT_CLOCK_MS,
        Some(ref time) => resolve_time(time)?,
    };
    let clock = Arc::new(ManualClock::new(start));
    let server = Arc::new(FakeServer::new(Arc::clone(&clock)));
    let world = build_world(
        Arc::clone(&clock),
        Arc::clone(&server),
        Arc::new(MemoryQueueStorage::default()),
        Arc::new(MemoryCacheStorage::default()),
        auto_sync,
    );
    let mut state = RunState {
        world,
        auto_sync,
        results: BTreeMap::new(),
        task_ids: BTreeMap::new(),
        snapshots: BTreeMap::new(),
    };

    for (index, action) in scenario.actions.iter().enumerate() {
        run_action(&mut state, action)
            .map_err(|reason| format!("action {index} ({action:?}) failed: {reason}"))?;
    }
    Ok(state)
}

/// The verbs that set up the world the client talks to.
fn run_world_action(state: &mut RunState, action: &Action) -> Outcome<bool> {
    match *action {
        Action::ServerSeed { ref tasks } => {
            let mut seeded = Vec::with_capacity(tasks.len());
            for fields in tasks {
                let mut task = default_task();
                apply_task_fields(&mut task, fields)?;
                seeded.push(task);
            }
            state.world.server.seed(seeded);
        }
        Action::ServerOffline => state.world.server.go_offline(),
        Action::ServerOnline => state.world.server.go_online(),
        Action::ServerFailNext { method, ref error } => {
            let error = Error::try_from(error.clone())
                .map_err(|failure| format!("the fixture's error is malformed: {failure}"))?;
            state.world.server.fail_next(method, error);
        }
        Action::ServerInjectEdit {
            ref task,
            ref patch,
        } => {
            let id = state.action_task_id(task)?;
            let mut failure = None;
            state.world.server.inject_server_edit(&id, |target| {
                failure = apply_task_fields(target, patch).err();
            })?;
            if let Some(reason) = failure {
                return Err(reason);
            }
        }
        Action::ClockSet { ref at } => state.world.clock.set(resolve_time(at)?),
        _ => return Ok(false),
    }
    Ok(true)
}

/// The verbs that drive the engine.
fn run_engine_action(state: &mut RunState, action: &Action) -> Outcome<bool> {
    match *action {
        Action::StoreRestore => state
            .world
            .engine
            .restore()
            .map_err(|error| format!("restore failed: {error}"))?,
        Action::SyncNow { ref bind } => {
            let value = match state.world.engine.sync_now() {
                Ok(()) => ok_result(Value::Null),
                Err(ref error) => err_result(error)?,
            };
            if let Some(name) = bind {
                state.results.insert(name.clone(), value);
            }
        }
        Action::RequestSync => state.world.engine.request_sync(),
        Action::SchedulerFireNext => {
            state.world.scheduler.fire_next()?;
            // The real timer callback triggers a sync; the harness does the
            // same rather than reaching back into the engine's internals.
            state.world.engine.request_sync();
        }
        Action::EngineDispose => state.world.engine.dispose(),
        Action::Settle => state.world.engine.settle(),
        Action::RetryDeadLetter { index } => {
            let id = state
                .world
                .engine
                .store()
                .snapshot()
                .dead_letters
                .get(index)
                .map(|entry| entry.command.id().to_owned())
                .ok_or_else(|| format!("no dead letter at index {index}"))?;
            state
                .world
                .engine
                .retry_dead_letter(&id)
                .map_err(|error| format!("retry failed: {error}"))?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// The two verbs that model a crash: freeze durable state, and come back from
/// it.
fn run_lifecycle_action(state: &mut RunState, action: &Action) -> Outcome<bool> {
    match *action {
        Action::Snapshot { ref bind } => {
            let record = SnapshotRecord {
                queue_storage: state.world.queue_storage.snapshot(),
                cache_storage: state.world.cache_storage.snapshot(),
                view: capture_view(&state.world),
            };
            state.snapshots.insert(bind.clone(), record);
        }
        Action::Relaunch { ref from } => {
            let record = state
                .snapshots
                .get(from)
                .ok_or_else(|| format!("unknown snapshot {from:?}"))?;
            let queue_storage = Arc::new(record.queue_storage.snapshot());
            let cache_storage = Arc::new(record.cache_storage.snapshot());
            state.world = build_world(
                Arc::clone(&state.world.clock),
                Arc::clone(&state.world.server),
                queue_storage,
                cache_storage,
                state.auto_sync,
            );
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn run_action(state: &mut RunState, action: &Action) -> Outcome<()> {
    if run_world_action(state, action)?
        || run_engine_action(state, action)?
        || run_lifecycle_action(state, action)?
    {
        return Ok(());
    }
    match *action {
        Action::Dispatch {
            ref input,
            ref bind,
        } => run_dispatch(state, input, bind.as_deref()),
        Action::ClientCall { ref call, ref bind } => run_client_call(state, call, bind.as_deref()),
        _ => Err(format!("{action:?} was not handled by any verb group")),
    }
}

fn run_dispatch(state: &mut RunState, input: &DispatchInput, bind: Option<&str>) -> Outcome<()> {
    let command = match *input {
        DispatchInput::Create { ref payload } => CommandInput::Create {
            payload: payload.clone(),
        },
        DispatchInput::Update {
            ref task,
            ref payload,
        } => CommandInput::Update {
            task_id: state.action_task_id(task)?,
            payload: payload.clone(),
        },
        DispatchInput::Delete { ref task } => CommandInput::Delete {
            task_id: state.action_task_id(task)?,
        },
        DispatchInput::SetStatus { ref task, status } => CommandInput::SetStatus {
            task_id: state.action_task_id(task)?,
            status,
        },
        DispatchInput::SetInstanceComplete {
            ref task,
            ref date,
            completed,
        } => CommandInput::SetInstanceComplete {
            task_id: state.action_task_id(task)?,
            date: date.clone(),
            completed,
        },
    };

    let optimistic = state
        .world
        .engine
        .dispatch(command)
        .map_err(|error| format!("dispatch failed: {error}"))?;

    let Some(name) = bind else {
        return Ok(());
    };
    let task = optimistic
        .ok_or_else(|| format!("dispatch bound to {name:?} produced no optimistic task"))?;
    state.task_ids.insert(name.to_owned(), task.id);
    Ok(())
}

fn run_client_call(state: &mut RunState, call: &ClientCall, bind: Option<&str>) -> Outcome<()> {
    let server: &dyn TaskApi = state.world.server.as_ref();
    let value = match *call {
        ClientCall::ListTasks => result_of(server.list_tasks())?,
        ClientCall::CreateTask {
            ref request,
            ref mutation_id,
        } => result_of(server.create_task(request, mutation_id.as_deref()))?,
        ClientCall::UpdateTask {
            ref task,
            ref request,
            ref mutation_id,
        } => {
            let id = state.action_task_id(task)?;
            result_of(server.update_task(&id, request, mutation_id.as_deref()))?
        }
        ClientCall::DeleteTask {
            ref task,
            ref mutation_id,
        } => {
            let id = state.action_task_id(task)?;
            match server.delete_task(&id, mutation_id.as_deref()) {
                Ok(()) => ok_result(Value::Null),
                Err(ref error) => err_result(error)?,
            }
        }
        ClientCall::ToggleTaskStatus {
            ref task,
            status,
            ref mutation_id,
        } => {
            let id = state.action_task_id(task)?;
            result_of(server.toggle_task_status(&id, status, mutation_id.as_deref()))?
        }
        ClientCall::CompleteRecurringInstance {
            ref task,
            ref instance,
            ref mutation_id,
        } => {
            let id = state.action_task_id(task)?;
            let instance: Option<&InstanceCompletion> = instance.as_ref();
            result_of(server.complete_recurring_instance(&id, instance, mutation_id.as_deref()))?
        }
    };

    if let Some(name) = bind {
        state.results.insert(name.to_owned(), value);
    }
    Ok(())
}

/// Run a scenario end to end.
///
/// # Errors
///
/// The first action or assertion that fails, named.
pub fn run(scenario: &Scenario) -> Outcome<()> {
    let state = run_actions(scenario)?;
    for (index, assertion) in scenario.assertions.iter().enumerate() {
        check(scenario, &state, assertion)
            .map_err(|reason| format!("assertion {index} ({assertion:?}): {reason}"))?;
    }
    Ok(())
}

fn expect_equal(actual: &Value, expected: &Value, what: &str) -> Outcome<()> {
    if actual == expected {
        return Ok(());
    }
    Err(format!("{what}: expected {expected}, got {actual}"))
}

/// The three assertions about a bound call result.
fn check_result(state: &RunState, assertion: &Assertion) -> Outcome<bool> {
    match *assertion {
        Assertion::Result {
            ref reference,
            ok,
            ref error_kind,
        } => {
            let result = state.bound_result(reference)?;
            expect_equal(
                result.get("ok").unwrap_or(&Value::Null),
                &Value::Bool(ok),
                "result.ok",
            )?;
            if let Some(ref kind) = *error_kind {
                expect_equal(
                    read_path(result, "error.kind").unwrap_or(&Value::Null),
                    &Value::String(kind.clone()),
                    "result.error.kind",
                )?;
            }
        }
        Assertion::ResultField {
            ref reference,
            ref path,
            ref equals,
        } => {
            let result = state.bound_result(reference)?;
            let actual = read_path(result, path)
                .ok_or_else(|| format!("no value at {path:?} in {result}"))?;
            expect_equal(actual, equals, path)?;
        }
        Assertion::ResultsFieldEqual { ref refs, ref path } => {
            let (Some(left), Some(right)) = (refs.first(), refs.get(1)) else {
                return Err("results_field_equal needs two refs".to_owned());
            };
            let left = state.bound_result(left)?;
            let right = state.bound_result(right)?;
            expect_equal(
                read_path(left, path).unwrap_or(&Value::Null),
                read_path(right, path).unwrap_or(&Value::Null),
                path,
            )?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// The four assertions about tasks.
fn check_tasks(state: &RunState, assertion: &Assertion) -> Outcome<bool> {
    match *assertion {
        Assertion::TaskCount {
            ref at,
            source,
            ref equals,
        } => {
            let view = state.view_at(at.as_ref())?;
            let expected = state.count_of(equals, |other| other.tasks(source).len())?;
            expect_equal(
                &json!(view.tasks(source).len()),
                &json!(expected),
                "task_count",
            )?;
        }
        Assertion::TaskField {
            ref at,
            source,
            ref task,
            ref path,
            ref equals,
        } => {
            let view = state.view_at(at.as_ref())?;
            let tasks = view.tasks(source);
            let id = state.resolve_task_ref(task, tasks)?;
            let found = tasks
                .get(&id)
                .ok_or_else(|| format!("no {source:?} task {id}"))?;
            let rendered = to_value(found)?;
            let actual = read_path(&rendered, path)
                .ok_or_else(|| format!("no value at {path:?} in {rendered}"))?;
            expect_equal(actual, equals, path)?;
        }
        Assertion::TaskExists {
            ref at,
            source,
            ref task,
            exists,
        } => {
            let view = state.view_at(at.as_ref())?;
            let tasks = view.tasks(source);
            let present = match *task {
                TaskRef::Title { ref value } => find_by_title(tasks, value).is_some(),
                TaskRef::Id { .. } | TaskRef::Ref { .. } | TaskRef::ResolvedRef { .. } => {
                    tasks.contains_key(&state.resolve_task_ref(task, tasks)?)
                }
            };
            expect_equal(&Value::Bool(present), &Value::Bool(exists), "task_exists")?;
        }
        Assertion::TaskIdIsTemp { ref task, equals } => {
            let visible = state.world.engine.store().snapshot().tasks.clone();
            let id = state.resolve_task_ref(task, &visible)?;
            expect_equal(
                &Value::Bool(id.is_temp()),
                &Value::Bool(equals),
                "task_id_is_temp",
            )?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// The four assertions about the queue and the dead-letter list.
fn check_queue(state: &RunState, assertion: &Assertion) -> Outcome<bool> {
    match *assertion {
        Assertion::PendingCount { ref at, ref equals } => {
            let view = state.view_at(at.as_ref())?;
            let expected = state.count_of(equals, |other| other.pending_count)?;
            expect_equal(
                &json!(view.pending_count),
                &json!(expected),
                "pending_count",
            )?;
        }
        Assertion::QueuePendingEquals { ref at } => {
            let live = capture_view(&state.world);
            let frozen = state.view_at(Some(at))?;
            expect_equal(
                &to_value(&live.pending_commands)?,
                &to_value(&frozen.pending_commands)?,
                "queue_pending",
            )?;
        }
        Assertion::DeadLetterCount { ref at, equals } => {
            let view = state.view_at(at.as_ref())?;
            expect_equal(
                &json!(view.dead_letters.len()),
                &json!(equals),
                "dead_letter_count",
            )?;
        }
        Assertion::DeadLetterField {
            ref at,
            index,
            ref path,
            ref equals,
        } => {
            let view = state.view_at(at.as_ref())?;
            let entry = view
                .dead_letters
                .get(index)
                .ok_or_else(|| format!("no dead letter at index {index}"))?;
            let rendered = to_value(entry)?;
            let actual = read_path(&rendered, path)
                .ok_or_else(|| format!("no value at {path:?} in {rendered}"))?;
            expect_equal(actual, equals, path)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// The five assertions about the engine, the scheduler and the wire.
fn check_engine(state: &RunState, assertion: &Assertion) -> Outcome<bool> {
    match *assertion {
        Assertion::LastSyncTime { ref at, ref equals } => {
            let view = state.view_at(at.as_ref())?;
            let expected = match *equals {
                None => Value::Null,
                Some(ref time) => json!(resolve_time(time)?),
            };
            expect_equal(&json!(view.last_sync_time), &expected, "last_sync_time")?;
        }
        Assertion::EngineState { ref at, ref equals } => {
            let view = state.view_at(at.as_ref())?;
            expect_equal(
                &to_value(&view.engine_state)?,
                &Value::String(equals.clone()),
                "engine_state",
            )?;
        }
        Assertion::SchedulerPending {
            ref at,
            count,
            ref delays,
        } => {
            let view = state.view_at(at.as_ref())?;
            if let Some(count) = count {
                expect_equal(
                    &json!(view.scheduler_delays.len()),
                    &json!(count),
                    "scheduler_pending.count",
                )?;
            }
            if let Some(ref delays) = *delays {
                expect_equal(
                    &json!(view.scheduler_delays),
                    &json!(delays),
                    "scheduler_pending.delays",
                )?;
            }
        }
        Assertion::CallCount {
            ref at,
            method,
            applied,
            equals,
        } => {
            let view = state.view_at(at.as_ref())?;
            let matched = view
                .server_calls
                .iter()
                .filter(|entry| entry.method == method && (applied != Some(true) || entry.applied))
                .count();
            expect_equal(&json!(matched), &json!(equals), "call_count")?;
        }
        Assertion::CallLog {
            ref at,
            index,
            field,
            ref equals,
        } => {
            let view = state.view_at(at.as_ref())?;
            match index {
                None => {
                    let actual: Vec<Value> = view
                        .server_calls
                        .iter()
                        .map(|entry| call_log_field(entry, field))
                        .collect();
                    expect_equal(&Value::Array(actual), equals, "call_log")?;
                }
                Some(index) => {
                    let entry = view
                        .server_calls
                        .get(index)
                        .ok_or_else(|| format!("no call at index {index}"))?;
                    expect_equal(&call_log_field(entry, field), equals, "call_log")?;
                }
            }
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn check(scenario: &Scenario, state: &RunState, assertion: &Assertion) -> Outcome<()> {
    if check_result(state, assertion)?
        || check_tasks(state, assertion)?
        || check_queue(state, assertion)?
        || check_engine(state, assertion)?
    {
        return Ok(());
    }
    match *assertion {
        // The one meta-assertion: run the whole scenario again and require the
        // two end states to be identical. Determinism is the property every
        // other fixture rests on.
        Assertion::DeterministicEndState => {
            let replay = run_actions(scenario)?;
            expect_equal(
                &replay.end_state_digest()?,
                &state.end_state_digest()?,
                "deterministic_end_state",
            )
        }
        _ => Err(format!(
            "{assertion:?} was not handled by any assertion group"
        )),
    }
}
