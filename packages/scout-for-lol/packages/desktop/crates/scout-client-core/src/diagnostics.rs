//! Local, durable diagnostics for a client that runs where nobody is watching.
//!
//! The Windows build is a GUI-subsystem binary, so it has no valid stdout
//! handle and a console logger writes into the void. Every telemetry backend
//! this repository runs — Loki, Prometheus, Tempo, the Alloy OTLP gateway — is
//! reachable only from inside the homelab or over Tailscale, and this process
//! runs on an end user's machine. So diagnostics are local first: a bounded
//! ring for the Diagnostics page, an allow-listed JSONL file on disk, and
//! counters that survive long enough to answer "how often, and what changed".
//!
//! Two rules hold everywhere in this module:
//!
//! 1. **Allow-list, never redact.** A record carries the fields declared on
//!    [`DiagnosticEvent`] and nothing else. Redaction is a filter you can
//!    forget to apply to a new field; an allow-list fails closed. Tokens,
//!    PUUIDs and filesystem paths are therefore unrepresentable here rather
//!    than merely discouraged.
//! 2. **Logging must not fail the thing it observes.** Every sink error is
//!    absorbed. A full disk degrades observability; it must not degrade
//!    collection.

use std::collections::VecDeque;
use std::fmt::{self, Write as FmtWrite};
use std::fs::{self, File, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

/// Events retained in memory for the Diagnostics page.
const RING_CAPACITY: usize = 500;
/// Roll a log file once it reaches this size.
const MAXIMUM_FILE_BYTES: u64 = 25 * 1024 * 1024;
/// Highest rotation ordinal within one day before appending gives up.
const MAXIMUM_FILE_SEQUENCE: u32 = 999;
/// Delete rotated files older than this.
const RETAINED_DAYS: i64 = 7;
/// Longest `detail` string written to disk or shown in the UI.
const MAXIMUM_DETAIL_BYTES: usize = 512;

/// Severity of a diagnostic record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    /// Ordinary progress.
    Info,
    /// A recoverable problem worth noticing.
    Warn,
    /// A boundary failed.
    Error,
    /// The process is going down.
    Critical,
}

impl fmt::Display for DiagnosticLevel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
            Self::Critical => "CRITICAL",
        };
        formatter.write_str(text)
    }
}

/// Which boundary produced a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCategory {
    /// Scout backend HTTP.
    Backend,
    /// The local League client.
    Lcu,
    /// The durable observation outbox.
    Outbox,
    /// Replay discovery and upload.
    Replay,
    /// Envelope construction and validation.
    Protocol,
    /// Process lifecycle, pairing, and settings.
    Runtime,
}

/// How an attempt ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticOutcome {
    /// The attempt did what it set out to do.
    Succeeded,
    /// The attempt failed and will not be retried.
    Failed,
    /// The attempt failed and is expected to be retried.
    Deferred,
    /// The attempt was declined before it began.
    Skipped,
}

/// One allow-listed diagnostic record.
///
/// Every field is either a bounded enum, a number, or `detail` — which callers
/// must construct from fixed strings and bounded values. Do not place a
/// credential, PUUID, or absolute path in it; [`sanitize_detail`] truncates but
/// deliberately cannot know what is sensitive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    /// When the record was produced.
    pub at: DateTime<Utc>,
    /// Severity.
    pub level: DiagnosticLevel,
    /// Originating boundary.
    pub category: DiagnosticCategory,
    /// Stable short name of the operation, such as `upload_replay`.
    pub operation: &'static str,
    /// How the operation ended.
    pub outcome: DiagnosticOutcome,
    /// HTTP status, when the operation was an HTTP request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Wall-clock duration, when measured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Payload size, when meaningful.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    /// Bounded free text: an error kind, a server message, a reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl DiagnosticEvent {
    /// Begin a record for `operation` on `category`.
    #[must_use]
    pub fn new(
        level: DiagnosticLevel,
        category: DiagnosticCategory,
        operation: &'static str,
        outcome: DiagnosticOutcome,
    ) -> Self {
        Self {
            at: Utc::now(),
            level,
            category,
            operation,
            outcome,
            status: None,
            duration_ms: None,
            bytes: None,
            detail: None,
        }
    }

    /// Record the HTTP status this operation received.
    #[must_use]
    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    /// Record how long the operation took.
    #[must_use]
    pub fn with_duration_ms(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Record the payload size involved.
    #[must_use]
    pub fn with_bytes(mut self, bytes: u64) -> Self {
        self.bytes = Some(bytes);
        self
    }

    /// Attach bounded free text, truncated on a character boundary.
    #[must_use]
    pub fn with_detail(mut self, detail: impl AsRef<str>) -> Self {
        self.detail = Some(sanitize_detail(detail.as_ref()));
        self
    }

    /// A single-line rendering for the Diagnostics page.
    #[must_use]
    pub fn summary(&self) -> String {
        let mut line = format!(
            "{} {} {}",
            self.at.to_rfc3339_opts(SecondsFormat::Secs, true),
            self.level,
            self.operation
        );
        // Writing to a String is infallible; the Results are discarded.
        if let Some(status) = self.status {
            let _ = write!(line, " status={status}");
        }
        if let Some(duration) = self.duration_ms {
            let _ = write!(line, " {duration}ms");
        }
        if let Some(bytes) = self.bytes {
            let _ = write!(line, " {bytes}B");
        }
        if let Some(detail) = &self.detail {
            let _ = write!(line, " — {detail}");
        }
        line
    }
}

/// Truncate free text to a bounded length without splitting a character.
#[must_use]
pub fn sanitize_detail(detail: &str) -> String {
    let collapsed = detail.replace(['\n', '\r'], " ");
    if collapsed.len() <= MAXIMUM_DETAIL_BYTES {
        return collapsed;
    }
    let mut end = MAXIMUM_DETAIL_BYTES;
    while end > 0 && !collapsed.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = collapsed[..end].to_owned();
    truncated.push('…');
    truncated
}

/// Monotonic counters describing what this process has done since it started.
///
/// Deliberately label-free. The equivalent server-side rule is that a metric
/// may not carry an unbounded value, and a desktop process has no aggregator
/// to protect it from one.
#[derive(Debug, Default)]
pub struct Counters {
    observations_uploaded: AtomicU64,
    observations_rejected: AtomicU64,
    replay_attempts: AtomicU64,
    replay_uploads: AtomicU64,
    replay_deferrals: AtomicU64,
    replay_rejections: AtomicU64,
    replay_abandonments: AtomicU64,
    http_2xx: AtomicU64,
    http_4xx: AtomicU64,
    http_5xx: AtomicU64,
    http_transport_errors: AtomicU64,
    lcu_errors: AtomicU64,
}

/// A counter name paired with its current value.
pub type CounterReading = (&'static str, u64);

impl Counters {
    /// Count an observation the backend accepted.
    pub fn observation_uploaded(&self, count: u64) {
        self.observations_uploaded
            .fetch_add(count, Ordering::Relaxed);
    }

    /// Count an observation dropped before delivery, such as a failed envelope.
    pub fn observation_rejected(&self) {
        self.observations_rejected.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a replay upload attempt.
    pub fn replay_attempted(&self) {
        self.replay_attempts.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a replay the backend stored.
    pub fn replay_uploaded(&self) {
        self.replay_uploads.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a replay left for a later scan.
    pub fn replay_deferred(&self) {
        self.replay_deferrals.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a replay the backend refused for good.
    pub fn replay_rejected(&self) {
        self.replay_rejections.fetch_add(1, Ordering::Relaxed);
    }

    /// Count an HTTP response by class, or a transport failure when absent.
    pub fn http_response(&self, status: Option<u16>) {
        let counter = match status {
            Some(200..=299) => &self.http_2xx,
            Some(400..=499) => &self.http_4xx,
            Some(500..=599) => &self.http_5xx,
            Some(_) => return,
            None => &self.http_transport_errors,
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a replay this client has stopped offering.
    pub fn replay_abandoned(&self) {
        self.replay_abandonments.fetch_add(1, Ordering::Relaxed);
    }

    /// Count a failed exchange with the local League client.
    pub fn lcu_error(&self) {
        self.lcu_errors.fetch_add(1, Ordering::Relaxed);
    }

    /// Every counter and its value, for the Diagnostics page and the bundle.
    #[must_use]
    pub fn readings(&self) -> Vec<CounterReading> {
        vec![
            (
                "observations_uploaded",
                self.observations_uploaded.load(Ordering::Relaxed),
            ),
            (
                "observations_rejected",
                self.observations_rejected.load(Ordering::Relaxed),
            ),
            (
                "replay_attempts",
                self.replay_attempts.load(Ordering::Relaxed),
            ),
            (
                "replay_uploads",
                self.replay_uploads.load(Ordering::Relaxed),
            ),
            (
                "replay_deferrals",
                self.replay_deferrals.load(Ordering::Relaxed),
            ),
            (
                "replay_rejections",
                self.replay_rejections.load(Ordering::Relaxed),
            ),
            (
                "replay_abandoned",
                self.replay_abandonments.load(Ordering::Relaxed),
            ),
            ("http_2xx", self.http_2xx.load(Ordering::Relaxed)),
            ("http_4xx", self.http_4xx.load(Ordering::Relaxed)),
            ("http_5xx", self.http_5xx.load(Ordering::Relaxed)),
            (
                "http_transport_errors",
                self.http_transport_errors.load(Ordering::Relaxed),
            ),
            ("lcu_errors", self.lcu_errors.load(Ordering::Relaxed)),
        ]
    }
}

/// A destination for records, so a future exporter needs no call-site changes.
///
/// Nothing remote implements this yet, and adding one is a deliberate decision
/// rather than an omission: it would put an end user's machine in contact with
/// a new service, which is a privacy question before it is a technical one.
pub trait DiagnosticSink: Send + Sync {
    /// Accept one record. Implementations must not panic and must not block
    /// for long; a sink that fails is expected to disable itself.
    fn write(&self, event: &DiagnosticEvent);
}

/// Appends JSONL records to a rotating file, and stops for good if it cannot.
#[derive(Debug)]
pub struct FileSink {
    directory: PathBuf,
    state: Mutex<Option<FileState>>,
}

#[derive(Debug)]
struct FileState {
    handle: File,
    path: PathBuf,
    written: u64,
    day: String,
    sequence: u32,
}

impl FileSink {
    /// Open (creating as needed) a rotating log directory and prune old files.
    ///
    /// Returns `None` when the directory cannot be created, which leaves the
    /// process with its in-memory ring and no file — degraded, still running.
    #[must_use]
    pub fn new(directory: PathBuf) -> Option<Self> {
        if fs::create_dir_all(&directory).is_err() {
            return None;
        }
        prune_expired_logs(&directory, Utc::now());
        Some(Self {
            directory,
            state: Mutex::new(None),
        })
    }

    /// Where records are being written.
    #[must_use]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Whether the sink has latched off after an IO failure.
    #[must_use]
    pub fn is_healthy(&self) -> bool {
        self.state.lock().is_ok()
    }

    /// The file currently being appended to, once one has been opened.
    #[must_use]
    pub fn current_path(&self) -> Option<PathBuf> {
        let guard = self.state.lock().ok()?;
        guard.as_ref().map(|state| state.path.clone())
    }

    fn append(&self, line: &str) -> Option<()> {
        let Ok(mut guard) = self.state.lock() else {
            return None;
        };
        let day = Utc::now().format("%Y%m%d").to_string();
        let needs_roll = match guard.as_ref() {
            None => true,
            Some(state) => {
                state.day != day || state.written + line.len() as u64 > MAXIMUM_FILE_BYTES
            }
        };
        if needs_roll {
            let start = match guard.as_ref() {
                Some(state) if state.day == day => state.sequence + 1,
                _ => 0,
            };
            *guard = open_next_file(&self.directory, &day, start);
        }
        let state = guard.as_mut()?;
        if state.handle.write_all(line.as_bytes()).is_err() {
            // The only sink this process has; a failed write must not surface
            // as a failure of whatever was being recorded.
            *guard = None;
            return None;
        }
        state.written += line.len() as u64;
        Some(())
    }
}

impl DiagnosticSink for FileSink {
    fn write(&self, event: &DiagnosticEvent) {
        let Ok(mut line) = serde_json::to_string(event) else {
            return;
        };
        line.push('\n');
        let _ = self.append(&line);
    }
}

fn open_next_file(directory: &Path, day: &str, start: u32) -> Option<FileState> {
    for sequence in start..=MAXIMUM_FILE_SEQUENCE {
        let path = directory.join(format!("scout-client-{day}-{sequence:03}.jsonl"));
        let length = fs::metadata(&path).map_or(0, |meta| meta.len());
        if length >= MAXIMUM_FILE_BYTES {
            continue;
        }
        let opened = OpenOptions::new().create(true).append(true).open(&path);
        if let Ok(handle) = opened {
            return Some(FileState {
                handle,
                path,
                written: length,
                day: day.to_owned(),
                sequence,
            });
        }
    }
    None
}

/// Delete rotated files whose day stamp is older than the retention window.
fn prune_expired_logs(directory: &Path, now: DateTime<Utc>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let cutoff = now - chrono::Duration::days(RETAINED_DAYS);
    let cutoff_day = cutoff.format("%Y%m%d").to_string();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(day) = log_file_day(name) else {
            continue;
        };
        if day < cutoff_day.as_str() {
            // A file we cannot remove is not worth failing startup over.
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The `yyyymmdd` stamp of a rotated log file name, if it is one.
fn log_file_day(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("scout-client-")?;
    let stamp = rest.get(..8)?;
    if stamp.len() == 8 && stamp.bytes().all(|byte| byte.is_ascii_digit()) {
        Some(stamp)
    } else {
        None
    }
}

/// The client's diagnostics: a bounded ring, counters, and optional sinks.
#[derive(Default)]
pub struct Diagnostics {
    events: RwLock<VecDeque<DiagnosticEvent>>,
    counters: Counters,
    sinks: Vec<Box<dyn DiagnosticSink>>,
}

impl fmt::Debug for Diagnostics {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Diagnostics")
            .field("sinks", &self.sinks.len())
            .finish_non_exhaustive()
    }
}

impl Diagnostics {
    /// Diagnostics that keep records in memory only.
    #[must_use]
    pub fn in_memory() -> Self {
        Self::default()
    }

    /// Add a destination for every subsequent record.
    #[must_use]
    pub fn with_sink(mut self, sink: Box<dyn DiagnosticSink>) -> Self {
        self.sinks.push(sink);
        self
    }

    /// The counters, for incrementing and for reading.
    #[must_use]
    pub fn counters(&self) -> &Counters {
        &self.counters
    }

    /// Record an event to memory and to every sink.
    pub fn record(&self, event: DiagnosticEvent) {
        for sink in &self.sinks {
            sink.write(&event);
        }
        if let Ok(mut events) = self.events.write() {
            if events.len() == RING_CAPACITY {
                events.pop_front();
            }
            events.push_back(event);
        }
    }

    /// The retained events, oldest first.
    #[must_use]
    pub fn events(&self) -> Vec<DiagnosticEvent> {
        self.events
            .read()
            .map(|events| events.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// The most recent events, newest first, for the Diagnostics page.
    #[must_use]
    pub fn recent(&self, limit: usize) -> Vec<DiagnosticEvent> {
        self.events
            .read()
            .map(|events| events.iter().rev().take(limit).cloned().collect())
            .unwrap_or_default()
    }

    /// A shareable snapshot: counters, then every retained event as JSONL.
    ///
    /// Contains only allow-listed fields, so it is safe to attach to a report
    /// without further review.
    #[must_use]
    pub fn bundle(&self) -> String {
        let mut out = String::new();
        for (name, value) in self.counters.readings() {
            let _ = writeln!(out, "# {name} {value}");
        }
        for event in self.events() {
            if let Ok(line) = serde_json::to_string(&event) {
                out.push_str(&line);
                out.push('\n');
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Counters, DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome,
        Diagnostics, FileSink, RING_CAPACITY, log_file_day, prune_expired_logs, sanitize_detail,
    };
    use chrono::{Duration, Utc};
    use std::fs;

    fn event(operation: &'static str) -> DiagnosticEvent {
        DiagnosticEvent::new(
            DiagnosticLevel::Info,
            DiagnosticCategory::Backend,
            operation,
            DiagnosticOutcome::Succeeded,
        )
    }

    #[test]
    fn the_ring_keeps_the_newest_events_and_bounds_memory() {
        let diagnostics = Diagnostics::in_memory();
        for _ in 0..(RING_CAPACITY + 50) {
            diagnostics.record(event("check_in"));
        }
        assert_eq!(diagnostics.events().len(), RING_CAPACITY);
    }

    #[test]
    fn recent_returns_newest_first() {
        let diagnostics = Diagnostics::in_memory();
        diagnostics.record(event("first"));
        diagnostics.record(event("second"));
        let recent = diagnostics.recent(2);
        assert_eq!(recent[0].operation, "second");
        assert_eq!(recent[1].operation, "first");
    }

    #[test]
    fn a_serialized_event_carries_only_allow_listed_fields() {
        let record = event("upload_replay")
            .with_status(409)
            .with_duration_ms(12)
            .with_bytes(2048)
            .with_detail("waiting for accepted match-history evidence");
        let Ok(json) = serde_json::to_value(&record) else {
            unreachable!("an event must serialize")
        };
        let Some(object) = json.as_object() else {
            unreachable!("an event serializes to an object")
        };
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "at",
                "bytes",
                "category",
                "detail",
                "durationMs",
                "level",
                "operation",
                "outcome",
                "status"
            ]
        );
    }

    #[test]
    fn absent_measurements_are_omitted_rather_than_null() {
        let Ok(json) = serde_json::to_value(event("check_in")) else {
            unreachable!("an event must serialize")
        };
        let Some(object) = json.as_object() else {
            unreachable!("an event serializes to an object")
        };
        assert!(!object.contains_key("status"));
        assert!(!object.contains_key("bytes"));
        assert!(!object.contains_key("detail"));
    }

    #[test]
    fn detail_is_bounded_and_single_line() {
        let detail = sanitize_detail(&"é".repeat(4000));
        assert!(detail.len() <= 512 + 3);
        assert_eq!(sanitize_detail("a\nb\r\nc"), "a b  c");
    }

    #[test]
    fn counters_classify_responses_by_status_class() {
        let counters = Counters::default();
        counters.http_response(Some(201));
        counters.http_response(Some(409));
        counters.http_response(Some(502));
        counters.http_response(None);
        let readings: Vec<_> = counters.readings();
        let value = |name: &str| {
            readings
                .iter()
                .find(|(key, _)| *key == name)
                .map_or(0, |(_, value)| *value)
        };
        assert_eq!(value("http_2xx"), 1);
        assert_eq!(value("http_4xx"), 1);
        assert_eq!(value("http_5xx"), 1);
        assert_eq!(value("http_transport_errors"), 1);
    }

    #[test]
    fn the_file_sink_writes_one_json_line_per_event() {
        let directory = std::env::temp_dir().join(format!(
            "scout-diag-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let Some(sink) = FileSink::new(directory.clone()) else {
            unreachable!("temp directory must be creatable")
        };
        let diagnostics = Diagnostics::in_memory().with_sink(Box::new(sink));
        diagnostics.record(event("check_in").with_status(200));
        diagnostics.record(event("upload_replay").with_status(409));

        let Ok(entries) = fs::read_dir(&directory) else {
            unreachable!("log directory must exist")
        };
        let mut lines = 0;
        for entry in entries.flatten() {
            let Ok(text) = fs::read_to_string(entry.path()) else {
                continue;
            };
            for line in text.lines() {
                assert!(serde_json::from_str::<serde_json::Value>(line).is_ok());
                lines += 1;
            }
        }
        assert_eq!(lines, 2);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn only_dated_client_logs_are_pruned_and_only_past_the_window() {
        let directory = std::env::temp_dir().join(format!(
            "scout-prune-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let Ok(()) = fs::create_dir_all(&directory) else {
            unreachable!("temp directory must be creatable")
        };
        let stale = Utc::now() - Duration::days(30);
        let stale_name = format!("scout-client-{}-000.jsonl", stale.format("%Y%m%d"));
        let fresh_name = format!("scout-client-{}-000.jsonl", Utc::now().format("%Y%m%d"));
        for name in [stale_name.as_str(), fresh_name.as_str(), "unrelated.txt"] {
            let _ = fs::write(directory.join(name), b"{}\n");
        }
        prune_expired_logs(&directory, Utc::now());
        assert!(!directory.join(&stale_name).exists());
        assert!(directory.join(&fresh_name).exists());
        assert!(directory.join("unrelated.txt").exists());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn log_file_day_recognizes_only_this_clients_files() {
        assert_eq!(
            log_file_day("scout-client-20260923-000.jsonl"),
            Some("20260923")
        );
        assert_eq!(log_file_day("scout-client-notaday.jsonl"), None);
        assert_eq!(log_file_day("app.log"), None);
    }

    #[test]
    fn the_bundle_carries_counters_and_events() {
        let diagnostics = Diagnostics::in_memory();
        diagnostics.counters().replay_attempted();
        diagnostics.record(event("upload_replay").with_status(409));
        let bundle = diagnostics.bundle();
        assert!(bundle.contains("# replay_attempts 1"));
        assert!(bundle.contains("\"operation\":\"upload_replay\""));
    }
}
