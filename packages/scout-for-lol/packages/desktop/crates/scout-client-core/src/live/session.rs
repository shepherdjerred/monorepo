//! Polls a live source while a game is in progress, and records it.

use chrono::{DateTime, Utc};
use thiserror::Error;

use super::gameflow::GameflowPhase;
use super::recording::{LiveRecorder, RecordingError, RecordingHandoff};
use super::snapshot::LiveSnapshot;
use super::source::{LcuSource, LiveGameSource, SourceError};

/// How often the live source is polled while a game is in progress.
pub const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// A failed poll.
#[derive(Debug, Error)]
pub enum SessionError {
    /// The source could not be read.
    #[error(transparent)]
    Source(#[from] SourceError),
    /// The snapshot could not be recorded.
    #[error(transparent)]
    Recording(#[from] RecordingError),
}

/// The live game state of this device: the newest snapshot, and its recording.
///
/// Live data is read only while gameflow is `InProgress`. Any other phase
/// except `Reconnect` ends the game: the snapshot clears and the recording is
/// finished and handed off.
pub struct LiveGameSession<S, H> {
    source: S,
    recorder: Option<LiveRecorder>,
    handoff: H,
    latest: Option<LiveSnapshot>,
}

impl<S: LiveGameSource, H: RecordingHandoff> LiveGameSession<S, H> {
    /// Poll `source`, recording through `recorder` when there is one. A device
    /// whose recordings database cannot open still shows live state.
    #[must_use]
    pub fn new(source: S, recorder: Option<LiveRecorder>, handoff: H) -> Self {
        Self {
            source,
            recorder,
            handoff,
            latest: None,
        }
    }

    /// The newest snapshot, while a game is in progress and serving data.
    #[must_use]
    pub fn latest(&self) -> Option<&LiveSnapshot> {
        self.latest.as_ref()
    }

    /// The recorder, for reading recordings back.
    #[must_use]
    pub fn recorder(&self) -> Option<&LiveRecorder> {
        self.recorder.as_ref()
    }

    /// One poll, given the current gameflow phase.
    ///
    /// # Errors
    ///
    /// [`SessionError`]. A source failure leaves the previous snapshot in
    /// place; a recording failure still updates the snapshot.
    pub async fn tick(
        &mut self,
        phase: &GameflowPhase,
        now: DateTime<Utc>,
    ) -> Result<(), SessionError> {
        if !phase.is_in_progress() {
            self.latest = None;
            // A reconnect is the same game resuming, so it keeps its recording
            // open instead of splitting it in two.
            if *phase == GameflowPhase::Reconnect {
                return Ok(());
            }
            return self.finish(now);
        }
        self.latest = self.source.live_snapshot().await?;
        let (Some(snapshot), Some(recorder)) = (&self.latest, &mut self.recorder) else {
            return Ok(());
        };
        if let Some(finished) = recorder.observe(snapshot, now)? {
            self.handoff.finished(&finished, recorder.store_mut());
        }
        Ok(())
    }

    fn finish(&mut self, now: DateTime<Utc>) -> Result<(), SessionError> {
        if let Some(recorder) = &mut self.recorder
            && let Some(finished) = recorder.end_game(now)?
        {
            self.handoff.finished(&finished, recorder.store_mut());
        }
        Ok(())
    }
}

impl<S: LiveGameSource + LcuSource, H: RecordingHandoff> LiveGameSession<S, H> {
    /// One poll that asks `source` for the phase too, as a replay does.
    ///
    /// # Errors
    ///
    /// [`SessionError`], as [`LiveGameSession::tick`].
    pub async fn tick_from_source(&mut self, now: DateTime<Utc>) -> Result<(), SessionError> {
        let phase = self
            .source
            .gameflow_phase()
            .await?
            .unwrap_or(GameflowPhase::Disconnected);
        self.tick(&phase, now).await
    }

    /// The source, so a replay can be advanced.
    #[must_use]
    pub fn source(&self) -> &S {
        &self.source
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use chrono::{Duration, TimeZone, Utc};

    use super::LiveGameSession;
    use crate::live::gameflow::GameflowPhase;
    use crate::live::recording::{
        LiveRecorder, LocalOnly, RecordedGame, RecordingHandoff, RecordingStore,
    };
    use crate::live::snapshot::tests::fixture_snapshot;
    use crate::live::source::{ReplayFrame, ReplaySource};

    #[derive(Default)]
    struct Collecting(RefCell<Vec<RecordedGame>>);

    impl RecordingHandoff for &Collecting {
        fn finished(&self, recording: &RecordedGame, _store: &mut RecordingStore) {
            self.0.borrow_mut().push(recording.clone());
        }
    }

    fn frames() -> Result<Vec<ReplayFrame>, Box<dyn std::error::Error>> {
        let snapshot = fixture_snapshot()?;
        let live = |secs: u32| {
            let mut next = snapshot.clone();
            next.game.game_time_secs = secs;
            ReplayFrame {
                phase: GameflowPhase::InProgress,
                live: Some(next),
                champ_select: None,
            }
        };
        Ok(vec![
            ReplayFrame {
                phase: GameflowPhase::ChampSelect,
                live: None,
                champ_select: None,
            },
            live(10),
            live(12),
            live(14),
            live(16),
            ReplayFrame {
                phase: GameflowPhase::EndOfGame,
                live: None,
                champ_select: None,
            },
        ])
    }

    #[tokio::test]
    async fn a_replayed_session_polls_only_in_progress_and_hands_off_at_the_end()
    -> Result<(), Box<dyn std::error::Error>> {
        let handoff = Collecting::default();
        let recorder = LiveRecorder::new(RecordingStore::open_in_memory()?);
        let mut session =
            LiveGameSession::new(ReplaySource::new(frames()?), Some(recorder), &handoff);
        let now = Utc
            .with_ymd_and_hms(2026, 11, 14, 12, 0, 0)
            .single()
            .ok_or("time")?;
        let mut seen = Vec::new();
        for step in 0..6 {
            session
                .tick_from_source(now + Duration::seconds(2 * step))
                .await?;
            seen.push(session.latest().map(|s| s.game.game_time_secs));
            session.source().advance();
        }
        assert_eq!(seen, [None, Some(10), Some(12), Some(14), Some(16), None]);
        let finished = handoff.0.borrow();
        assert_eq!(finished.len(), 1);
        // First poll plus one 6-second interval; the 8-second mark is the last.
        assert_eq!(finished[0].samples, 2);
        Ok(())
    }

    #[tokio::test]
    async fn without_a_recorder_live_state_still_flows() -> Result<(), Box<dyn std::error::Error>> {
        let mut session = LiveGameSession::new(ReplaySource::new(frames()?), None, LocalOnly);
        session.source().advance();
        session.tick_from_source(Utc::now()).await?;
        assert!(session.latest().is_some());
        assert!(session.recorder().is_none());
        Ok(())
    }
}
