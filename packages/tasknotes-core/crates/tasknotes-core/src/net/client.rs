//! The `/v2` client: the wire boundary, owned by the core.
//!
//! Everything between "the engine wants to create a task" and "these bytes go
//! to this URL" happens here, and nowhere else:
//!
//! | step | who |
//! |---|---|
//! | path, query, percent-escaping | [`super::endpoints`] |
//! | the four-entry rename table, the outbound body | [`crate::domain::wire`] |
//! | headers, including `X-Mutation-Id` | this module |
//! | the bytes on the socket | the host's [`HttpClient`] |
//! | HTTP status → [`Error`] | this module |
//! | the `{ success, data, error }` envelope | [`unwrap_envelope`] |
//! | wire task → [`Task`] | [`WireTask`]'s `TryFrom` |
//!
//! It is a line-by-line counterpart of the reference TypeScript
//! `TaskNotesClient`, deliberately: the two are the anti-drift pair the shared
//! scenario corpus exists to keep honest. Where a choice looks arbitrary — a
//! `PUT` for a status change, advancing pagination by what was received rather
//! than by the declared limit, `NotFoundError("resource", path)` — it is the
//! reference client's choice and the comment says why.
//!
//! ## Auth is not here
//!
//! No `Authorization` header is invented by the core. The token comes from the
//! platform keychain, and a shell that already holds it adds the header in its
//! [`HttpClient`] — which also means the core never holds a secret it has no
//! use for. What the core owns is everything the *contract* depends on.

use std::{collections::BTreeSet, sync::Arc};

use serde_json::{Map, Value};

use super::{
    api::{InstanceCompletion, TaskApi},
    endpoints,
    http::{HttpClient, HttpHeader, HttpMethod, HttpRequest, HttpResponse, TransportError},
};
use crate::{
    Error, Result,
    domain::{
        CreateTaskRequest, PomodoroStatus, Task, TaskId, TaskStatus, TaskTime, TimeSummary,
        UpdateTaskRequest,
        wire::{
            WireDeleteResponse, WireTask, WireTaskList, WireTaskTime, WireTimeSummary,
            create_task_body, unwrap_envelope, update_task_body,
        },
    },
};

/// The idempotency-key header the server's middleware reads.
pub const MUTATION_ID_HEADER: &str = "X-Mutation-Id";

/// The header the server sets when it answered from its idempotency store
/// rather than by applying the mutation again.
///
/// Not acted on: a replay and a fresh application are the same outcome to the
/// engine, which is the entire point of an idempotent mutation. It is named
/// here because moving the boundary down made it *visible* to the core for the
/// first time — both shells were dropping it on the floor — so a future
/// diagnostic can read it off [`HttpResponse::header`] without another round of
/// shell changes.
pub const IDEMPOTENT_REPLAY_HEADER: &str = "X-Idempotent-Replay";

/// How long one request may take, matching the reference TypeScript client so
/// the retry classifier sees the same timing on both clients.
pub const DEFAULT_REQUEST_TIMEOUT_MILLIS: u32 = 15_000;

/// How many times a full pull re-reads the task list from the beginning when
/// the vault changed underneath the previous read.
///
/// Bounded rather than open-ended: a vault being edited continuously would
/// otherwise hold one sync pass reading forever, and a pass that gives up is
/// not a pull that is lost — the engine arms its retry timer on the failure and
/// tries again.
const LIST_PULL_ATTEMPTS: u32 = 3;

/// The TaskNotes `/v2` API, over a host-supplied transport.
pub struct TaskNotesClient {
    transport: Arc<dyn HttpClient>,
    base_url: String,
    timeout_millis: u32,
}

impl core::fmt::Debug for TaskNotesClient {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("TaskNotesClient")
            .field("base_url", &self.base_url)
            .field("timeout_millis", &self.timeout_millis)
            .finish_non_exhaustive()
    }
}

impl TaskNotesClient {
    /// A client against `base_url`, using `transport` for every request.
    ///
    /// Trailing slashes are trimmed, matching the reference client's
    /// `baseUrl.replace(/\/+$/, "")`, so `http://host:8080/` and
    /// `http://host:8080` build identical URLs rather than one of them
    /// producing `//api/tasks`.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Validation`] when `base_url` is empty or carries no
    /// scheme. Checked here rather than left to fail per-request because the
    /// engine is constructed once per configured server: a typo should be
    /// reported when the user saves the setting, not eight seconds later as a
    /// mysterious transport failure.
    pub fn new(
        transport: Arc<dyn HttpClient>,
        base_url: &str,
        timeout_millis: u32,
    ) -> Result<Self> {
        let trimmed = base_url.trim_end_matches('/');
        let scheme = trimmed.split_once("://").map(|(scheme, _)| scheme);
        match scheme {
            Some(scheme) if !scheme.is_empty() => {}
            _ => {
                return Err(Error::validation(format!(
                    "the server address {base_url:?} needs a scheme, as in http://host:8080"
                )));
            }
        }
        Ok(Self {
            transport,
            base_url: trimmed.to_owned(),
            timeout_millis,
        })
    }

    /// The normalized server address every request is built against.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Abandon every request currently in flight.
    ///
    /// Forwards to [`HttpClient::cancel_all`]. Takes `&self` and no lock, so it
    /// stays callable from another thread while a request is blocked — which is
    /// the only moment it is useful.
    pub fn cancel_all(&self) {
        self.transport.cancel_all();
    }

    // ── Request plumbing ───────────────────────────────────────────────────

    /// Send one request and return its unwrapped JSON payload.
    fn request(
        &self,
        method: HttpMethod,
        path: &str,
        body: Option<Map<String, Value>>,
        mutation_id: Option<&str>,
    ) -> Result<Value> {
        let encoded = body.map(|fields| serde_json::to_vec(&Value::Object(fields)));
        let body = match encoded {
            None => None,
            Some(Ok(bytes)) => Some(bytes),
            Some(Err(error)) => {
                return Err(Error::invariant(format!(
                    "could not serialize the body for {path}: {error}"
                )));
            }
        };

        // Header order is fixed rather than incidental, so a shell that logs or
        // signs the request sees the same sequence on every platform. It also
        // matches the reference client's insertion order.
        let mut headers = Vec::new();
        if body.is_some() {
            headers.push(HttpHeader::new("Content-Type", "application/json"));
        }
        if let Some(mutation_id) = mutation_id {
            headers.push(HttpHeader::new(MUTATION_ID_HEADER, mutation_id));
        }

        let request = HttpRequest {
            method,
            url: format!("{}{path}", self.base_url),
            headers,
            body,
            timeout_millis: self.timeout_millis,
        };

        let response = self
            .transport
            .send(&request)
            .map_err(|error| self.transport_failure(&error))?;
        Self::payload(&response, path)
    }

    /// Map a transport failure onto the core's error vocabulary.
    ///
    /// Every kind lands on [`Error::Connection`], which the classifier calls
    /// transient — a timeout, a refused connection and a failed handshake are
    /// all "try again later" as far as a queued command is concerned, and the
    /// reference TypeScript client makes exactly the same collapse. The kind
    /// survives in the message, which is what a user or a log actually needs.
    fn transport_failure(&self, error: &TransportError) -> Error {
        let base = &self.base_url;
        let message = &error.message;
        match error.kind {
            super::http::TransportErrorKind::Timeout => Error::connection_with(format!(
                "Request to {base} timed out after {}ms: {message}",
                self.timeout_millis
            )),
            super::http::TransportErrorKind::Offline
            | super::http::TransportErrorKind::Tls
            | super::http::TransportErrorKind::Other => {
                Error::connection_with(format!("Failed to connect to {base}: {message}"))
            }
        }
    }

    /// Turn a response into its unwrapped payload, or into the failure the
    /// classifier reads.
    ///
    /// **This mapping is core policy, and that is the point of the refactor.**
    /// [`classify`](crate::sync::classify) branches on exactly
    /// [`Error::kind`] and [`Error::status`], so while every shell owned this
    /// step, correct retry behaviour depended on three separate
    /// implementations agreeing by convention. Now there is one.
    fn payload(response: &HttpResponse, path: &str) -> Result<Value> {
        if !response.is_success() {
            return Err(Self::failure(response, path));
        }
        let body = strip_bom(&response.body);
        let json: Value = serde_json::from_slice(body).map_err(|error| {
            Error::validation(format!(
                "Failed to parse JSON response from {path}: {error}"
            ))
        })?;
        unwrap_envelope(json)
    }

    /// The error a non-2xx response becomes.
    fn failure(response: &HttpResponse, path: &str) -> Error {
        // A sibling of `Api`, not a subclass: the engine treats `NotFound` on a
        // delete as success and on an update as a rename to remap, so it must
        // not be reachable by matching a generic API failure first.
        if response.status == crate::NOT_FOUND_STATUS {
            return Error::not_found("resource", path);
        }
        // The body is a diagnostic here, so an undecodable one is described
        // rather than thrown: replacing this failure with a different one would
        // lose the status code, which is the part the classifier reads.
        let detail =
            core::str::from_utf8(strip_bom(&response.body)).map_or("<non-UTF-8 body>", str::trim);
        let status = response.status;
        if detail.is_empty() {
            Error::api(format!("HTTP {status} for {path}"), status)
        } else {
            Error::api(format!("HTTP {status} for {path}: {detail}"), status)
        }
    }

    /// One attempt at reading the whole task list.
    ///
    /// `None` is not a failure: it means the vault changed between two page
    /// requests, so what was collected cannot be trusted and the caller should
    /// start over. See [`TaskNotesClient::list_tasks`] for why that is the only
    /// defence available against an offset-paged live array.
    fn list_one_pass(&self) -> Result<Option<Vec<Task>>> {
        let mut tasks: Vec<Task> = Vec::new();
        let mut seen: BTreeSet<TaskId> = BTreeSet::new();
        let mut declared_total: Option<u32> = None;
        let mut offset: u32 = 0;
        loop {
            let path = format!(
                "{}?{}",
                endpoints::TASKS,
                endpoints::tasks_page_query(offset)
            );
            let payload = self.request(HttpMethod::Get, &path, None, None)?;
            let page: WireTaskList = serde_json::from_value(payload).map_err(|error| {
                Error::validation(format!(
                    "the task list page did not match the schema: {error}"
                ))
            })?;

            let total = page.pagination.total;
            // A total that moved is a create or a delete that landed between two
            // requests, which is exactly what shifts every later offset.
            if *declared_total.get_or_insert(total) != total {
                return Ok(None);
            }
            let has_more = page.pagination.has_more;
            let received = page.tasks.len();
            for wire in page.tasks {
                let listed_details = wire.details.is_some();
                let mut task = Task::try_from(wire)?;
                // Older TaskNotes servers omit note bodies from collection
                // pages even though the single-task endpoint carries them.
                // A pull replaces the store's whole base, so accepting that
                // omission would erase a body that a preceding PUT had just
                // acknowledged. Hydrate only those legacy rows; current
                // servers include `details` (including an empty string) and
                // stay at one request per page.
                if !listed_details {
                    let path = endpoints::task(&task.id);
                    task = Self::task(self.request(HttpMethod::Get, &path, None, None)?)?;
                }
                // The server lists a vault path once, so a repeat is an item
                // that moved across a page boundary rather than a duplicate
                // task — and wherever one repeated, another was skipped.
                if !seen.insert(task.id.clone()) {
                    return Ok(None);
                }
                tasks.push(task);
            }

            if !has_more {
                // Starting at zero and advancing by what arrived visits every
                // index exactly once, so a list shorter than the server's own
                // count means indices moved out from under the walk.
                let collected = u32::try_from(tasks.len()).map_err(|_ignored| {
                    Error::invariant(format!(
                        "a task list of {} tasks is not a length this contract can express",
                        tasks.len()
                    ))
                })?;
                return Ok((collected == total).then_some(tasks));
            }
            let advance = u32::try_from(received).map_err(|_ignored| {
                Error::invariant(format!(
                    "a task list page held {received} tasks, which is not a page"
                ))
            })?;
            if advance == 0 {
                return Err(Error::api(
                    "Task list pagination returned an empty page while hasMore=true",
                    0,
                ));
            }
            offset = offset.saturating_add(advance);
        }
    }

    /// Parse a payload that must be a single task.
    fn task(payload: Value) -> Result<Task> {
        let wire: WireTask = serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!("the server did not answer with a task: {error}"))
        })?;
        Task::try_from(wire)
    }

    /// Start tracking time against one task and return the updated task.
    ///
    /// This is intentionally a live request rather than a queued engine
    /// mutation: the server owns the active-session clock, and replaying a
    /// start after an arbitrary offline interval would create a false entry.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and task-validation failures.
    pub fn start_time_tracking(&self, id: &TaskId) -> Result<Task> {
        Self::task(self.request(
            HttpMethod::Post,
            &endpoints::task_time_start(id),
            None,
            None,
        )?)
    }

    /// Stop tracking time against one task and return the updated task.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and task-validation failures.
    pub fn stop_time_tracking(&self, id: &TaskId) -> Result<Task> {
        Self::task(self.request(HttpMethod::Post, &endpoints::task_time_stop(id), None, None)?)
    }

    /// Read the server-computed time totals for one task.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn task_time(&self, id: &TaskId) -> Result<TaskTime> {
        let payload = self.request(HttpMethod::Get, &endpoints::task_time(id), None, None)?;
        let wire: WireTaskTime = serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the task time response did not match the schema: {error}"
            ))
        })?;
        Ok(TaskTime::from(wire))
    }

    /// Read the server-computed aggregate time report for one named period.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn time_summary(&self, period: &str) -> Result<TimeSummary> {
        let payload = self.request(
            HttpMethod::Get,
            &endpoints::time_summary(period),
            None,
            None,
        )?;
        let wire: WireTimeSummary = serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the time summary response did not match the schema: {error}"
            ))
        })?;
        TimeSummary::try_from(wire)
    }

    /// Start a server-backed focus interval, optionally assigned to a task.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn start_pomodoro(&self, task_id: Option<&TaskId>) -> Result<PomodoroStatus> {
        let body = task_id.map(|id| {
            let mut fields = Map::new();
            fields.insert("taskId".to_owned(), Value::String(id.as_str().to_owned()));
            fields
        });
        let payload = self.request(HttpMethod::Post, endpoints::POMODORO_START, body, None)?;
        serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the pomodoro start response did not match the schema: {error}"
            ))
        })
    }

    /// Toggle the current server-backed interval between running and paused.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn pause_pomodoro(&self) -> Result<PomodoroStatus> {
        self.pomodoro_mutation(endpoints::POMODORO_PAUSE, "pause")
    }

    /// Stop the current server-backed interval.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn stop_pomodoro(&self) -> Result<PomodoroStatus> {
        self.pomodoro_mutation(endpoints::POMODORO_STOP, "stop")
    }

    /// Read the current server-backed interval.
    ///
    /// # Errors
    ///
    /// Propagates transport, HTTP, envelope, and schema failures.
    pub fn pomodoro_status(&self) -> Result<PomodoroStatus> {
        let payload = self.request(HttpMethod::Get, endpoints::POMODORO_STATUS, None, None)?;
        serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the pomodoro status response did not match the schema: {error}"
            ))
        })
    }

    fn pomodoro_mutation(&self, path: &str, operation: &str) -> Result<PomodoroStatus> {
        let payload = self.request(HttpMethod::Post, path, None, None)?;
        serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the pomodoro {operation} response did not match the schema: {error}"
            ))
        })
    }
}

/// Drop a leading UTF-8 byte-order mark.
///
/// The reason bodies cross the FFI as bytes rather than as a `String`:
/// UniFFI's `FfiConverterString` strips a BOM on its own, silently, which is
/// one of the bugs the `=0.31.2` pin exists for. Bytes mean the core sees
/// exactly what the server sent — and then decides, here and visibly, that a
/// BOM is framing rather than content, because every JSON parser rejects one.
fn strip_bom(body: &[u8]) -> &[u8] {
    body.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(body)
}

impl TaskApi for TaskNotesClient {
    /// Pull every task, as one internally consistent list.
    ///
    /// The `/v2` list endpoint caps `limit` at 200, so this pages until
    /// `hasMore` is false. It advances by what it actually received rather than
    /// by the declared limit, so a short page — items deleted mid-pagination —
    /// cannot skip the gap items; a page that is empty while `hasMore` is true
    /// is a broken server contract and fails loudly rather than looping forever
    /// on a zero-length advance.
    ///
    /// ## Why a pass can be thrown away and started again
    ///
    /// The endpoint pages by **offset into a live array** — the server slices
    /// `repo.list()` per request and holds nothing still between them — so a
    /// create or a delete landing ahead of the current offset shifts every item
    /// after it. Advancing the offset then skips or repeats a task, and the
    /// engine hands whatever came back to `replace_base`, which treats it as the
    /// authoritative list: a task the vault still holds disappears from the app
    /// until some later pull happens to catch it. So each pass validates itself
    /// — a stable `total`, no task twice, and exactly `total` tasks at the end —
    /// and a pass that fails any of the three is discarded and re-run rather
    /// than returned.
    ///
    /// ⚠️ **One race stays open, and it cannot be closed from this side.** A
    /// create and a delete landing between the same two requests leave `total`
    /// unchanged and every count consistent while one task quietly takes
    /// another's place. Detecting that needs the server to name the revision it
    /// answered from, which the `/v2` contract has no field for.
    fn list_tasks(&self) -> Result<Vec<Task>> {
        for _attempt in 0..LIST_PULL_ATTEMPTS {
            if let Some(tasks) = self.list_one_pass()? {
                return Ok(tasks);
            }
        }
        Err(Error::api(
            format!(
                "the task list changed underneath {LIST_PULL_ATTEMPTS} consecutive reads, so no \
                 complete list could be taken"
            ),
            0,
        ))
    }

    fn create_task(&self, request: &CreateTaskRequest, mutation_id: Option<&str>) -> Result<Task> {
        let body = create_task_body(request)?;
        Self::task(self.request(HttpMethod::Post, endpoints::TASKS, Some(body), mutation_id)?)
    }

    fn update_task(
        &self,
        id: &TaskId,
        request: &UpdateTaskRequest,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let body = update_task_body(request)?;
        Self::task(self.request(
            HttpMethod::Put,
            &endpoints::task(id),
            Some(body),
            mutation_id,
        )?)
    }

    fn delete_task(&self, id: &TaskId, mutation_id: Option<&str>) -> Result<()> {
        let payload = self.request(HttpMethod::Delete, &endpoints::task(id), None, mutation_id)?;
        // Upstream answers `{ message }`, not `{ success }`. Parsed rather than
        // discarded so a server that changed its mind about the contract is
        // caught here, exactly as the reference client does.
        let _response: WireDeleteResponse = serde_json::from_value(payload).map_err(|error| {
            Error::validation(format!(
                "the delete response did not match the schema: {error}"
            ))
        })?;
        Ok(())
    }

    /// Set a task's status to an absolute value.
    ///
    /// Deliberately a `PUT`, not the `/toggle-status` endpoint. That endpoint
    /// takes no body and cycles server-side, which is useless for idempotent
    /// offline replay: replaying a cycle twice lands somewhere different from
    /// replaying it once. Absolute state is what makes a queued command safe to
    /// re-send, so the app's semantics ride on `PUT` — exactly as the reference
    /// TypeScript client does.
    fn toggle_task_status(
        &self,
        id: &TaskId,
        status: TaskStatus,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let mut body = Map::new();
        body.insert(
            "status".to_owned(),
            Value::String(status.as_str().to_owned()),
        );
        Self::task(self.request(
            HttpMethod::Put,
            &endpoints::task(id),
            Some(body),
            mutation_id,
        )?)
    }

    /// Set one occurrence of a recurring task to an absolute completion state.
    ///
    /// A body and no body are two different requests, not a present-or-absent
    /// value: without one the server falls back to its legacy toggle-today
    /// behaviour, and with `{}` it would try to parse one.
    fn complete_recurring_instance(
        &self,
        id: &TaskId,
        instance: Option<&InstanceCompletion>,
        mutation_id: Option<&str>,
    ) -> Result<Task> {
        let body = match instance {
            None => None,
            Some(instance) => {
                let mut fields = Map::new();
                fields.insert("date".to_owned(), Value::String(instance.date.clone()));
                fields.insert("completed".to_owned(), Value::Bool(instance.completed));
                // Sent only when clearing an occurrence — the server rejects a
                // restore beside `completed: true` outright — and omitted
                // entirely when absent, because a `null` would fail the same
                // schema that a missing key satisfies.
                if let Some(ref restore) = instance.restore {
                    fields.insert(
                        "restore".to_owned(),
                        serde_json::to_value(restore).map_err(|error| {
                            Error::invariant(format!(
                                "could not serialize the recurrence restore: {error}"
                            ))
                        })?,
                    );
                }
                Some(fields)
            }
        };
        Self::task(self.request(
            HttpMethod::Post,
            &endpoints::task_complete_instance(id),
            body,
            mutation_id,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::{Value, json};

    use super::{
        DEFAULT_REQUEST_TIMEOUT_MILLIS, IDEMPOTENT_REPLAY_HEADER, MUTATION_ID_HEADER,
        TaskNotesClient, strip_bom,
    };
    use crate::{
        ErrorKind,
        domain::{
            CreateTaskRequest, FieldUpdate, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest,
        },
        net::{
            api::{InstanceCompletion, InstanceRestore, TaskApi},
            http::{
                HttpClient, HttpHeader, HttpRequest, HttpResponse, TransportError,
                TransportErrorKind,
            },
        },
        sync::{FailureClass, classify},
    };

    const BASE: &str = "http://vault.test:8080";

    /// A transport that records every request and replays scripted answers.
    ///
    /// Scripted rather than modelled: this file's subject is the *request* the
    /// core builds and the *meaning* it reads off a response, so the responses
    /// are literals a human can check against the upstream contract.
    struct Recorder {
        requests: Mutex<Vec<HttpRequest>>,
        answers: Mutex<Vec<Result<HttpResponse, TransportError>>>,
        cancels: Mutex<u32>,
    }

    impl Recorder {
        fn new(answers: Vec<Result<HttpResponse, TransportError>>) -> Arc<Self> {
            Arc::new(Self {
                requests: Mutex::new(Vec::new()),
                answers: Mutex::new(answers),
                cancels: Mutex::new(0),
            })
        }

        fn ok(body: &Value) -> HttpResponse {
            HttpResponse {
                status: 200,
                headers: vec![HttpHeader::new("Content-Type", "application/json")],
                body: serde_json::to_vec(body).unwrap(),
            }
        }

        fn status(status: u16, body: &str) -> HttpResponse {
            HttpResponse {
                status,
                headers: Vec::new(),
                body: body.as_bytes().to_vec(),
            }
        }

        fn requests(&self) -> Vec<HttpRequest> {
            self.requests.lock().unwrap().clone()
        }

        fn only(&self) -> HttpRequest {
            let requests = self.requests();
            assert_eq!(requests.len(), 1, "expected exactly one request");
            requests.into_iter().next().unwrap()
        }
    }

    impl HttpClient for Recorder {
        fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
            self.requests.lock().unwrap().push(request.clone());
            let mut answers = self.answers.lock().unwrap();
            assert!(
                !answers.is_empty(),
                "the transport ran out of scripted answers"
            );
            answers.remove(0)
        }

        fn cancel_all(&self) {
            *self.cancels.lock().unwrap() += 1;
        }
    }

    fn client(recorder: &Arc<Recorder>) -> TaskNotesClient {
        let transport: Arc<dyn HttpClient> = Arc::<Recorder>::clone(recorder);
        TaskNotesClient::new(transport, BASE, DEFAULT_REQUEST_TIMEOUT_MILLIS).unwrap()
    }

    fn wire_task() -> Value {
        json!({
            "path": "TaskNotes/a.md",
            "title": "Write the plan",
            "status": "open",
            "priority": "normal",
            "customProperties": { "zebra": 1, "apple": 2, "mango": 3 },
        })
    }

    fn body_of(request: &HttpRequest) -> Value {
        let bytes = request.body.as_ref().expect("the request carried no body");
        serde_json::from_slice(bytes).unwrap()
    }

    fn header(request: &HttpRequest, name: &str) -> Option<String> {
        request
            .headers
            .iter()
            .find(|header| header.name == name)
            .map(|header| header.value.clone())
    }

    fn id(raw: &str) -> TaskId {
        TaskId::parse(raw).unwrap()
    }

    #[test]
    fn a_base_url_needs_a_scheme_and_loses_its_trailing_slashes() {
        let recorder = Recorder::new(Vec::new());
        let transport: Arc<dyn HttpClient> = Arc::<Recorder>::clone(&recorder);
        let trimmed =
            TaskNotesClient::new(Arc::clone(&transport), "http://host:8080//", 1).unwrap();
        assert_eq!(trimmed.base_url(), "http://host:8080");

        for bad in ["", "host:8080", "://host"] {
            let error = TaskNotesClient::new(Arc::clone(&transport), bad, 1).unwrap_err();
            assert_eq!(error.kind(), ErrorKind::Validation, "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_create_builds_the_absolute_url_headers_and_renamed_body() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&wire_task()))]);
        let request = CreateTaskRequest {
            recurrence_anchor: Some(crate::domain::RecurrenceAnchor::Completion),
            ..CreateTaskRequest::new(TaskTitle::parse("Write the plan").unwrap())
        };

        let task = client(&recorder)
            .create_task(&request, Some("cmd-1"))
            .unwrap();
        assert_eq!(task.title, "Write the plan");

        let sent = recorder.only();
        assert_eq!(sent.url, "http://vault.test:8080/api/tasks");
        assert_eq!(sent.method.as_str(), "POST");
        assert_eq!(sent.timeout_millis, DEFAULT_REQUEST_TIMEOUT_MILLIS);
        assert_eq!(
            header(&sent, "Content-Type").as_deref(),
            Some("application/json")
        );
        assert_eq!(header(&sent, MUTATION_ID_HEADER).as_deref(), Some("cmd-1"));
        // The rename table, applied by the core rather than by a shell.
        assert_eq!(
            body_of(&sent),
            json!({ "title": "Write the plan", "recurrence_anchor": "completion" })
        );
    }

    #[test]
    fn an_update_keeps_null_as_the_instruction_to_delete_a_frontmatter_key() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&wire_task()))]);
        let request = UpdateTaskRequest {
            due: FieldUpdate::Clear,
            ..UpdateTaskRequest::default()
        };
        client(&recorder)
            .update_task(&id("TaskNotes/a.md"), &request, None)
            .unwrap();

        let sent = recorder.only();
        assert_eq!(sent.method.as_str(), "PUT");
        assert_eq!(
            sent.url,
            "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md"
        );
        assert_eq!(body_of(&sent), json!({ "due": Value::Null }));
        assert_eq!(header(&sent, MUTATION_ID_HEADER), None, "no key, no header");
    }

    #[test]
    fn a_task_id_with_slashes_and_spaces_stays_one_path_component() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&wire_task()))]);
        client(&recorder)
            .toggle_task_status(&id("TaskNotes/Write the plan.md"), TaskStatus::Done, None)
            .unwrap();

        let sent = recorder.only();
        assert_eq!(
            sent.url,
            "http://vault.test:8080/api/tasks/TaskNotes%2FWrite%20the%20plan.md"
        );
        assert_eq!(body_of(&sent), json!({ "status": "done" }));
    }

    #[test]
    fn a_completion_with_no_instance_sends_no_body_at_all() {
        // Not the same request as an empty object: with no body the server
        // falls back to toggling its own idea of "today".
        let recorder = Recorder::new(vec![
            Ok(Recorder::ok(&wire_task())),
            Ok(Recorder::ok(&wire_task())),
            Ok(Recorder::ok(&wire_task())),
        ]);
        let client = client(&recorder);
        client
            .complete_recurring_instance(&id("TaskNotes/a.md"), None, None)
            .unwrap();
        client
            .complete_recurring_instance(
                &id("TaskNotes/a.md"),
                Some(&InstanceCompletion {
                    date: "2026-08-08".to_owned(),
                    completed: true,
                    restore: None,
                }),
                Some("cmd-9"),
            )
            .unwrap();
        client
            .complete_recurring_instance(
                &id("TaskNotes/a.md"),
                Some(&InstanceCompletion {
                    date: "2026-08-08".to_owned(),
                    completed: false,
                    restore: Some(InstanceRestore {
                        scheduled: Some("2026-08-08".to_owned()),
                        due: None,
                        recurrence: "FREQ=DAILY".to_owned(),
                        skipped: false,
                    }),
                }),
                Some("cmd-10"),
            )
            .unwrap();

        let sent = recorder.requests();
        let legacy = sent.first().unwrap();
        assert_eq!(
            legacy.url,
            "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md/complete-instance"
        );
        assert_eq!(legacy.body, None);
        assert_eq!(
            header(legacy, "Content-Type"),
            None,
            "no body, no content type"
        );

        let absolute = sent.get(1).unwrap();
        assert_eq!(
            body_of(absolute),
            json!({ "date": "2026-08-08", "completed": true }),
            "a completion carries no restore — the server rejects one"
        );

        // The undo. `scheduled` and `due` are nullable rather than omissible on
        // the server's schema, so a task with no due date sends `due: null`;
        // dropping the key would fail validation.
        let undo = sent.get(2).unwrap();
        assert_eq!(
            body_of(undo),
            json!({
                "date": "2026-08-08",
                "completed": false,
                "restore": {
                    "scheduled": "2026-08-08",
                    "due": null,
                    "recurrence": "FREQ=DAILY",
                    "skipped": false,
                },
            })
        );
    }

    #[test]
    fn timing_requests_keep_the_server_contract_inside_the_core() {
        let recorder = Recorder::new(vec![
            Ok(Recorder::ok(&wire_task())),
            Ok(Recorder::ok(&wire_task())),
            Ok(Recorder::ok(&json!({
                "summary": { "totalMinutes": 7, "activeSessions": 1 }
            }))),
            Ok(Recorder::ok(&json!({
                "period": "all",
                "summary": { "totalMinutes": 42 },
                "topTasks": [{
                    "task": "TaskNotes/a.md",
                    "title": "Write the plan",
                    "minutes": 42
                }]
            }))),
        ]);
        let client = client(&recorder);
        let task_id = id("TaskNotes/a.md");

        client.start_time_tracking(&task_id).unwrap();
        client.stop_time_tracking(&task_id).unwrap();
        let task_time = client.task_time(&task_id).unwrap();
        let summary = client.time_summary("all").unwrap();

        assert_eq!(task_time.total_time, 7);
        assert!(task_time.has_active_session);
        assert_eq!(summary.total_time, 42);
        assert_eq!(summary.top_tasks[0].task_id.as_str(), "TaskNotes/a.md");

        let sent = recorder.requests();
        assert_eq!(
            sent.iter()
                .map(|request| request.method.as_str())
                .collect::<Vec<_>>(),
            ["POST", "POST", "GET", "GET"]
        );
        assert_eq!(
            sent.iter()
                .map(|request| request.url.as_str())
                .collect::<Vec<_>>(),
            [
                "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md/time/start",
                "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md/time/stop",
                "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md/time",
                "http://vault.test:8080/api/time/summary?period=all",
            ]
        );
        assert!(sent.iter().all(|request| request.body.is_none()));
    }

    #[test]
    fn pomodoro_requests_preserve_optional_body_and_return_every_status_shape() {
        let running = json!({
            "active": true,
            "taskId": "TaskNotes/a.md",
            "timeRemaining": 1_500,
            "type": "work"
        });
        let recorder = Recorder::new(vec![
            Ok(Recorder::ok(&running)),
            Ok(Recorder::ok(&running)),
            Ok(Recorder::ok(&running)),
            Ok(Recorder::ok(&json!({ "active": false }))),
            Ok(Recorder::ok(&json!({ "active": true, "type": "break" }))),
        ]);
        let client = client(&recorder);

        let started = client.start_pomodoro(Some(&id("TaskNotes/a.md"))).unwrap();
        client.start_pomodoro(None).unwrap();
        client.pause_pomodoro().unwrap();
        let stopped = client.stop_pomodoro().unwrap();
        let status = client.pomodoro_status().unwrap();

        assert!(started.active);
        assert_eq!(
            started.task_id.as_ref().map(TaskId::as_str),
            Some("TaskNotes/a.md")
        );
        assert!(!stopped.active);
        assert_eq!(status.phase, Some(crate::domain::PomodoroPhase::Break));

        let sent = recorder.requests();
        assert_eq!(sent[0].url, "http://vault.test:8080/api/pomodoro/start");
        assert_eq!(body_of(&sent[0]), json!({ "taskId": "TaskNotes/a.md" }));
        assert_eq!(sent[1].body, None, "an unassigned start has no body");
        assert_eq!(sent[2].url, "http://vault.test:8080/api/pomodoro/pause");
        assert_eq!(sent[3].url, "http://vault.test:8080/api/pomodoro/stop");
        assert_eq!(sent[4].url, "http://vault.test:8080/api/pomodoro/status");
        assert_eq!(sent[4].method.as_str(), "GET");
    }

    #[test]
    fn unmodelled_frontmatter_keeps_the_vaults_key_order_end_to_end() {
        // The argument that settled the refactor: Foundation has no ordered
        // JSON type, so a task carrying `customProperties` had its keys
        // scrambled in both directions — and the server writes YAML frontmatter
        // from those keys, so a read-then-write reordered the user's file.
        let recorder = Recorder::new(vec![
            Ok(Recorder::ok(&wire_task())),
            Ok(Recorder::ok(&wire_task())),
        ]);
        let client = client(&recorder);
        let task = client
            .create_task(
                &CreateTaskRequest::new(TaskTitle::parse("Round trip").unwrap()),
                None,
            )
            .unwrap();
        let keys: Vec<&str> = task
            .extra_fields
            .as_map()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["zebra", "apple", "mango"], "inbound order was lost");

        // And back out again, through the rename table, byte for byte.
        let update = UpdateTaskRequest {
            extra_fields: Some(task.extra_fields.clone()),
            ..UpdateTaskRequest::default()
        };
        client.update_task(&task.id, &update, None).unwrap();
        let sent = recorder.requests();
        let outbound = sent.get(1).unwrap();
        let bytes = outbound.body.as_ref().unwrap();
        assert_eq!(
            core::str::from_utf8(bytes).unwrap(),
            r#"{"customProperties":{"zebra":1,"apple":2,"mango":3}}"#
        );
    }

    #[test]
    fn the_status_to_error_mapping_is_the_classifiers_input_and_lives_here() {
        // The retry hazard the refactor closes: while every shell owned this
        // step, a 503 arriving as anything but `Api { status: 503 }` silently
        // turned a transient failure into a dead-lettered command.
        for (status, expected) in [
            (401_u16, FailureClass::Auth),
            (403, FailureClass::Auth),
            (404, FailureClass::NotFound),
            (429, FailureClass::Transient),
            (500, FailureClass::Transient),
            (503, FailureClass::Transient),
            (400, FailureClass::Permanent),
            (422, FailureClass::Permanent),
        ] {
            let recorder = Recorder::new(vec![Ok(Recorder::status(status, "upstream said no"))]);
            let error = client(&recorder)
                .delete_task(&id("TaskNotes/a.md"), None)
                .unwrap_err();
            assert_eq!(classify(&error), expected, "HTTP {status}");
            if status == 404 {
                assert_eq!(error.kind(), ErrorKind::NotFound);
                assert_eq!(
                    error.message(),
                    "resource not found: /api/tasks/TaskNotes%2Fa.md"
                );
            } else {
                assert_eq!(error.status(), Some(status));
            }
        }
    }

    #[test]
    fn every_transport_failure_is_transient_and_names_what_the_platform_said() {
        for kind in [
            TransportErrorKind::Timeout,
            TransportErrorKind::Offline,
            TransportErrorKind::Tls,
            TransportErrorKind::Other,
        ] {
            let recorder = Recorder::new(vec![Err(TransportError::new(kind, "socket closed"))]);
            let error = client(&recorder).list_tasks().unwrap_err();
            assert_eq!(classify(&error), FailureClass::Transient, "{kind:?}");
            assert_eq!(error.kind(), ErrorKind::Connection);
            assert!(error.message().contains("socket closed"), "{error}");
            assert!(error.message().contains(BASE), "{error}");
            assert_eq!(
                error.status(),
                None,
                "a transport cannot invent an HTTP status"
            );
        }
    }

    #[test]
    fn a_replayed_mutation_is_indistinguishable_from_a_fresh_one_but_visible() {
        // The server sets this when it answered from its idempotency store
        // instead of applying the mutation again. Nothing branches on it — a
        // replay and a fresh application are the same outcome to the engine,
        // which is the point of an absolute command. What changed in Phase 4.5
        // is that the core can *see* it at all: both shells were dropping it,
        // and neither could have surfaced it without another round of shell
        // work.
        let mut response = Recorder::ok(&wire_task());
        response
            .headers
            .push(HttpHeader::new(IDEMPOTENT_REPLAY_HEADER, "true"));
        let recorder = Recorder::new(vec![Ok(response)]);
        let task = client(&recorder)
            .create_task(
                &CreateTaskRequest::new(TaskTitle::parse("Replayed").unwrap()),
                Some("cmd-1"),
            )
            .unwrap();
        assert_eq!(task.id.as_str(), "TaskNotes/a.md");
    }

    #[test]
    fn the_envelope_is_unwrapped_and_a_failed_one_carries_status_zero() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&json!({
            "success": true,
            "data": wire_task(),
        })))]);
        let task = client(&recorder)
            .create_task(
                &CreateTaskRequest::new(TaskTitle::parse("Enveloped").unwrap()),
                None,
            )
            .unwrap();
        assert_eq!(task.id.as_str(), "TaskNotes/a.md");

        let recorder = Recorder::new(vec![Ok(Recorder::ok(&json!({
            "success": false,
            "data": Value::Null,
            "error": "Task not found",
        })))]);
        let error = client(&recorder)
            .create_task(
                &CreateTaskRequest::new(TaskTitle::parse("Enveloped").unwrap()),
                None,
            )
            .unwrap_err();
        assert_eq!(error.status(), Some(0));
        assert_eq!(error.message(), "Task not found");
    }

    /// One page of the list, as the `/v2` endpoint answers it.
    ///
    /// `total` is the server's count of the whole collection, not of this page,
    /// and the pull compares it across pages — so a caller that wants a pass to
    /// be *accepted* has to keep it equal to the number of tasks the pass will
    /// end up with.
    fn list_page(total: u32, paths: &[&str], has_more: bool) -> HttpResponse {
        let tasks: Vec<Value> = paths
            .iter()
            .map(|path| {
                json!({
                    "path": path,
                    "title": "A task",
                    "status": "open",
                    "priority": "normal",
                    "details": ""
                })
            })
            .collect();
        Recorder::ok(&json!({
            "tasks": tasks,
            "pagination": { "total": total, "offset": 0, "limit": 200, "hasMore": has_more },
        }))
    }

    fn offsets(recorder: &Arc<Recorder>) -> Vec<String> {
        recorder
            .requests()
            .iter()
            .map(|request| {
                request
                    .url
                    .trim_start_matches("http://vault.test:8080/api/tasks?limit=200&offset=")
                    .to_owned()
            })
            .collect()
    }

    #[test]
    fn the_list_pages_until_has_more_is_false_advancing_by_what_it_received() {
        let recorder = Recorder::new(vec![
            Ok(list_page(2, &["TaskNotes/a.md"], true)),
            Ok(list_page(2, &["TaskNotes/b.md"], false)),
        ]);
        let tasks = client(&recorder).list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);

        assert_eq!(
            offsets(&recorder),
            ["0", "1"],
            "the offset advances by what arrived, not by the declared limit"
        );
    }

    #[test]
    fn a_legacy_list_without_details_hydrates_the_body_before_returning() {
        let recorder = Recorder::new(vec![
            Ok(Recorder::ok(&json!({
                "tasks": [{
                    "path": "TaskNotes/a.md",
                    "title": "A task",
                    "status": "open",
                    "priority": "normal"
                }],
                "pagination": {
                    "total": 1,
                    "offset": 0,
                    "limit": 200,
                    "hasMore": false
                }
            }))),
            Ok(Recorder::ok(&json!({
                "path": "TaskNotes/a.md",
                "title": "A task",
                "status": "open",
                "priority": "normal",
                "details": "Saved from Facet."
            }))),
        ]);

        let tasks = client(&recorder).list_tasks().unwrap();
        assert_eq!(
            tasks.first().and_then(|task| task.details.as_deref()),
            Some("Saved from Facet.")
        );
        assert_eq!(
            recorder.requests()[1].url,
            "http://vault.test:8080/api/tasks/TaskNotes%2Fa.md"
        );
    }

    #[test]
    fn a_total_that_moves_between_pages_restarts_the_pull_from_the_beginning() {
        // The vault gained a task while page two was being fetched. Advancing
        // the offset over the shifted array is what would skip or repeat one,
        // and `replace_base` would adopt the damaged list as authoritative.
        let recorder = Recorder::new(vec![
            Ok(list_page(2, &["TaskNotes/a.md"], true)),
            Ok(list_page(3, &["TaskNotes/b.md"], true)),
            Ok(list_page(2, &["TaskNotes/a.md"], true)),
            Ok(list_page(2, &["TaskNotes/b.md"], false)),
        ]);

        let tasks = client(&recorder).list_tasks().unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(
            offsets(&recorder),
            ["0", "1", "0", "1"],
            "the abandoned pass is re-read from offset zero, not resumed"
        );
    }

    #[test]
    fn a_task_arriving_on_two_pages_discards_the_pass() {
        // A delete ahead of the offset pulls the array back by one, so the item
        // already collected slides into the next page — and the one that was
        // between them is never seen. The count stays plausible; the repeat is
        // the only evidence.
        let recorder = Recorder::new(vec![
            Ok(list_page(2, &["TaskNotes/a.md"], true)),
            Ok(list_page(2, &["TaskNotes/a.md"], false)),
            Ok(list_page(2, &["TaskNotes/a.md"], true)),
            Ok(list_page(2, &["TaskNotes/b.md"], false)),
        ]);

        let tasks = client(&recorder).list_tasks().unwrap();
        assert_eq!(
            tasks
                .iter()
                .map(|task| task.id.as_str())
                .collect::<Vec<_>>(),
            ["TaskNotes/a.md", "TaskNotes/b.md"]
        );
    }

    #[test]
    fn a_pull_that_never_reads_a_complete_list_fails_rather_than_shrinking_the_vault() {
        // Every pass ends one task short of the count the server itself
        // declared. Returning it would delete a live task from the app.
        let short = || Ok(list_page(3, &["TaskNotes/a.md"], false));
        let recorder = Recorder::new(vec![short(), short(), short()]);

        let error = client(&recorder).list_tasks().unwrap_err();
        assert!(error.message().contains("changed underneath"), "{error}");
        assert_eq!(error.status(), Some(0));
        assert_eq!(recorder.requests().len(), 3, "the attempts are bounded");
    }

    #[test]
    fn an_empty_page_while_has_more_is_true_fails_instead_of_looping() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&json!({
            "tasks": [],
            "pagination": { "total": 5, "offset": 0, "limit": 200, "hasMore": true },
        })))]);
        let error = client(&recorder).list_tasks().unwrap_err();
        assert!(error.message().contains("empty page"), "{error}");
        assert_eq!(error.status(), Some(0));
    }

    #[test]
    fn a_body_carrying_a_byte_order_mark_still_parses() {
        // Bodies cross as bytes precisely so the core sees the BOM rather than
        // having UniFFI's string converter remove it invisibly. Having seen it,
        // the core treats it as framing — every JSON parser rejects one.
        let mut body = vec![0xEF, 0xBB, 0xBF];
        body.extend(serde_json::to_vec(&wire_task()).unwrap());
        let recorder = Recorder::new(vec![Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body,
        })]);
        let task = client(&recorder)
            .create_task(
                &CreateTaskRequest::new(TaskTitle::parse("BOM").unwrap()),
                None,
            )
            .unwrap();
        assert_eq!(task.title, "Write the plan");
        assert_eq!(strip_bom(&[0xEF, 0xBB, 0xBF, b'{']), b"{");
        assert_eq!(strip_bom(b"{"), b"{");
    }

    #[test]
    fn a_body_that_is_not_json_is_a_validation_failure_not_a_retry() {
        let recorder = Recorder::new(vec![Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: b"<html>proxy error</html>".to_vec(),
        })]);
        let error = client(&recorder)
            .delete_task(&id("TaskNotes/a.md"), None)
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Validation);
        assert_eq!(classify(&error), FailureClass::Permanent);
    }

    #[test]
    fn a_delete_answers_the_upstream_message_shape_and_nothing_else() {
        let recorder = Recorder::new(vec![Ok(Recorder::ok(&json!({ "message": "deleted" })))]);
        client(&recorder)
            .delete_task(&id("TaskNotes/a.md"), Some("cmd-4"))
            .unwrap();
        let sent = recorder.only();
        assert_eq!(sent.method.as_str(), "DELETE");
        assert_eq!(sent.body, None);
        assert_eq!(header(&sent, MUTATION_ID_HEADER).as_deref(), Some("cmd-4"));

        let recorder = Recorder::new(vec![Ok(Recorder::ok(&json!({ "success": true })))]);
        let error = client(&recorder)
            .delete_task(&id("TaskNotes/a.md"), None)
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Validation);
    }

    #[test]
    fn cancelling_reaches_the_host_transport() {
        let recorder = Recorder::new(Vec::new());
        client(&recorder).cancel_all();
        assert_eq!(*recorder.cancels.lock().unwrap(), 1);
    }
}
