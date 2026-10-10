//! Bounded, allow-listed local records and best-effort operational telemetry.
use crate::{Result, catalog::Game, state};
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
static REPORTER: OnceLock<Arc<Reporter>> = OnceLock::new();
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Startup,
    Download,
    Extract,
    Prepare,
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
pub fn initialize(data: &Path) -> Result<()> {
    let root = data.join("diagnostics");
    fs::create_dir_all(root.join("logs"))?;
    fs::create_dir_all(root.join("pending"))?;
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
                let batch = reporter.batch();
                let Ok(batch) = batch else {
                    backoff = 60;
                    continue;
                };
                if batch.is_empty() {
                    continue;
                }
                let events: Vec<_> = batch.iter().map(|(_, e)| e).collect();
                if !reporter.enabled.load(Ordering::Acquire) {
                    continue;
                }
                let response = runtime.block_on(
                    client
                        .post("https://launcher.glitter-boys.com/v1/events")
                        .json(&serde_json::json!({"schema":1,"events":events}))
                        .send(),
                );
                if response.is_ok_and(|r| r.status().is_success()) {
                    if let Ok(_guard) = reporter.disk.lock() {
                        for (path, _) in batch {
                            let _ = fs::remove_file(path);
                        }
                    }
                    backoff = 5;
                } else {
                    backoff = (backoff * 2).min(300);
                }
            }
        })?;
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
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
    record(None, Operation::Startup, Outcome::Succeeded, None, 0, 0);
    Ok(())
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
    if !enabled {
        for entry in fs::read_dir(reporter.root.join("pending"))? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                fs::remove_file(entry.path())?;
            }
        }
    }
    Ok(())
}
pub fn logs_directory() -> Option<PathBuf> {
    REPORTER.get().map(|r| r.root.join("logs"))
}
pub fn export(path: &Path) -> Result<()> {
    let reporter = REPORTER
        .get()
        .ok_or_else(|| crate::Error::Invalid("Diagnostics unavailable".into()))?;
    let _guard = reporter
        .disk
        .lock()
        .map_err(|_| crate::Error::Invalid("Diagnostic lock failed".into()))?;
    let mut output = fs::File::create(path)?;
    writeln!(
        output,
        "Glitter Boys {} | automatic diagnostics: {}",
        env!("CARGO_PKG_VERSION"),
        enabled()
    )?;
    for number in (0..5).rev() {
        let path = reporter
            .root
            .join("logs")
            .join(format!("events-{number}.jsonl"));
        match fs::File::open(path) {
            Ok(mut file) => {
                std::io::copy(&mut file, &mut output)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
pub fn record(
    game: Option<Game>,
    operation: Operation,
    outcome: Outcome,
    failure: Option<Failure>,
    duration_ms: u64,
    bytes: u64,
) {
    if let Some(reporter) = REPORTER.get() {
        let _ = reporter.write(Event {
            schema: 1,
            at: now(),
            release: env!("CARGO_PKG_VERSION").into(),
            game,
            operation,
            outcome,
            failure,
            duration_ms,
            bytes,
        });
    }
}
pub fn failure(error: &crate::Error) -> Option<Failure> {
    Some(match error {
        crate::Error::Paused => return None,
        crate::Error::Io(_) => Failure::Filesystem,
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
        for entry in fs::read_dir(&logs)? {
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
        let pending = self.root.join("pending");
        let mut entries = fs::read_dir(&pending)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|e| e.file_name());
        let count = entries.len();
        for (index, entry) in entries.into_iter().enumerate() {
            if entry.file_type()?.is_file()
                && (index < count.saturating_sub(999)
                    || entry
                        .metadata()?
                        .modified()?
                        .elapsed()
                        .is_ok_and(|age| age > Duration::from_secs(86400)))
            {
                fs::remove_file(entry.path())?;
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
    fn batch(&self) -> Result<Vec<(PathBuf, Event)>> {
        let _guard = self
            .disk
            .lock()
            .map_err(|_| crate::Error::Invalid("Diagnostic lock failed".into()))?;
        let mut events = Vec::new();
        for entry in fs::read_dir(self.root.join("pending"))?.take(25) {
            let entry = entry?;
            if entry.file_type()?.is_file() {
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
        };
        let mut value = serde_json::to_value(e)?;
        value["path"] = serde_json::json!("C:/private");
        assert!(serde_json::from_value::<Event>(value).is_err());
        Ok(())
    }
    #[test]
    fn log_rotation_and_disabled_uploads_are_bounded() -> Result<()> {
        let temp = tempfile::tempdir()?;
        fs::create_dir(temp.path().join("logs"))?;
        fs::create_dir(temp.path().join("pending"))?;
        let reporter = Reporter {
            root: temp.path().into(),
            enabled: AtomicBool::new(false),
            disk: Mutex::new(()),
        };
        fs::File::create(temp.path().join("logs/events-0.jsonl"))?.set_len(FILE_LIMIT)?;
        reporter.write(Event {
            schema: 1,
            at: 0,
            release: "0.1.0".into(),
            game: None,
            operation: Operation::Startup,
            outcome: Outcome::Succeeded,
            failure: None,
            duration_ms: 0,
            bytes: 0,
        })?;
        assert!(temp.path().join("logs/events-1.jsonl").exists());
        assert_eq!(fs::read_dir(temp.path().join("pending"))?.count(), 0);
        Ok(())
    }
}
