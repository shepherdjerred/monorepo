//! Opt-out product telemetry: a closed set of events, sent to the Scout
//! backend and never to a third party.
//!
//! The wire contract is `data/src/scout-client/desktop-events.contract.json`;
//! the backend validates it strictly with Zod and this module validates the
//! same contract and fixtures with serde (see the tests).
//!
//! Every event carries the app version and bounded enum properties — no free
//! text, no identifiers, no paths. [`UsageEvent`] is the typed way to build
//! one, so an event outside the closed set or a property outside its enum is
//! not representable on this side either.
//!
//! "Send usage data" is enforced here, at the one place that can send:
//! [`UsageReporter::report`] checks its [`SendGate`] immediately before the
//! network call, and the backend method it calls is crate-private.

use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, ScoutBackendClient};
use crate::credentials::DeviceCredential;
use crate::settings::SendGate;

/// Where the backend accepts events.
pub const USAGE_EVENTS_PATH: &str = "/api/scout-client/v1/desktop/events";

/// The longest app version the contract admits.
const APP_VERSION_MAX_BYTES: usize = 64;

/// The operating system family, as a bounded value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    /// Microsoft Windows.
    Windows,
    /// Apple macOS.
    Macos,
    /// Linux.
    Linux,
    /// Anything else.
    Other,
}

impl Platform {
    /// The platform this binary runs on.
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }
}

/// Why the window process went away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowCrashCause {
    /// It exited with a failure status or was killed.
    Exited,
    /// It stopped reading or sent something unreadable.
    Unresponsive,
    /// The two processes disagreed on the protocol.
    ProtocolMismatch,
    /// It could not be started.
    LaunchFailed,
}

/// What the supervisor did about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowCrashOutcome {
    /// A new window was started.
    Relaunched,
    /// Too many quick crashes; relaunching stopped.
    GaveUp,
    /// Relaunching could only have repeated the failure.
    NotRelaunched,
}

/// The closed set of product events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageEvent {
    /// The client finished starting and checked in.
    AppStarted,
    /// This device was paired to an account.
    DevicePaired,
    /// A post-game report was accepted by the backend.
    PostGameReported,
    /// The first start of a different version than the last run.
    UpdateApplied,
    /// The window process crashed.
    WindowCrashed {
        /// What happened to it.
        cause: WindowCrashCause,
        /// What the supervisor did.
        outcome: WindowCrashOutcome,
    },
}

/// The event names, as they appear on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageEventName {
    /// See [`UsageEvent::AppStarted`].
    AppStarted,
    /// See [`UsageEvent::DevicePaired`].
    DevicePaired,
    /// See [`UsageEvent::PostGameReported`].
    PostGameReported,
    /// See [`UsageEvent::UpdateApplied`].
    UpdateApplied,
    /// See [`UsageEvent::WindowCrashed`].
    WindowCrashed,
}

/// The only properties an event may carry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageProperties {
    /// The operating system family.
    pub platform: Platform,
    /// `window_crashed` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<WindowCrashCause>,
    /// `window_crashed` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<WindowCrashOutcome>,
}

/// The JSON body of one event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageEventBody {
    /// Which event.
    pub event: UsageEventName,
    /// The client build version.
    pub app_version: String,
    /// Its bounded properties.
    pub properties: UsageProperties,
}

/// Why a body is not a valid event.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UsageEventError {
    /// The app version is not a short semantic version.
    #[error("appVersion is not a bounded semantic version")]
    AppVersion,
    /// `cause`/`outcome` are required on `window_crashed` and forbidden elsewhere.
    #[error("cause and outcome belong to window_crashed only")]
    Properties,
}

impl UsageEventBody {
    /// Build the body for `event` as sent by `app_version` on `platform`.
    #[must_use]
    pub fn new(event: UsageEvent, platform: Platform, app_version: &str) -> Self {
        let (name, cause, outcome) = match event {
            UsageEvent::AppStarted => (UsageEventName::AppStarted, None, None),
            UsageEvent::DevicePaired => (UsageEventName::DevicePaired, None, None),
            UsageEvent::PostGameReported => (UsageEventName::PostGameReported, None, None),
            UsageEvent::UpdateApplied => (UsageEventName::UpdateApplied, None, None),
            UsageEvent::WindowCrashed { cause, outcome } => {
                (UsageEventName::WindowCrashed, Some(cause), Some(outcome))
            }
        };
        Self {
            event: name,
            app_version: app_version.to_owned(),
            properties: UsageProperties {
                platform,
                cause,
                outcome,
            },
        }
    }

    /// Check what serde cannot: the version's shape and which event owns which
    /// property. The backend applies the same rules.
    ///
    /// # Errors
    ///
    /// Returns the first rule the body breaks.
    pub fn validate(&self) -> Result<(), UsageEventError> {
        if !is_app_version(&self.app_version) {
            return Err(UsageEventError::AppVersion);
        }
        let crash = self.event == UsageEventName::WindowCrashed;
        let has_crash_properties =
            self.properties.cause.is_some() && self.properties.outcome.is_some();
        let has_no_crash_properties =
            self.properties.cause.is_none() && self.properties.outcome.is_none();
        if (crash && has_crash_properties) || (!crash && has_no_crash_properties) {
            Ok(())
        } else {
            Err(UsageEventError::Properties)
        }
    }
}

/// `MAJOR.MINOR.PATCH` with an optional short pre-release, nothing else.
fn is_app_version(version: &str) -> bool {
    if version.len() > APP_VERSION_MAX_BYTES {
        return false;
    }
    let (core, pre_release) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let numbers: Vec<&str> = core.split('.').collect();
    let numeric =
        |part: &str| (1..=5).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit());
    numbers.len() == 3
        && numbers.iter().all(|part| numeric(part))
        && pre_release.is_none_or(|pre| {
            (1..=32).contains(&pre.len())
                && pre
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        })
}

/// What happened to a report.
#[derive(Debug)]
pub enum UsageOutcome {
    /// The backend accepted it.
    Sent,
    /// The user has turned usage data off; nothing left this machine.
    Suppressed,
    /// The backend or network refused it. Events are not retried: telemetry
    /// is best-effort and must never queue behind or block collection.
    Failed(BackendError),
}

/// The only way to send a product event.
#[derive(Debug, Clone)]
pub struct UsageReporter {
    gate: SendGate,
    platform: Platform,
    app_version: String,
}

impl UsageReporter {
    /// A reporter for this build, guarded by the "Send usage data" gate.
    #[must_use]
    pub fn new(gate: SendGate, app_version: &str) -> Self {
        Self {
            gate,
            platform: Platform::current(),
            app_version: app_version.to_owned(),
        }
    }

    /// Send `event` as `credential`'s device, unless usage data is off.
    pub async fn report(
        &self,
        backend: &ScoutBackendClient,
        credential: &DeviceCredential,
        event: UsageEvent,
    ) -> UsageOutcome {
        // Checked at the moment of sending, so a switch flipped while this
        // event waited for a credential or a tick still wins.
        if !self.gate.allows() {
            return UsageOutcome::Suppressed;
        }
        let body = UsageEventBody::new(event, self.platform, &self.app_version);
        match backend.send_usage_event(credential, &body).await {
            Ok(()) => UsageOutcome::Sent,
            Err(error) => UsageOutcome::Failed(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use uuid::Uuid;

    use super::{
        Platform, USAGE_EVENTS_PATH, UsageEvent, UsageEventBody, UsageOutcome, UsageReporter,
        WindowCrashCause, WindowCrashOutcome,
    };
    use crate::backend::ScoutBackendClient;
    use crate::credentials::DeviceCredential;
    use crate::settings::SendGate;

    const CONTRACT: &str =
        include_str!("../../../../data/src/scout-client/desktop-events.contract.json");
    const FIXTURES: &str =
        include_str!("../../../../data/src/scout-client/desktop-events.fixtures.json");

    fn json(text: &str) -> Result<Value, serde_json::Error> {
        serde_json::from_str(text)
    }

    #[test]
    fn valid_fixtures_round_trip_through_the_typed_body() -> Result<(), Box<dyn std::error::Error>>
    {
        let fixtures = json(FIXTURES)?;
        let valid = fixtures["valid"].as_array().ok_or("valid fixtures")?;
        assert_ne!(valid.len(), 0);
        for fixture in valid {
            let body: UsageEventBody = serde_json::from_value(fixture.clone())?;
            body.validate()?;
            assert_eq!(&serde_json::to_value(&body)?, fixture);
        }
        Ok(())
    }

    #[test]
    fn invalid_fixtures_are_refused_by_serde_or_validation()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixtures = json(FIXTURES)?;
        let invalid = fixtures["invalid"].as_array().ok_or("invalid fixtures")?;
        assert_ne!(invalid.len(), 0);
        for fixture in invalid {
            let reason = fixture["reason"].as_str().unwrap_or("?");
            let accepted = serde_json::from_value::<UsageEventBody>(fixture["body"].clone())
                .is_ok_and(|body| body.validate().is_ok());
            assert!(!accepted, "{reason} must be refused");
        }
        Ok(())
    }

    #[test]
    fn the_rust_enums_match_the_shared_contract() -> Result<(), Box<dyn std::error::Error>> {
        let contract = json(CONTRACT)?;
        assert_eq!(contract["path"], USAGE_EVENTS_PATH);
        let names = |value: &Value| -> Vec<String> {
            value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|i| i.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default()
        };
        let serialised = |values: &[Value]| -> Vec<String> {
            values
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        };
        let platforms = [
            Platform::Windows,
            Platform::Macos,
            Platform::Linux,
            Platform::Other,
        ]
        .map(|p| serde_json::to_value(p).unwrap_or(Value::Null));
        assert_eq!(
            serialised(&platforms),
            names(&contract["commonProperties"]["platform"])
        );
        let causes = [
            WindowCrashCause::Exited,
            WindowCrashCause::Unresponsive,
            WindowCrashCause::ProtocolMismatch,
            WindowCrashCause::LaunchFailed,
        ]
        .map(|c| serde_json::to_value(c).unwrap_or(Value::Null));
        assert_eq!(
            serialised(&causes),
            names(&contract["events"]["window_crashed"]["cause"])
        );
        let outcomes = [
            WindowCrashOutcome::Relaunched,
            WindowCrashOutcome::GaveUp,
            WindowCrashOutcome::NotRelaunched,
        ]
        .map(|o| serde_json::to_value(o).unwrap_or(Value::Null));
        assert_eq!(
            serialised(&outcomes),
            names(&contract["events"]["window_crashed"]["outcome"])
        );
        let events = [
            UsageEvent::AppStarted,
            UsageEvent::DevicePaired,
            UsageEvent::PostGameReported,
            UsageEvent::UpdateApplied,
            UsageEvent::WindowCrashed {
                cause: WindowCrashCause::Exited,
                outcome: WindowCrashOutcome::GaveUp,
            },
        ]
        .map(|event| {
            serde_json::to_value(UsageEventBody::new(event, Platform::Linux, "0.1.0").event)
                .unwrap_or(Value::Null)
        });
        let contract_events: Vec<String> = contract["events"]
            .as_object()
            .ok_or("events")?
            .keys()
            .cloned()
            .collect();
        assert_eq!(serialised(&events), contract_events);
        Ok(())
    }

    #[test]
    fn built_bodies_are_always_valid() -> Result<(), Box<dyn std::error::Error>> {
        for event in [
            UsageEvent::AppStarted,
            UsageEvent::DevicePaired,
            UsageEvent::PostGameReported,
            UsageEvent::UpdateApplied,
            UsageEvent::WindowCrashed {
                cause: WindowCrashCause::Unresponsive,
                outcome: WindowCrashOutcome::Relaunched,
            },
        ] {
            UsageEventBody::new(event, Platform::current(), env!("CARGO_PKG_VERSION"))
                .validate()?;
        }
        Ok(())
    }

    /// A one-shot HTTP server that counts connections and answers 202.
    async fn counting_server() -> Result<(String, Arc<AtomicUsize>), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let connections = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&connections);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut buffer = vec![0_u8; 4096];
                let _ = stream.read(&mut buffer).await;
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 202 Accepted\r\ncontent-type: application/json\r\ncontent-length: 17\r\nconnection: close\r\n\r\n{\"accepted\":true}",
                    )
                    .await;
            }
        });
        Ok((origin, connections))
    }

    fn credential() -> DeviceCredential {
        DeviceCredential {
            device_id: Uuid::new_v4(),
            token: "sct_test".to_owned(),
        }
    }

    #[tokio::test]
    async fn nothing_is_sent_while_usage_data_is_off() -> Result<(), Box<dyn std::error::Error>> {
        let (origin, connections) = counting_server().await?;
        let backend = ScoutBackendClient::new(&origin)?;
        let gate = SendGate::new(false);
        let reporter = UsageReporter::new(gate.clone(), "0.1.0");

        let outcome = reporter
            .report(&backend, &credential(), UsageEvent::AppStarted)
            .await;
        assert!(matches!(outcome, UsageOutcome::Suppressed));
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(connections.load(Ordering::SeqCst), 0);

        // Turning it on is the only thing that changes this.
        gate.set(true);
        let outcome = reporter
            .report(&backend, &credential(), UsageEvent::AppStarted)
            .await;
        assert!(matches!(outcome, UsageOutcome::Sent), "{outcome:?}");
        assert_eq!(connections.load(Ordering::SeqCst), 1);

        // And turning it off again takes effect on the very next event.
        gate.set(false);
        let outcome = reporter
            .report(&backend, &credential(), UsageEvent::DevicePaired)
            .await;
        assert!(matches!(outcome, UsageOutcome::Suppressed));
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        Ok(())
    }
}
