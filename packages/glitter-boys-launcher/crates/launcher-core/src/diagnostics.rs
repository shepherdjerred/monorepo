//! Bounded, allow-listed local records and best-effort operational telemetry.
//!
//! Three local records live under `<data>/diagnostics/logs`:
//! - `events-*.jsonl`: allow-listed events (the only records ever uploaded);
//! - `launcher.*.log`: structured text logs for support bundles, never uploaded;
//! - `processes/*.log`: output of client helpers (never Plutonium), never uploaded.
use crate::{Result, Step, catalog::Game, state};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FILE_LIMIT: u64 = 10 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(7 * 86400);
/// Event schema written by this release. Schema 2 adds optional failure context.
pub const SCHEMA: u8 = 2;
static REPORTER: OnceLock<Arc<Reporter>> = OnceLock::new();
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Startup,
    Download,
    Extract,
    Prepare,
    Storage,
    Prerequisite,
    Launch,
    UpdateCheck,
    UpdateApply,
    Panic,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Started,
    Succeeded,
    Failed,
    Paused,
    Skipped,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    Network,
    Filesystem,
    Archive,
    Data,
    Validation,
    Panic,
}
/// A fixed subset of `std::io::ErrorKind`, so reports never carry free text.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IoKind {
    NotFound,
    PermissionDenied,
    AlreadyExists,
    StorageFull,
    ResourceBusy,
    TimedOut,
    Interrupted,
    InvalidData,
    UnexpectedEof,
    Other,
}
impl From<std::io::ErrorKind> for IoKind {
    fn from(kind: std::io::ErrorKind) -> Self {
        use std::io::ErrorKind as K;
        match kind {
            K::NotFound => Self::NotFound,
            K::PermissionDenied => Self::PermissionDenied,
            K::AlreadyExists => Self::AlreadyExists,
            K::StorageFull | K::QuotaExceeded => Self::StorageFull,
            K::ResourceBusy | K::ExecutableFileBusy => Self::ResourceBusy,
            K::TimedOut => Self::TimedOut,
            K::Interrupted => Self::Interrupted,
            K::InvalidData => Self::InvalidData,
            K::UnexpectedEof => Self::UnexpectedEof,
            _ => Self::Other,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub schema: u8,
    pub at: u64,
    pub release: String,
    pub game: Option<Game>,
    pub operation: Operation,
    pub outcome: Outcome,
    pub failure: Option<Failure>,
    pub duration_ms: u64,
    pub bytes: u64,
    /// Schema 2: the installation step a failure happened in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<Step>,
    /// Schema 2: the kind of OS-level failure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub io_kind: Option<IoKind>,
    /// Schema 2: the raw OS error code (a number, never a message).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub os_error: Option<i32>,
    /// Schema 2: correlates a job's started and finished events within one launcher run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job: Option<u64>,
}
impl Event {
    /// Schema 1 events must not carry schema 2 fields.
    pub fn valid_schema(&self) -> bool {
        match self.schema {
            1 => {
                self.step.is_none()
                    && self.io_kind.is_none()
                    && self.os_error.is_none()
                    && self.job.is_none()
            }
            2 => true,
            _ => false,
        }
    }
}
/// The fields a caller supplies for one event.
#[derive(Clone, Copy)]
pub struct EventInput {
    pub game: Option<Game>,
    pub operation: Operation,
    pub outcome: Outcome,
    pub duration_ms: u64,
    pub bytes: u64,
    pub job: Option<u64>,
}
impl EventInput {
    pub fn new(game: Option<Game>, operation: Operation, outcome: Outcome) -> Self {
        Self {
            game,
            operation,
            outcome,
            duration_ms: 0,
            bytes: 0,
            job: None,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preferences {
    version: u8,
    automatic_diagnostics: bool,
}
pub struct Reporter {
    root: PathBuf,
    enabled: AtomicBool,
    disk: Mutex<()>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
/// Structured JSON text logs, rotated daily and kept for a week.
fn initialize_logging(logs: &Path) -> Result<()> {
    use tracing_subscriber::{EnvFilter, fmt};
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("launcher")
        .filename_suffix("log")
        .max_log_files(7)
        .build(logs)
        .map_err(|e| crate::Error::Invalid(format!("Launcher log could not be opened: {e}")))?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    // GLITTER_BOYS_LOG overrides verbosity for local troubleshooting.
    let filter = EnvFilter::try_from_env("GLITTER_BOYS_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,glitter_boys_core=debug,glitter_boys_app=debug"));
    let subscriber = fmt()
        .json()
        .with_writer(writer)
        .with_env_filter(filter)
        .with_current_span(true)
        .with_span_list(true)
        .with_thread_names(true)
        .with_ansi(false)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|_| crate::Error::Invalid("Launcher logging already initialized".into()))?;
    if LOG_GUARD.set(guard).is_err() {
        return Err(crate::Error::Invalid(
            "Launcher logging already initialized".into(),
        ));
    }
    Ok(())
}
/// Remove regular files older than the retention period from `directory`.
fn prune_old_files(directory: &Path) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && entry
                .metadata()?
                .modified()?
                .elapsed()
                .is_ok_and(|age| age > RETENTION)
        {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}
/// The local diagnostics folder, once initialized.
pub fn root() -> Option<PathBuf> {
    REPORTER.get().map(|r| r.root.clone())
}
/// Open a new log file for one client helper process. `None` before initialization.
pub fn process_log(label: &str) -> Option<std::io::Result<(PathBuf, fs::File)>> {
    let reporter = REPORTER.get()?;
    let directory = reporter.root.join("logs").join("processes");
    Some((|| {
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!(
            "{}-{}-{label}.log",
            now(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;
        Ok((path, file))
    })())
}
pub fn initialize(data: &Path) -> Result<()> {
    let root = data.join("diagnostics");
    fs::create_dir_all(root.join("logs").join("processes"))?;
    fs::create_dir_all(root.join("pending").join("v2"))?;
    prune_old_files(&root.join("logs").join("processes"))?;
    initialize_logging(&root.join("logs"))?;
    let enabled = match fs::read(root.join("preferences.json")) {
        Ok(bytes) => {
            let p: Preferences = serde_json::from_slice(&bytes)?;
            if p.version != 1 {
                return Err(crate::Error::Invalid(
                    "Unsupported diagnostic preferences".into(),
                ));
            }
            p.automatic_diagnostics
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => return Err(e.into()),
    };
    let reporter = Arc::new(Reporter {
        root,
        enabled: AtomicBool::new(enabled),
        disk: Mutex::new(()),
    });
    if REPORTER.set(reporter.clone()).is_err() {
        return Err(crate::Error::Invalid(
            "Diagnostics already initialized".into(),
        ));
    }
    std::thread::Builder::new()
        .name("diagnostics-upload".into())
        .spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            let Ok(client) = reqwest::Client::builder()
                .https_only(true)
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()
            else {
                return;
            };
            let mut backoff = 5;
            loop {
                std::thread::sleep(Duration::from_secs(backoff));
                if !reporter.enabled.load(Ordering::Acquire) || cfg!(debug_assertions) {
                    continue;
                }
                // Current-schema events first; then any schema 1 events an older release queued.
                let pending = reporter.root.join("pending");
                let batch = reporter
                    .batch(&pending.join("v2"))
                    .map(|batch| (SCHEMA, batch))
                    .and_then(|(schema, batch)| {
                        if batch.is_empty() {
                            reporter.batch(&pending).map(|batch| (1, batch))
                        } else {
                            Ok((schema, batch))
                        }
                    });
                let (schema, batch) = match batch {
                    Ok(batch) => batch,
                    Err(error) => {
                        tracing::warn!(%error, "diagnostic queue unreadable");
                        backoff = 60;
                        continue;
                    }
                };
                if batch.is_empty() {
                    continue;
                }
                let events: Vec<_> = batch.iter().map(|(_, e)| e).collect();
                if !reporter.enabled.load(Ordering::Acquire) {
                    continue;
                }
                let response = upload_batch(
                    &runtime,
                    &client,
                    "https://launcher.glitter-boys.com/v1/events",
                    schema,
                    &events,
                );
                match response {
                    Ok(response) if response.status().is_success() => {
                        if let Ok(_guard) = reporter.disk.lock() {
                            for (path, _) in batch {
                                let _ = fs::remove_file(path);
                            }
                        }
                        backoff = 5;
                    }
                    Ok(response) => {
                        tracing::debug!(status = %response.status(), "diagnostic upload rejected");
                        backoff = (backoff * 2).min(300);
                    }
                    Err(error) => {
                        tracing::debug!(%error, "diagnostic upload failed");
                        backoff = (backoff * 2).min(300);
                    }
                }
            }
        })?;
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-text panic payload".into());
        tracing::error!(
            message,
            location = ?info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())),
            thread = std::thread::current().name().unwrap_or("unnamed"),
            backtrace = %std::backtrace::Backtrace::force_capture(),
            "panic"
        );
        record(
            None,
            Operation::Panic,
            Outcome::Failed,
            Some(Failure::Panic),
            0,
            0,
        );
        previous(info);
    }));
    log_startup(data);
    record(None, Operation::Startup, Outcome::Succeeded, None, 0, 0);
    Ok(())
}
/// The build's source commit, when the release tooling supplies it.
pub fn commit() -> Option<&'static str> {
    option_env!("GLITTER_BOYS_COMMIT")
}
/// One record of what this run is and where it is running, for every support case.
fn log_startup(data: &Path) {
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing()
            .with_memory(sysinfo::MemoryRefreshKind::nothing().with_ram())
            .with_cpu(sysinfo::CpuRefreshKind::nothing()),
    );
    let free = |path: &Path| {
        path.ancestors()
            .find(|p| p.exists())
            .and_then(|p| fs2::available_space(p).ok())
    };
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        commit = commit(),
        exe = ?std::env::current_exe().ok(),
        args = ?std::env::args_os().skip(1).collect::<Vec<_>>(),
        install_root = ?std::env::var_os("GLITTER_BOYS_INSTALL_ROOT"),
        data = %data.display(),
        data_free_bytes = free(data),
        os = sysinfo::System::long_os_version(),
        kernel = sysinfo::System::kernel_long_version(),
        cpu = system.cpus().first().map(|c| c.brand().to_owned()),
        cpus = system.cpus().len(),
        memory_bytes = system.total_memory(),
        "launcher started"
    );
}
fn upload_batch(
    runtime: &tokio::runtime::Runtime,
    client: &reqwest::Client,
    endpoint: &str,
    schema: u8,
    events: &[&Event],
) -> reqwest::Result<reqwest::Response> {
    // Request timeouts are created by send(), so construct the future inside the runtime.
    runtime.block_on(async {
        client
            .post(endpoint)
            .json(&serde_json::json!({"schema":schema,"events":events}))
            .send()
            .await
    })
}
pub fn enabled() -> bool {
    REPORTER
        .get()
        .is_some_and(|r| r.enabled.load(Ordering::Acquire))
}
pub fn set_enabled(enabled: bool) -> Result<()> {
    let reporter = REPORTER
        .get()
        .ok_or_else(|| crate::Error::Invalid("Diagnostics unavailable".into()))?;
    let _guard = reporter
        .disk
        .lock()
        .map_err(|_| crate::Error::Invalid("Diagnostic lock failed".into()))?;
    state::write_json(
        &reporter.root.join("preferences.json"),
        &Preferences {
            version: 1,
            automatic_diagnostics: enabled,
        },
    )?;
    reporter.enabled.store(enabled, Ordering::Release);
    tracing::info!(enabled, "automatic diagnostics changed");
    if !enabled {
        let pending = reporter.root.join("pending");
        for directory in [pending.join("v2"), pending] {
            for entry in fs::read_dir(directory)? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    fs::remove_file(entry.path())?;
                }
            }
        }
    }
    Ok(())
}
/// Number of events waiting to upload, for support bundles.
pub fn pending_count() -> usize {
    let Some(reporter) = REPORTER.get() else {
        return 0;
    };
    let pending = reporter.root.join("pending");
    [pending.join("v2"), pending]
        .iter()
        .filter_map(|directory| fs::read_dir(directory).ok())
        .flat_map(|entries| entries.flatten())
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .count()
}
pub fn logs_directory() -> Option<PathBuf> {
    REPORTER.get().map(|r| r.root.join("logs"))
}
pub fn record(
    game: Option<Game>,
    operation: Operation,
    outcome: Outcome,
    failure: Option<Failure>,
    duration_ms: u64,
    bytes: u64,
) {
    let mut event = event(EventInput {
        game,
        operation,
        outcome,
        duration_ms,
        bytes,
        job: None,
    });
    event.failure = failure;
    write(event);
}
/// Record an event, deriving the allow-listed failure fields from `error`.
pub fn record_event(input: EventInput, error: Option<&crate::Error>) {
    let mut event = event(input);
    if let Some(error) = error {
        event.failure = failure(error);
        event.step = error.step();
        if let Some(io) = error.io() {
            event.io_kind = Some(io.kind().into());
            event.os_error = io.raw_os_error();
        }
    }
    write(event);
}
fn event(input: EventInput) -> Event {
    Event {
        schema: SCHEMA,
        at: now(),
        release: env!("CARGO_PKG_VERSION").into(),
        game: input.game,
        operation: input.operation,
        outcome: input.outcome,
        failure: None,
        duration_ms: input.duration_ms,
        bytes: input.bytes,
        step: None,
        io_kind: None,
        os_error: None,
        job: input.job,
    }
}
fn write(event: Event) {
    if let Some(reporter) = REPORTER.get()
        && let Err(error) = reporter.write(event)
    {
        tracing::warn!(%error, "diagnostic event not written");
    }
}
pub fn failure(error: &crate::Error) -> Option<Failure> {
    Some(match error {
        crate::Error::Paused => return None,
        crate::Error::Io(_) | crate::Error::Step { .. } => Failure::Filesystem,
        crate::Error::Network(_) => Failure::Network,
        crate::Error::Archive(_) => Failure::Archive,
        crate::Error::Json(_) => Failure::Data,
        crate::Error::Invalid(_) | crate::Error::ActionRequired { .. } => Failure::Validation,
    })
}
impl Reporter {
    fn write(&self, event: Event) -> Result<()> {
        let _guard = self
            .disk
            .lock()
            .map_err(|_| crate::Error::Invalid("Diagnostic lock failed".into()))?;
        let logs = self.root.join("logs");
        prune_old_files(&logs)?;
        let active = logs.join("events-0.jsonl");
        if active.metadata().is_ok_and(|m| m.len() >= FILE_LIMIT) {
            let oldest = logs.join("events-4.jsonl");
            if oldest.exists() {
                fs::remove_file(oldest)?;
            }
            for n in (0..4).rev() {
                let from = logs.join(format!("events-{n}.jsonl"));
                if from.exists() {
                    fs::rename(from, logs.join(format!("events-{}.jsonl", n + 1)))?;
                }
            }
        }
        let mut file = OpenOptions::new().create(true).append(true).open(active)?;
        serde_json::to_writer(&mut file, &event)?;
        writeln!(file)?;
        // Older releases read only files directly in pending/, so newer schemas live in a
        // subfolder they skip; a rollback never stalls on events it cannot parse.
        let legacy = self.root.join("pending");
        let pending = if event.schema == 1 {
            legacy.clone()
        } else {
            legacy.join(format!("v{}", event.schema))
        };
        fs::create_dir_all(&pending)?;
        for directory in [&legacy, &pending] {
            let mut entries = fs::read_dir(directory)?
                .collect::<std::io::Result<Vec<_>>>()?
                .into_iter()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .collect::<Vec<_>>();
            entries.sort_by_key(|e| e.file_name());
            let count = entries.len();
            for (index, entry) in entries.into_iter().enumerate() {
                if index < count.saturating_sub(999)
                    || entry
                        .metadata()?
                        .modified()?
                        .elapsed()
                        .is_ok_and(|age| age > Duration::from_secs(86400))
                {
                    fs::remove_file(entry.path())?;
                }
            }
        }
        if self.enabled.load(Ordering::Acquire) && !cfg!(debug_assertions) {
            state::write_json(
                &pending.join(format!(
                    "{}-{}-{}.json",
                    event.at,
                    std::process::id(),
                    SEQUENCE.fetch_add(1, Ordering::Relaxed)
                )),
                &event,
            )?;
        }
        Ok(())
    }
    fn batch(&self, directory: &Path) -> Result<Vec<(PathBuf, Event)>> {
        let _guard = self
            .disk
            .lock()
            .map_err(|_| crate::Error::Invalid("Diagnostic lock failed".into()))?;
        let mut events = Vec::new();
        let files = fs::read_dir(directory)?
            .filter(|e| {
                e.as_ref()
                    .map_or(true, |e| e.file_type().is_ok_and(|t| t.is_file()))
            })
            .take(25);
        for entry in files {
            let entry = entry?;
            {
                if entry
                    .metadata()?
                    .modified()?
                    .elapsed()
                    .is_ok_and(|age| age > Duration::from_secs(86400))
                {
                    fs::remove_file(entry.path())?;
                    continue;
                }
                events.push((
                    entry.path(),
                    serde_json::from_slice(&fs::read(entry.path())?)?,
                ));
            }
        }
        Ok(events)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unresponsive_collector_times_out_without_panicking() -> Result<()> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let endpoint = format!("http://{}/v1/events", listener.local_addr()?);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(50))
            .build()?;
        assert!(
            upload_batch(&runtime, &client, &endpoint, SCHEMA, &[]).is_err_and(|e| e.is_timeout())
        );
        Ok(())
    }
    #[test]
    fn records_have_no_free_text_or_identity_fields() -> Result<()> {
        let e = Event {
            schema: 1,
            at: 0,
            release: "0.1.0".into(),
            game: Some(Game::T7),
            operation: Operation::Extract,
            outcome: Outcome::Failed,
            failure: Some(Failure::Archive),
            duration_ms: 5,
            bytes: 12,
            step: None,
            io_kind: None,
            os_error: None,
            job: None,
        };
        let mut value = serde_json::to_value(e)?;
        value["path"] = serde_json::json!("C:/private");
        assert!(serde_json::from_value::<Event>(value).is_err());
        Ok(())
    }
    #[test]
    fn log_rotation_and_disabled_uploads_are_bounded() -> Result<()> {
        let temp = crate::test_tempdir()?;
        fs::create_dir(temp.path().join("logs"))?;
        fs::create_dir(temp.path().join("pending"))?;
        let reporter = Reporter {
            root: temp.path().into(),
            enabled: AtomicBool::new(false),
            disk: Mutex::new(()),
        };
        fs::File::create(temp.path().join("logs/events-0.jsonl"))?.set_len(FILE_LIMIT)?;
        reporter.write(event(EventInput::new(
            None,
            Operation::Startup,
            Outcome::Succeeded,
        )))?;
        assert!(temp.path().join("logs/events-1.jsonl").exists());
        assert_eq!(
            fs::read_dir(temp.path().join("pending/v2"))?.count(),
            0,
            "disabled reporting queues nothing"
        );
        Ok(())
    }
    #[test]
    fn schema_two_events_carry_failure_context_without_text_and_queue_apart() -> Result<()> {
        let temp = crate::test_tempdir()?;
        fs::create_dir_all(temp.path().join("logs"))?;
        fs::create_dir_all(temp.path().join("pending"))?;
        let reporter = Reporter {
            root: temp.path().into(),
            enabled: AtomicBool::new(true),
            disk: Mutex::new(()),
        };
        let error = crate::Error::Step {
            step: Step::Promote,
            path: "C:/Users/someone/private".into(),
            source: std::io::Error::from_raw_os_error(32),
        };
        let mut e = event(EventInput {
            job: Some(7),
            ..EventInput::new(Some(Game::Iw4x), Operation::Prepare, Outcome::Failed)
        });
        e.failure = failure(&error);
        e.step = error.step();
        e.io_kind = error.io().map(|io| io.kind().into());
        e.os_error = error.io().and_then(std::io::Error::raw_os_error);
        assert!(e.valid_schema());
        let text = serde_json::to_string(&e)?;
        assert!(text.contains(r#""step":"promote""#));
        assert!(text.contains(r#""os_error":32"#));
        assert!(!text.contains("someone"), "paths never enter events");
        // A schema 1 event cannot smuggle schema 2 fields.
        let mut old = e.clone();
        old.schema = 1;
        assert!(!old.valid_schema());
        // Release builds queue schema 2 under pending/v2, which older releases skip.
        if !cfg!(debug_assertions) {
            reporter.write(e)?;
            assert_eq!(fs::read_dir(temp.path().join("pending/v2"))?.count(), 1);
            assert_eq!(
                fs::read_dir(temp.path().join("pending"))?
                    .flatten()
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                    .count(),
                0
            );
            assert_eq!(reporter.batch(&temp.path().join("pending/v2"))?.len(), 1);
        }
        Ok(())
    }
    #[test]
    fn schema_one_events_from_older_releases_still_parse() -> Result<()> {
        let old = r#"{"schema":1,"at":1,"release":"0.1.7","game":"iw4x","operation":"prepare","outcome":"failed","failure":"filesystem","duration_ms":4721,"bytes":0}"#;
        let e: Event = serde_json::from_str(old)?;
        assert!(e.valid_schema());
        assert_eq!(e.step, None);
        Ok(())
    }
}
