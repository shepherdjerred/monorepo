//! Live game state in the collector: poll `allgamedata` while a game is in
//! progress, publish the allowlisted snapshot, and record it locally.

use chrono::Utc;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::lcu::LiveClient;
use scout_client_core::live::recording::{
    LiveRecorder, LocalOnly, RECORDINGS_FILE, RecordingStore,
};
use scout_client_core::live::session::LiveGameSession;

use super::paths::data_directory;
use super::state::{StateHub, update_state};

/// The collector's live-game state. Polled once per collection tick, which is
/// the two-second live-data cadence.
pub(super) struct LiveGame {
    /// Absent when the loopback client could not be built.
    session: Option<LiveGameSession<LiveClient, LocalOnly>>,
    last_problem: Option<String>,
}

impl LiveGame {
    pub(super) fn new(client: Option<LiveClient>, diagnostics: &Diagnostics) -> Self {
        let recorder = open_recorder().map_or_else(
            |problem| {
                record(
                    diagnostics,
                    "open_recordings",
                    DiagnosticOutcome::Failed,
                    &problem,
                );
                None
            },
            Some,
        );
        Self {
            session: client.map(|client| LiveGameSession::new(client, recorder, LocalOnly)),
            last_problem: None,
        }
    }

    /// Poll for the current gameflow phase and publish the result.
    pub(super) async fn tick(&mut self, state: &StateHub, diagnostics: &Diagnostics) {
        let Some(session) = &mut self.session else {
            return;
        };
        let phase = state.current_phase();
        let outcome = session.tick(&phase, Utc::now()).await;
        let live = session.latest().cloned();
        update_state(state, |snapshot| snapshot.live_game = live);
        // One diagnostic per distinct problem, not one per two-second poll.
        match outcome {
            Ok(()) => self.last_problem = None,
            Err(error) => {
                let problem = error.to_string();
                if self.last_problem.as_deref() != Some(&problem) {
                    record(
                        diagnostics,
                        "live_game_poll",
                        DiagnosticOutcome::Failed,
                        &problem,
                    );
                    self.last_problem = Some(problem);
                }
            }
        }
    }
}

fn open_recorder() -> Result<LiveRecorder, String> {
    let directory = data_directory().ok_or("there is no data folder")?;
    RecordingStore::open(directory.join(RECORDINGS_FILE))
        .map(LiveRecorder::new)
        .map_err(|error| error.to_string())
}

fn record(
    diagnostics: &Diagnostics,
    operation: &'static str,
    outcome: DiagnosticOutcome,
    detail: &str,
) {
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Lcu,
            operation,
            outcome,
        )
        .with_detail(detail),
    );
}
