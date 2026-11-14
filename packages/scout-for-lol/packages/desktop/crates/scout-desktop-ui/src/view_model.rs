//! Plain view models built from the supervisor's IPC snapshot.
//!
//! Nothing here knows about GPUI, so it builds and is tested on every target.
//! The views render these structs and nothing else; every control maps to the
//! [`WindowMessage`] it sends.

use scout_desktop_ipc::{GameflowPhase, StateSnapshot, WindowMessage};

/// What the window was built as, shown on the Diagnostics page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildInfo {
    /// The Scout Client version.
    pub client_version: &'static str,
    /// The Scout Client wire protocol version.
    pub protocol_version: u16,
}

/// A page of the window.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PageId {
    /// League, account, and upload status.
    #[default]
    Overview,
    /// Outbox depth.
    Activity,
    /// Pairing, start at login, and quit.
    Settings,
    /// Versions, counters, and recent events.
    Diagnostics,
}

impl PageId {
    /// Every page, in navigation order.
    pub const ALL: [Self; 4] = [
        Self::Overview,
        Self::Activity,
        Self::Settings,
        Self::Diagnostics,
    ];

    /// The navigation label.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Overview => "Overview",
            Self::Activity => "Activity",
            Self::Settings => "Settings",
            Self::Diagnostics => "Diagnostics",
        }
    }
}

/// How a status value reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    /// Plain text.
    Normal,
    /// Working as intended.
    Good,
    /// Not there yet, but not a fault.
    Waiting,
}

/// One labelled status value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusLine {
    /// The label.
    pub label: &'static str,
    /// The value.
    pub value: String,
    /// How the value reads.
    pub tone: Tone,
}

impl StatusLine {
    fn new(label: &'static str, value: impl Into<String>, tone: Tone) -> Self {
        Self {
            label,
            value: value.into(),
            tone,
        }
    }
}

/// The Overview page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverviewModel {
    /// League, account, phase, uploads, and pairing.
    pub rows: Vec<StatusLine>,
    /// The last typed boundary error, if any.
    pub error: Option<String>,
}

impl OverviewModel {
    /// Build the Overview page from a snapshot.
    #[must_use]
    pub fn new(state: &StateSnapshot) -> Self {
        let connected = |yes: bool, on: &str, off: &str| {
            if yes {
                (on.to_owned(), Tone::Good)
            } else {
                (off.to_owned(), Tone::Waiting)
            }
        };
        let (league, league_tone) = connected(state.league_connected, "Connected", "Waiting");
        let (paired, paired_tone) = connected(state.paired, "Paired", "Not paired");
        let optional = |value: Option<&str>, missing: &str| match value {
            Some(value) => (value.to_owned(), Tone::Normal),
            None => (missing.to_owned(), Tone::Waiting),
        };
        let (account, account_tone) = optional(state.account_label.as_deref(), "Not detected");
        let (phase, phase_tone) = optional(state.gameflow_phase.as_deref(), "None");
        let (upload, upload_tone) = optional(state.last_upload_at.as_deref(), "Not yet");
        Self {
            rows: vec![
                StatusLine::new("League", league, league_tone),
                StatusLine::new("Account", account, account_tone),
                StatusLine::new("Game phase", phase, phase_tone),
                StatusLine::new(
                    "Pending uploads",
                    state.pending_observations.to_string(),
                    Tone::Normal,
                ),
                StatusLine::new("Scout API", paired, paired_tone),
                StatusLine::new("Last upload", upload, upload_tone),
            ],
            error: state.last_error.clone(),
        }
    }
}

/// The Activity page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityModel {
    /// The outbox summary.
    pub summary: String,
}

impl ActivityModel {
    /// Build the Activity page from a snapshot.
    #[must_use]
    pub fn new(state: &StateSnapshot) -> Self {
        Self {
            summary: format!(
                "{} observation(s) waiting for durable upload.",
                state.pending_observations
            ),
        }
    }
}

/// A button on the Settings page and the message it sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Action {
    /// A stable element id.
    pub id: &'static str,
    /// The button label.
    pub label: &'static str,
    /// What clicking it sends to the supervisor.
    pub message: WindowMessage,
    /// Whether this is the page's main action.
    pub primary: bool,
    /// Whether it removes something.
    pub destructive: bool,
}

/// The Settings page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsModel {
    /// Human-readable pairing state.
    pub pairing_status: String,
    /// Pair, open the approval page, or disconnect, as they apply.
    pub pairing_actions: Vec<Action>,
    /// Whether start at login is on.
    pub start_at_login: bool,
    /// The quit button.
    pub quit: Action,
}

/// The note under the start-at-login control.
pub const OBSERVATION_NOTE: &str = "Scout observes gameplay state only while League is running.";
/// The start-at-login label.
pub const START_AT_LOGIN_LABEL: &str = "Start Scout Client at login";

impl SettingsModel {
    /// Build the Settings page from a snapshot.
    #[must_use]
    pub fn new(state: &StateSnapshot) -> Self {
        let pairing_status = state.pairing_status.clone().unwrap_or_else(|| {
            if state.paired {
                "Paired".to_owned()
            } else {
                "Not paired".to_owned()
            }
        });
        let mut pairing_actions = Vec::new();
        if !state.paired {
            pairing_actions.push(Action {
                id: "pair",
                label: "Pair with Scout",
                message: WindowMessage::Pair,
                primary: true,
                destructive: false,
            });
        }
        if let Some(url) = &state.approval_url {
            pairing_actions.push(Action {
                id: "open-approval",
                label: "Open approval page",
                message: WindowMessage::OpenUrl { url: url.clone() },
                primary: false,
                destructive: false,
            });
        }
        if state.paired {
            pairing_actions.push(Action {
                id: "disconnect",
                label: "Disconnect",
                message: WindowMessage::Disconnect,
                primary: false,
                destructive: true,
            });
        }
        Self {
            pairing_status,
            pairing_actions,
            start_at_login: state.start_at_login,
            quit: Action {
                id: "quit",
                label: "Quit Scout",
                message: WindowMessage::Quit,
                primary: false,
                destructive: false,
            },
        }
    }

    /// The message toggling start at login sends.
    #[must_use]
    pub const fn toggle_start_at_login(&self) -> WindowMessage {
        WindowMessage::SetStartAtLogin {
            enabled: !self.start_at_login,
        }
    }
}

/// The Diagnostics page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticsModel {
    /// Versions, connection, phase, and outbox depth, as monospace lines.
    pub facts: Vec<String>,
    /// Open log folder (when a folder exists) and copy diagnostics.
    pub actions: Vec<Action>,
    /// `(name, value)` for every counter.
    pub counters: Vec<(String, String)>,
    /// The most recent event summaries, newest first.
    pub recent_events: Vec<String>,
}

/// What the diagnostics page promises about its contents.
pub const PRIVACY_NOTE: &str =
    "Credentials, PUUIDs, and local filesystem paths are excluded from diagnostics.";

impl DiagnosticsModel {
    /// Build the Diagnostics page from a snapshot.
    #[must_use]
    pub fn new(state: &StateSnapshot, phase: &GameflowPhase, build: BuildInfo) -> Self {
        let mut actions = Vec::new();
        if state.diagnostics.log_folder_available {
            actions.push(Action {
                id: "open-log-folder",
                label: "Open log folder",
                message: WindowMessage::OpenLogFolder,
                primary: false,
                destructive: false,
            });
        }
        actions.push(Action {
            id: "copy-diagnostics",
            label: "Copy diagnostics",
            message: WindowMessage::RequestDiagnostics,
            primary: false,
            destructive: false,
        });
        Self {
            facts: vec![
                format!("Client version: {}", build.client_version),
                format!("Protocol version: {}", build.protocol_version),
                format!("League connected: {}", state.league_connected),
                format!("Gameflow phase: {phase:?}"),
                format!("Outbox depth: {}", state.pending_observations),
            ],
            actions,
            counters: state
                .diagnostics
                .counters
                .iter()
                .map(|counter| (counter.name.clone(), counter.value.to_string()))
                .collect(),
            recent_events: state.diagnostics.recent_events.clone(),
        }
    }
}

/// With a tray, closing the window only ends this process; the supervisor
/// keeps collecting and the tray can open a new window. Without one, closing
/// it quits Scout, since nothing else could reopen it.
#[must_use]
pub const fn should_quit_on_close(closing: bool, tray_available: bool) -> bool {
    !closing && !tray_available
}

#[cfg(test)]
mod tests {
    use scout_desktop_ipc::{
        CounterReading, DiagnosticsSnapshot, GameflowPhase, StateSnapshot, WindowMessage,
    };

    use super::{
        ActivityModel, BuildInfo, DiagnosticsModel, OverviewModel, PageId, SettingsModel, Tone,
        should_quit_on_close,
    };

    fn unpaired() -> StateSnapshot {
        StateSnapshot {
            approval_url: Some("https://beta.scout-for-lol.com/pair/abc".to_owned()),
            pairing_status: Some("Waiting for approval".to_owned()),
            ..StateSnapshot::default()
        }
    }

    fn paired() -> StateSnapshot {
        StateSnapshot {
            league_connected: true,
            gameflow_phase: Some("ChampSelect".to_owned()),
            account_label: Some("Scout#NA1".to_owned()),
            paired: true,
            start_at_login: true,
            pending_observations: 4,
            last_upload_at: Some("2026-11-11T10:00:00Z".to_owned()),
            last_error: Some("League unavailable".to_owned()),
            diagnostics: DiagnosticsSnapshot {
                log_folder_available: true,
                counters: vec![CounterReading {
                    name: "observations_uploaded".to_owned(),
                    value: 12,
                }],
                recent_events: vec!["info runtime start ok".to_owned()],
            },
            ..StateSnapshot::default()
        }
    }

    fn ids(actions: &[super::Action]) -> Vec<&'static str> {
        actions.iter().map(|action| action.id).collect()
    }

    #[test]
    fn navigation_matches_the_egui_window() {
        let labels = PageId::ALL.map(PageId::label);
        assert_eq!(labels, ["Overview", "Activity", "Settings", "Diagnostics"]);
        assert_eq!(PageId::default(), PageId::Overview);
    }

    #[test]
    fn overview_reports_each_status_with_its_fallback() {
        let empty = OverviewModel::new(&StateSnapshot::default());
        let values = empty
            .rows
            .iter()
            .map(|row| (row.label, row.value.as_str(), row.tone))
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            [
                ("League", "Waiting", Tone::Waiting),
                ("Account", "Not detected", Tone::Waiting),
                ("Game phase", "None", Tone::Waiting),
                ("Pending uploads", "0", Tone::Normal),
                ("Scout API", "Not paired", Tone::Waiting),
                ("Last upload", "Not yet", Tone::Waiting),
            ]
        );
        assert_eq!(empty.error, None);

        let live = OverviewModel::new(&paired());
        assert_eq!(live.rows[0].value, "Connected");
        assert_eq!(live.rows[0].tone, Tone::Good);
        assert_eq!(live.rows[1].value, "Scout#NA1");
        assert_eq!(live.rows[3].value, "4");
        assert_eq!(live.error.as_deref(), Some("League unavailable"));
    }

    #[test]
    fn activity_counts_the_outbox() {
        assert_eq!(
            ActivityModel::new(&paired()).summary,
            "4 observation(s) waiting for durable upload."
        );
    }

    #[test]
    fn settings_offers_pairing_until_paired_and_disconnect_after() {
        let pairing = SettingsModel::new(&unpaired());
        assert_eq!(pairing.pairing_status, "Waiting for approval");
        assert_eq!(ids(&pairing.pairing_actions), ["pair", "open-approval"]);
        assert_eq!(pairing.pairing_actions[0].message, WindowMessage::Pair);
        assert_eq!(
            pairing.pairing_actions[1].message,
            WindowMessage::OpenUrl {
                url: "https://beta.scout-for-lol.com/pair/abc".to_owned()
            }
        );

        let connected = SettingsModel::new(&paired());
        assert_eq!(connected.pairing_status, "Paired");
        assert_eq!(ids(&connected.pairing_actions), ["disconnect"]);
        assert_eq!(
            connected.pairing_actions[0].message,
            WindowMessage::Disconnect
        );
        assert_eq!(connected.quit.message, WindowMessage::Quit);
    }

    #[test]
    fn the_start_at_login_toggle_sends_the_opposite_state() {
        assert_eq!(
            SettingsModel::new(&paired()).toggle_start_at_login(),
            WindowMessage::SetStartAtLogin { enabled: false }
        );
        assert_eq!(
            SettingsModel::new(&unpaired()).toggle_start_at_login(),
            WindowMessage::SetStartAtLogin { enabled: true }
        );
    }

    #[test]
    fn diagnostics_shows_versions_counters_and_events() {
        let build = BuildInfo {
            client_version: "0.1.0",
            protocol_version: 3,
        };
        let model = DiagnosticsModel::new(&paired(), &GameflowPhase::ChampSelect, build);
        assert_eq!(
            model.facts,
            [
                "Client version: 0.1.0",
                "Protocol version: 3",
                "League connected: true",
                "Gameflow phase: ChampSelect",
                "Outbox depth: 4",
            ]
        );
        assert_eq!(ids(&model.actions), ["open-log-folder", "copy-diagnostics"]);
        assert_eq!(
            model.counters,
            [("observations_uploaded".to_owned(), "12".to_owned())]
        );
        assert_eq!(model.recent_events, ["info runtime start ok"]);

        let without_logs =
            DiagnosticsModel::new(&StateSnapshot::default(), &GameflowPhase::default(), build);
        assert_eq!(ids(&without_logs.actions), ["copy-diagnostics"]);
        assert_eq!(without_logs.facts[3], "Gameflow phase: Disconnected");
    }

    #[test]
    fn closing_quits_only_when_no_tray_can_reopen_the_window() {
        assert!(should_quit_on_close(false, false));
        assert!(!should_quit_on_close(false, true));
        assert!(!should_quit_on_close(true, false));
    }
}
