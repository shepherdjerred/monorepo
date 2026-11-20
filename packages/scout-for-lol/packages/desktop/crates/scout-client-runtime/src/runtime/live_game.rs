//! Live game state in the collector: poll `allgamedata` while a game is in
//! progress, publish the allowlisted snapshot, and record it locally.

use chrono::Utc;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::lcu::LiveClient;
use scout_client_core::live::recording::{LiveRecorder, RECORDINGS_FILE, RecordingStore};
use scout_client_core::live::session::LiveGameSession;
use scout_client_core::live::source::LiveGameSource;
use scout_client_core::live::upload::{OutboxHandoff, UploadContext};
use scout_client_core::outbox::ObservationOutbox;
use std::collections::HashMap;
use std::sync::Arc;

use super::champ_select::ChampSelectWatcher;
use super::gameflow::IN_PROGRESS_GAME_KEY;
use super::paths::data_directory;
use super::state::{StateHub, update_state};

/// The collector's live-game state. Polled once per collection tick, which is
/// the two-second live-data cadence.
pub(super) struct LiveGame<S = LiveClient> {
    /// Absent when the loopback client could not be built.
    session: Option<LiveGameSession<S, OutboxHandoff>>,
    /// What the hand-off needs to know when a game ends.
    upload: UploadContext,
    last_problem: Option<String>,
    /// The champion-select screen, polled on the same tick.
    champ_select: ChampSelectWatcher,
}

impl LiveGame<LiveClient> {
    pub(super) fn new(client: Option<LiveClient>, diagnostics: &Arc<Diagnostics>) -> Self {
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
        let upload = UploadContext::default();
        let handoff = OutboxHandoff::new(
            upload.clone(),
            env!("CARGO_PKG_VERSION"),
            Arc::clone(diagnostics),
        );
        Self {
            session: client.map(|client| LiveGameSession::new(client, recorder, handoff)),
            upload,
            last_problem: None,
            champ_select: ChampSelectWatcher::default(),
        }
    }
}

impl<S: LiveGameSource> LiveGame<S> {
    /// Poll for the current gameflow phase and publish the result.
    ///
    /// `outbox` is the paired device's outbox, or `None` while unpaired, in
    /// which case a finished recording stays on this device. `payloads` holds
    /// the observer and the game in progress, for the recording's envelope.
    pub(super) async fn tick(
        &mut self,
        state: &StateHub,
        diagnostics: &Diagnostics,
        outbox: Option<&ObservationOutbox>,
        payloads: &HashMap<String, Vec<u8>>,
    ) {
        let text = |key: &str| {
            payloads
                .get(key)
                .and_then(|bytes| std::str::from_utf8(bytes).ok())
        };
        self.champ_select.tick(state, diagnostics).await;
        self.upload.set_outbox(outbox.cloned());
        let Some(session) = &mut self.session else {
            self.upload
                .observe(text("observer"), text(IN_PROGRESS_GAME_KEY));
            return;
        };
        let phase = state.current_phase();
        let outcome = session.tick(&phase, Utc::now()).await;
        // Observe after the tick: when a missed transition makes the recorder
        // hand off the previous game inside this tick, the hand-off must still
        // read that game's id, not the new game's.
        self.upload
            .observe(text("observer"), text(IN_PROGRESS_GAME_KEY));
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::live::gameflow::GameflowPhase;
    use scout_client_core::live::model::AllGameData;
    use scout_client_core::live::recording::{LiveRecorder, RecordingStore};
    use scout_client_core::live::session::LiveGameSession;
    use scout_client_core::live::snapshot::{LiveSnapshot, project};
    use scout_client_core::live::source::{ReplayFrame, ReplaySource};
    use scout_client_core::live::upload::{OutboxHandoff, UploadContext};
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::{ObservationEnvelope, ObservationKind};
    use uuid::Uuid;

    use super::{ChampSelectWatcher, IN_PROGRESS_GAME_KEY, LiveGame};
    use crate::runtime::state::{StateHub, update_state};

    const FRAME: &str = include_str!("../../../scout-client-core/testdata/live/allgamedata.json");

    fn snapshot_at(secs: u32) -> Result<LiveSnapshot, Box<dyn std::error::Error>> {
        let mut snapshot = project(&serde_json::from_str::<AllGameData>(FRAME)?)?;
        snapshot.game.game_time_secs = secs;
        Ok(snapshot)
    }

    fn payloads(game_id: &str) -> HashMap<String, Vec<u8>> {
        HashMap::from([
            ("observer".to_owned(), b"observer-puuid".to_vec()),
            (IN_PROGRESS_GAME_KEY.to_owned(), game_id.as_bytes().to_vec()),
        ])
    }

    /// Game A ends without an observed `EndOfGame` and game B's first tick
    /// arrives with a different game id. A's finished recording is handed off
    /// inside that tick, so it must carry A's id, never B's.
    #[tokio::test]
    async fn a_missed_transition_uploads_the_finished_game_under_its_own_id()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-livegame-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let upload = UploadContext::default();
        let diagnostics = Arc::new(Diagnostics::in_memory());
        let frame = |secs| -> Result<ReplayFrame, Box<dyn std::error::Error>> {
            Ok(ReplayFrame {
                phase: GameflowPhase::InProgress,
                live: Some(snapshot_at(secs)?),
                champ_select: None,
            })
        };
        let source = ReplaySource::new(vec![frame(100)?, frame(102)?, frame(3)?]);
        let mut game = LiveGame {
            session: Some(LiveGameSession::new(
                source,
                Some(LiveRecorder::new(RecordingStore::open_in_memory()?)),
                OutboxHandoff::new(upload.clone(), "test", Arc::clone(&diagnostics)),
            )),
            upload,
            last_problem: None,
            champ_select: ChampSelectWatcher::default(),
        };
        let state = StateHub::default();
        update_state(&state, |snapshot| {
            snapshot.gameflow_phase = Some("InProgress".to_owned());
        });

        for (id, step) in [("111", 0), ("111", 1), ("222", 2)] {
            game.tick(&state, &diagnostics, Some(&outbox), &payloads(id))
                .await;
            if step < 2 {
                assert_eq!(outbox.pending(10)?.len(), 0, "game A is still running");
            }
            if let Some(session) = &game.session {
                session.source().advance();
            }
        }

        let pending = outbox.pending(10)?;
        assert_eq!(pending.len(), 1, "game A's recording, and nothing of B");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::LiveGameRecording);
        assert_eq!(sent.game_id.as_deref(), Some("111"));
        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }
}
