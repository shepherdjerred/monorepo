//! Error reporting to the one sink an end user's machine can reach.
//!
//! The JSONL log answers "what happened on this machine, once somebody thinks
//! to look". It cannot answer "is this happening to everybody". Bugsink is the
//! only error tracker in this homelab reachable from outside it: Loki,
//! Prometheus, Tempo and the OTLP gateway are Tailscale-only or have no
//! ingress at all.
//!
//! Three things keep the privacy promise, in order of how much they rely on
//! care:
//!
//! 1. Structure. This module's own reports are built from a
//!    [`DiagnosticEvent`], whose fields are bounded enums, numbers, and a
//!    `detail` string. Adding a field to that struct is the only way to widen
//!    what leaves the machine, which is a decision someone has to make on
//!    purpose.
//! 2. Scrubbing. `detail` is free text, and a panic carries a message and
//!    file paths of its own. [`scrub_event`] runs on every outgoing report,
//!    including panics the SDK captures itself, and removes paths, Riot IDs,
//!    long opaque tokens (PUUIDs, bearers), identity, breadcrumbs and
//!    everything else that is not on its allow-list.
//! 3. The opt-out. "Send error reports" is a [`SendGate`] checked in two
//!    places that cannot be skipped: [`BugsinkSink`] and the SDK's own
//!    `before_send`, which sees every event whatever produced it.

use std::sync::Arc;

use sentry::protocol::{Context, Event, Frame, Stacktrace};
use sentry::{ClientInitGuard, ClientOptions, Level};

use crate::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, DiagnosticSink,
};
use crate::settings::SendGate;

/// Holds error reporting open, and flushes what is queued when dropped.
///
/// Re-exported so the application crate does not need its own dependency on
/// the reporting SDK; this module is the only place that knows about it.
pub type ReportingGuard = ClientInitGuard;

/// Where crash and error reports go: the "Scout desktop client" Bugsink
/// project.
///
/// A client app's DSN is public by design — it is compiled into every shipped
/// binary and only authorises submitting events — which is why this is a
/// literal rather than a secret, matching `packages/tasks-for-obsidian/App.tsx`.
/// An empty value leaves the reporter uninstalled, the same way the
/// server-side initialisers treat an unset `BUGSINK_DSN`.
const BUGSINK_DSN: &str = "https://b8bedd02e8cf416692a4b550ab76bfc1@bugsink.sjer.red/17";

/// How long shutdown waits for queued reports before giving up.
///
/// A client that is offline, or behind a captive portal, must still exit
/// promptly. Reports that do not make it are lost, which is the right trade:
/// they are diagnostics, and the local log still has them.
const FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// The tags a report may carry. Everything else is dropped.
const ALLOWED_TAGS: &[&str] = &["category", "operation", "outcome", "status", "process"];

/// The one context a report may carry: the operating system family.
const ALLOWED_CONTEXTS: &[&str] = &["os"];

/// Which of the two processes is reporting, so a window crash and a collector
/// error are separable in Bugsink.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportingProcess {
    /// The GPU-free supervisor that owns collection.
    Supervisor,
    /// The relaunchable window child.
    Window,
}

impl ReportingProcess {
    const fn label(self) -> &'static str {
        match self {
            Self::Supervisor => "supervisor",
            Self::Window => "window",
        }
    }
}

/// Forwards the errors worth aggregating, and nothing else.
pub struct BugsinkSink {
    gate: SendGate,
}

impl BugsinkSink {
    /// A sink that reports only while `gate` is open.
    #[must_use]
    pub fn new(gate: SendGate) -> Self {
        Self { gate }
    }
}

/// The text of a report built from a diagnostic: stable across occurrences, so
/// Bugsink groups them, and free of anything [`redact_detail`] removes.
#[must_use]
pub fn report_message(event: &DiagnosticEvent) -> String {
    match &event.detail {
        Some(detail) => format!("{}: {}", event.operation, redact_detail(detail)),
        None => event.operation.to_owned(),
    }
}

impl DiagnosticSink for BugsinkSink {
    fn write(&self, event: &DiagnosticEvent) {
        // The user's choice, checked where the report is made.
        if !self.gate.allows() {
            return;
        }
        // Progress belongs in the local log. Only failures are worth the round
        // trip, and only they answer "is everyone hitting this".
        if event.level < DiagnosticLevel::Error {
            return;
        }
        sentry::with_scope(
            |scope| {
                scope.set_tag("category", format!("{:?}", event.category));
                scope.set_tag("operation", event.operation);
                scope.set_tag("outcome", format!("{:?}", event.outcome));
                if let Some(status) = event.status {
                    scope.set_tag("status", status.to_string());
                }
            },
            || {
                sentry::capture_message(
                    &report_message(event),
                    match event.level {
                        DiagnosticLevel::Critical => Level::Fatal,
                        _ => Level::Error,
                    },
                );
            },
        );
    }
}

/// Replace what must never leave the machine in a line of free text.
///
/// Works token by token on whitespace: anything containing a path separator, a
/// Riot ID's `#`, or a drive letter is a path or an identity; any long run of
/// identifier characters (a PUUID, a bearer token, a UUID, a digest) is an
/// opaque secret. Over-redaction is the safe direction here.
#[must_use]
pub fn redact_detail(text: &str) -> String {
    text.split_whitespace()
        .map(redact_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_token(token: &str) -> String {
    let core = token.trim_matches(|c: char| !c.is_alphanumeric() && !matches!(c, '/' | '\\' | '#'));
    if core.contains('/') || core.contains('\\') || is_drive_path(core) {
        return "<path>".to_owned();
    }
    if core.contains('#') {
        return "<riot-id>".to_owned();
    }
    let identifier = core
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '=' | '.'));
    if identifier && core.len() >= 20 && core.chars().any(|c| c.is_ascii_digit()) {
        return "<redacted>".to_owned();
    }
    token.to_owned()
}

fn is_drive_path(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn scrub_frame(frame: &mut Frame) {
    // Function and module names identify the fault; file locations name the
    // user's account and install location.
    frame.filename = None;
    frame.abs_path = None;
    frame.package = None;
    frame.pre_context.clear();
    frame.context_line = None;
    frame.post_context.clear();
    frame.vars.clear();
}

fn scrub_stacktrace(stacktrace: &mut Stacktrace) {
    stacktrace.frames.iter_mut().for_each(scrub_frame);
}

/// Reduce an outgoing report to its allow-list.
///
/// Runs inside the SDK's `before_send`, so it covers reports this crate makes
/// and the panics the SDK captures on its own. Returns `None`, dropping the
/// report, while `gate` is closed.
#[must_use]
pub fn scrub_event(
    gate: &SendGate,
    process: ReportingProcess,
    mut event: Event<'static>,
) -> Option<Event<'static>> {
    if !gate.allows() {
        return None;
    }
    event.user = None;
    event.request = None;
    event.server_name = None;
    event.breadcrumbs.values.clear();
    event.extra.clear();
    event.modules.clear();
    event.threads.values.clear();
    event.debug_meta = std::borrow::Cow::Owned(sentry::protocol::DebugMeta::default());
    event.culprit = None;
    event.transaction = None;
    event.logger = None;
    event
        .tags
        .retain(|key, _| ALLOWED_TAGS.contains(&key.as_str()));
    event
        .tags
        .insert("process".to_owned(), process.label().to_owned());
    event.contexts.retain(|key, context| {
        ALLOWED_CONTEXTS.contains(&key.as_str()) && matches!(context, Context::Os(_))
    });
    event.message = event.message.take().map(|message| redact_detail(&message));
    if let Some(entry) = event.logentry.as_mut() {
        entry.message = redact_detail(&entry.message);
        entry.params.clear();
    }
    for exception in &mut event.exception.values {
        // A panic payload is arbitrary text, and what actually identifies the
        // fault is its type and where it happened.
        exception.value = None;
        exception.stacktrace.as_mut().map(scrub_stacktrace);
        exception.raw_stacktrace.as_mut().map(scrub_stacktrace);
    }
    event.stacktrace.as_mut().map(scrub_stacktrace);
    Some(event)
}

/// Whether this build has somewhere to report errors, and why not when it does
/// not.
///
/// Recorded locally at startup so "is this machine reporting?" is answered in
/// the same log as everything else, rather than inferred from an absence of
/// issues somewhere nobody is looking.
#[must_use]
pub fn reporting_status(gate: &SendGate) -> DiagnosticEvent {
    let reporting = !BUGSINK_DSN.is_empty() && !cfg!(debug_assertions) && gate.allows();
    let detail = if BUGSINK_DSN.is_empty() {
        "no DSN configured; errors stay on this machine"
    } else if cfg!(debug_assertions) {
        "debug build; errors stay on this machine"
    } else if !gate.allows() {
        "error reports are turned off in Settings; errors stay on this machine"
    } else {
        "reporting errors to Bugsink"
    };
    DiagnosticEvent::new(
        DiagnosticLevel::Info,
        DiagnosticCategory::Runtime,
        "report_error",
        if reporting {
            DiagnosticOutcome::Succeeded
        } else {
            DiagnosticOutcome::Skipped
        },
    )
    .with_detail(detail)
}

/// The SDK options for `process`, with the opt-out and the scrubber installed.
///
/// Split from [`start_error_reporting`] so tests can build the exact options a
/// shipped client uses without starting a reporter.
pub fn client_options(
    environment: &str,
    process: ReportingProcess,
    gate: SendGate,
) -> ClientOptions {
    let mut options = ClientOptions::new()
        // Tracing stays disabled by default: Bugsink only receives errors.
        .release(env!("CARGO_PKG_VERSION"))
        .environment(environment.to_owned())
        .shutdown_timeout(FLUSH_TIMEOUT);
    options.send_default_pii = false;
    options.server_name = None;
    options.max_breadcrumbs = 0;
    options.before_send = Some(Arc::new(move |event| scrub_event(&gate, process, event)));
    options
}

/// Start error reporting, if this build has somewhere to report to.
///
/// The returned guard flushes on drop, so the caller must hold it for the life
/// of the process. `None` means reporting is not installed — no DSN, or a
/// debug build — and the client runs exactly as it did before, with its local
/// log intact. The reporter is installed even while the user has reports
/// turned off, because the switch can be flipped back on without a restart;
/// the gate is what stops sends in the meantime.
#[must_use]
pub fn start_error_reporting(
    environment: &str,
    process: ReportingProcess,
    gate: SendGate,
) -> Option<ClientInitGuard> {
    if BUGSINK_DSN.is_empty() || cfg!(debug_assertions) {
        return None;
    }
    Some(sentry::init((
        BUGSINK_DSN,
        client_options(environment, process, gate),
    )))
}

/// A stable environment name for the configured backend.
///
/// Beta and production issues must not merge into one, and a developer
/// pointing at a loopback backend should not file against either.
#[must_use]
pub fn reporting_environment(backend_origin: &str) -> &'static str {
    if backend_origin.contains("//beta.") {
        "beta"
    } else if backend_origin.contains("127.0.0.1") || backend_origin.contains("localhost") {
        "development"
    } else {
        "production"
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sentry::protocol::{Breadcrumb, Event, Exception, Frame, Stacktrace, User};

    use super::{
        BUGSINK_DSN, BugsinkSink, ReportingProcess, client_options, redact_detail, report_message,
        reporting_environment, reporting_status, scrub_event,
    };
    use crate::diagnostics::{
        DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, DiagnosticSink,
    };
    use crate::settings::SendGate;

    const PUUID: &str =
        "n0pqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuv";

    #[test]
    fn environments_are_distinguished_so_issues_do_not_merge() {
        assert_eq!(
            reporting_environment("https://beta.scout-for-lol.com"),
            "beta"
        );
        assert_eq!(
            reporting_environment("https://scout-for-lol.com"),
            "production"
        );
        assert_eq!(
            reporting_environment("http://127.0.0.1:3000"),
            "development"
        );
    }

    #[test]
    fn the_dsn_is_the_public_bugsink_ingest_address() {
        assert!(BUGSINK_DSN.starts_with("https://"));
        assert!(BUGSINK_DSN.contains("@bugsink.sjer.red/"));
    }

    #[test]
    fn the_client_says_locally_whether_it_reports_anywhere() {
        // Otherwise "no issues in Bugsink" is indistinguishable from "nothing
        // was ever reporting".
        let open = reporting_status(&SendGate::new(true));
        assert_eq!(open.operation, "report_error");
        assert!(open.detail.is_some());
        let closed = reporting_status(&SendGate::new(false));
        assert_eq!(closed.outcome, DiagnosticOutcome::Skipped);
    }

    #[test]
    fn free_text_loses_paths_riot_ids_and_opaque_tokens() {
        let redacted = redact_detail(&format!(
            "open failed C:\\Users\\jerred\\AppData\\scout.db and /Users/jerred/.cache/x \
             for Faker#KR1 puuid {PUUID} bearer sct_AbCdEfGhIjKlMnOpQrStUv123 status 404 retry"
        ));
        for forbidden in ["jerred", "Faker", "KR1", PUUID, "sct_AbCdEf", "AppData"] {
            assert!(
                !redacted.contains(forbidden),
                "{forbidden} leaked: {redacted}"
            );
        }
        // What is useful to a human survives.
        assert!(redacted.contains("open failed"));
        assert!(redacted.contains("status 404 retry"));
    }

    #[test]
    fn a_report_message_is_stable_and_redacted() {
        let event = DiagnosticEvent::new(
            DiagnosticLevel::Error,
            DiagnosticCategory::Backend,
            "upload_replay",
            DiagnosticOutcome::Failed,
        )
        .with_detail("could not read /Users/jerred/Replays/a.rofl");
        assert_eq!(
            report_message(&event),
            "upload_replay: could not read <path>"
        );
    }

    fn hostile_event() -> Event<'static> {
        let mut event = Event {
            message: Some(format!("failed for Faker#KR1 {PUUID} in /Users/jerred/x")),
            server_name: Some("jerreds-laptop".into()),
            user: Some(User {
                username: Some("jerred".to_owned()),
                ip_address: Some(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST).into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        event
            .tags
            .insert("category".to_owned(), "Backend".to_owned());
        event.tags.insert("puuid".to_owned(), PUUID.to_owned());
        event
            .extra
            .insert("path".to_owned(), "/Users/jerred".into());
        event.breadcrumbs.values.push(Breadcrumb {
            message: Some("opened C:\\Users\\jerred".to_owned()),
            ..Default::default()
        });
        event.modules.insert("scout".to_owned(), "0.1.0".to_owned());
        event.exception.values.push(Exception {
            ty: "panic".to_owned(),
            value: Some("called unwrap on /Users/jerred/settings.json".to_owned()),
            stacktrace: Some(Stacktrace {
                frames: vec![Frame {
                    function: Some("scout_client_app::main".to_owned()),
                    filename: Some("main.rs".to_owned()),
                    abs_path: Some("C:\\Users\\jerred\\scout\\main.rs".to_owned()),
                    lineno: Some(42),
                    context_line: Some("let puuid = \"secret\";".to_owned()),
                    vars: BTreeMap::from([("token".to_owned(), "sct_x".into())]),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        });
        event
    }

    #[test]
    fn the_scrubber_removes_every_forbidden_field() -> Result<(), &'static str> {
        let scrubbed = scrub_event(
            &SendGate::new(true),
            ReportingProcess::Window,
            hostile_event(),
        )
        .ok_or("an open gate must pass the report")?;
        let wire = serde_json::to_string(&scrubbed).map_err(|_| "serialise")?;
        for forbidden in [
            "jerred",
            "Faker",
            "KR1",
            PUUID,
            "laptop",
            "sct_x",
            "AppData",
            "main.rs",
            "secret",
            "127.0.0.1",
        ] {
            assert!(!wire.contains(forbidden), "{forbidden} leaked: {wire}");
        }
        assert!(scrubbed.user.is_none());
        assert_eq!(scrubbed.breadcrumbs.values.len(), 0);
        assert_eq!(scrubbed.extra.len(), 0);
        assert_eq!(scrubbed.modules.len(), 0);
        // The allow-listed tag survives, the unknown one does not, and the
        // process is stamped.
        assert_eq!(
            scrubbed.tags.get("category").map(String::as_str),
            Some("Backend")
        );
        assert!(!scrubbed.tags.contains_key("puuid"));
        assert_eq!(
            scrubbed.tags.get("process").map(String::as_str),
            Some("window")
        );
        // What identifies the fault stays.
        let frame = scrubbed
            .exception
            .values
            .first()
            .and_then(|exception| exception.stacktrace.as_ref())
            .and_then(|stacktrace| stacktrace.frames.first())
            .ok_or("frame")?;
        assert_eq!(frame.function.as_deref(), Some("scout_client_app::main"));
        assert_eq!(frame.lineno, Some(42));
        Ok(())
    }

    #[test]
    fn a_closed_gate_drops_every_report_before_it_is_sent() -> Result<(), &'static str> {
        let gate = SendGate::new(false);
        assert!(scrub_event(&gate, ReportingProcess::Supervisor, hostile_event()).is_none());
        // The same hook the shipped client installs.
        let options = client_options("beta", ReportingProcess::Supervisor, gate.clone());
        let before_send = options
            .before_send
            .ok_or("the opt-out hook must be installed")?;
        assert!(before_send(hostile_event()).is_none());
        gate.set(true);
        assert!(before_send(hostile_event()).is_some());
        Ok(())
    }

    #[test]
    fn the_sdk_options_forbid_default_pii_and_breadcrumbs() {
        let options = client_options("beta", ReportingProcess::Window, SendGate::new(true));
        assert!(!options.send_default_pii);
        assert_eq!(options.max_breadcrumbs, 0);
        assert!(options.server_name.is_none());
    }

    #[test]
    fn the_sink_does_nothing_while_reports_are_off() {
        // Without an initialised client `capture_message` is a no-op, so the
        // observable property here is that a closed sink returns before it
        // touches the SDK, and that an open one tolerates having no client.
        let event = DiagnosticEvent::new(
            DiagnosticLevel::Critical,
            DiagnosticCategory::Runtime,
            "window_crash",
            DiagnosticOutcome::Failed,
        );
        BugsinkSink::new(SendGate::new(false)).write(&event);
        BugsinkSink::new(SendGate::new(true)).write(&event);
    }
}
