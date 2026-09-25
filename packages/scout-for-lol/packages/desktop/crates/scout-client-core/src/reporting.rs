//! Error reporting to the one sink an end user's machine can reach.
//!
//! The JSONL log answers "what happened on this machine, once somebody thinks
//! to look". It cannot answer "is this happening to everybody". Bugsink is the
//! only error tracker in this homelab reachable from outside it: Loki,
//! Prometheus, Tempo and the OTLP gateway are Tailscale-only or have no
//! ingress at all.
//!
//! What keeps the privacy promise here is structural rather than careful. This
//! module can only see a [`DiagnosticEvent`], whose fields are bounded enums,
//! numbers, and a `detail` string callers build from fixed text — so a
//! credential, PUUID or filesystem path is not scrubbed on the way out, it was
//! never representable. Adding a field to that struct is the only way to widen
//! what leaves the machine, which is a decision someone has to make on purpose.

use sentry::{ClientInitGuard, ClientOptions, Level};

use crate::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, DiagnosticSink,
};

/// Holds error reporting open, and flushes what is queued when dropped.
///
/// Re-exported so the application crate does not need its own dependency on
/// the reporting SDK; this module is the only place that knows about it.
pub type ReportingGuard = ClientInitGuard;

/// Where crash and error reports go.
///
/// Empty until a Bugsink project exists for the desktop client. A client app's
/// DSN is public by design — it is compiled into every shipped binary — which
/// is why this is a literal rather than a secret, matching
/// `packages/tasks-for-obsidian/App.tsx`. While it is empty the reporter is
/// simply not installed, the same way the server-side initialisers treat an
/// unset `SENTRY_DSN`.
const BUGSINK_DSN: &str = "";

/// How long shutdown waits for queued reports before giving up.
///
/// A client that is offline, or behind a captive portal, must still exit
/// promptly. Reports that do not make it are lost, which is the right trade:
/// they are diagnostics, and the local log still has them.
const FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Forwards the errors worth aggregating, and nothing else.
pub struct BugsinkSink;

impl DiagnosticSink for BugsinkSink {
    fn write(&self, event: &DiagnosticEvent) {
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
                    &event.summary(),
                    match event.level {
                        DiagnosticLevel::Critical => Level::Fatal,
                        _ => Level::Error,
                    },
                );
            },
        );
    }
}

/// Start error reporting, if this build has somewhere to report to.
///
/// The returned guard flushes on drop, so the caller must hold it for the life
/// of the process. `None` means reporting is off — no DSN, or a debug build —
/// and the client runs exactly as it did before, with its local log intact.
/// Whether this build reports errors anywhere, and why not when it does not.
///
/// Recorded locally at startup so "is this machine reporting?" is answered in
/// the same log as everything else, rather than inferred from an absence of
/// issues somewhere nobody is looking.
#[must_use]
pub fn reporting_status() -> DiagnosticEvent {
    let reporting = !BUGSINK_DSN.is_empty() && !cfg!(debug_assertions);
    let detail = if BUGSINK_DSN.is_empty() {
        "no DSN configured; errors stay on this machine"
    } else if cfg!(debug_assertions) {
        "debug build; errors stay on this machine"
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

/// Start error reporting, if this build has somewhere to report to.
///
/// The returned guard flushes on drop, so the caller must hold it for the life
/// of the process. `None` means reporting is off — no DSN, or a debug build —
/// and the client runs exactly as it did before, with its local log intact.
#[must_use]
pub fn start_error_reporting(environment: &str) -> Option<ClientInitGuard> {
    if BUGSINK_DSN.is_empty() || cfg!(debug_assertions) {
        return None;
    }
    Some(sentry::init((
        BUGSINK_DSN,
        ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: Some(environment.to_owned().into()),
            // Bugsink has no performance monitoring; every call site in this
            // repository says so.
            traces_sample_rate: 0.0,
            shutdown_timeout: FLUSH_TIMEOUT,
            ..Default::default()
        },
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
    use super::{BUGSINK_DSN, reporting_environment, reporting_status, start_error_reporting};
    use crate::diagnostics::DiagnosticOutcome;

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
    fn the_client_says_locally_whether_it_reports_anywhere() {
        // Otherwise "no issues in Bugsink" is indistinguishable from "nothing
        // was ever reporting".
        let status = reporting_status();
        assert_eq!(status.operation, "report_error");
        assert!(status.detail.is_some());
        if BUGSINK_DSN.is_empty() {
            assert_eq!(status.outcome, DiagnosticOutcome::Skipped);
        }
    }

    #[test]
    fn reporting_stays_off_until_there_is_somewhere_to_report_to() {
        // No DSN means no reporter, and a client that works exactly as before.
        if BUGSINK_DSN.is_empty() {
            assert!(start_error_reporting("beta").is_none());
        }
    }
}
