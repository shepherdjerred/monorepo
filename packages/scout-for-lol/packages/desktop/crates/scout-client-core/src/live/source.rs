//! Where live game state comes from.
//!
//! [`LiveGameSource`] and [`LcuSource`] are the two seams the rest of Scout
//! reads through. Production uses the real HTTP clients; tests and offline
//! development use [`ReplaySource`], which plays back a recorded session. Both
//! sources return allowlisted types, so raw Riot payloads stop at this file.

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};

use thiserror::Error;

use super::champ_select::{self, ChampSelectError, ChampSelectSnapshot};
use super::game_settings::{self, GameSettingsError, GameWindowMode};
use super::gameflow::{self, GameflowError, GameflowPhase};
use super::model::AllGameData;
use super::recording::{RecordingError, RecordingId, RecordingStore};
use super::snapshot::{LiveSnapshot, ProjectionError, project};
use crate::lcu::{LcuClient, LcuEndpoint, LcuError, LiveClient};

/// A failed read from a live source.
#[derive(Debug, Error)]
pub enum SourceError {
    /// The local request failed.
    #[error(transparent)]
    Transport(#[from] LcuError),
    /// The game returned JSON that is not `allgamedata`.
    #[error("the game's live data was malformed: {0}")]
    Malformed(String),
    /// The frame decoded but names an impossible roster.
    #[error(transparent)]
    Projection(#[from] ProjectionError),
    /// The gameflow resource was malformed.
    #[error(transparent)]
    Gameflow(#[from] GameflowError),
    /// The champion-select resource was malformed.
    #[error(transparent)]
    ChampSelect(#[from] ChampSelectError),
    /// The game settings did not state a known window mode.
    #[error(transparent)]
    GameSettings(#[from] GameSettingsError),
}

/// Reads the in-game state of the running match.
pub trait LiveGameSource {
    /// The newest allowlisted snapshot, or `None` while no game is serving
    /// live data (loading screen, no game, game closed).
    fn live_snapshot(
        &self,
    ) -> impl Future<Output = Result<Option<LiveSnapshot>, SourceError>> + Send;
}

/// Reads the League client's gameflow and champion select.
pub trait LcuSource {
    /// The gameflow phase, or `None` when the client has none to report.
    fn gameflow_phase(
        &self,
    ) -> impl Future<Output = Result<Option<GameflowPhase>, SourceError>> + Send;

    /// The champion-select projection, or `None` outside champion select.
    fn champ_select(
        &self,
    ) -> impl Future<Output = Result<Option<ChampSelectSnapshot>, SourceError>> + Send;

    /// The window mode the game will start in, or `None` when the client
    /// serves no game settings.
    fn game_window_mode(
        &self,
    ) -> impl Future<Output = Result<Option<GameWindowMode>, SourceError>> + Send;
}

impl LiveGameSource for LiveClient {
    async fn live_snapshot(&self) -> Result<Option<LiveSnapshot>, SourceError> {
        let Some(value) = self.all_game_data().await? else {
            return Ok(None);
        };
        let data: AllGameData = serde_json::from_value(value)
            .map_err(|error| SourceError::Malformed(error.to_string()))?;
        Ok(Some(project(&data)?))
    }
}

impl LcuSource for LcuClient {
    async fn gameflow_phase(&self) -> Result<Option<GameflowPhase>, SourceError> {
        match self.get(LcuEndpoint::GameflowPhase).await? {
            Some(value) => Ok(Some(gameflow::parse_phase(&value)?)),
            None => Ok(None),
        }
    }

    async fn champ_select(&self) -> Result<Option<ChampSelectSnapshot>, SourceError> {
        match self.get(LcuEndpoint::ChampSelect).await? {
            Some(value) => Ok(Some(champ_select::parse(&value)?)),
            None => Ok(None),
        }
    }

    async fn game_window_mode(&self) -> Result<Option<GameWindowMode>, SourceError> {
        match self.get(LcuEndpoint::GameSettings).await? {
            Some(value) => Ok(Some(game_settings::parse_window_mode(&value)?)),
            None => Ok(None),
        }
    }
}

/// One moment of a recorded session.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplayFrame {
    /// The gameflow phase at that moment.
    pub phase: GameflowPhase,
    /// What the game served, when it served anything.
    pub live: Option<LiveSnapshot>,
    /// What champion select showed, when it was open.
    pub champ_select: Option<ChampSelectSnapshot>,
}

/// Plays a recorded session back through both source traits.
///
/// Every read shows the current frame; [`ReplaySource::advance`] moves to the
/// next one. Past the last frame it reports a closed client: no phase and no
/// game.
pub struct ReplaySource {
    frames: Vec<ReplayFrame>,
    cursor: AtomicUsize,
    window_mode: Option<GameWindowMode>,
}

impl ReplaySource {
    /// Play `frames` in order.
    #[must_use]
    pub fn new(frames: Vec<ReplayFrame>) -> Self {
        Self {
            frames,
            cursor: AtomicUsize::new(0),
            window_mode: None,
        }
    }

    /// Serve `mode` as the game settings' window mode for the whole session;
    /// without it the replay serves no game settings.
    #[must_use]
    pub const fn with_window_mode(mut self, mode: GameWindowMode) -> Self {
        self.window_mode = Some(mode);
        self
    }

    /// Replay a game recorded on this device: one `InProgress` frame per
    /// sample, then an `EndOfGame` frame.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] when the recording cannot be read.
    pub fn from_recording(store: &RecordingStore, id: RecordingId) -> Result<Self, RecordingError> {
        let mut frames: Vec<ReplayFrame> = store
            .samples(id)?
            .into_iter()
            .map(|sample| ReplayFrame {
                phase: GameflowPhase::InProgress,
                live: Some(sample.snapshot),
                champ_select: None,
            })
            .collect();
        frames.push(ReplayFrame {
            phase: GameflowPhase::EndOfGame,
            live: None,
            champ_select: None,
        });
        Ok(Self::new(frames))
    }

    /// Move to the next frame. `false` once the recording has ended.
    pub fn advance(&self) -> bool {
        let next = self.cursor.fetch_add(1, Ordering::SeqCst).saturating_add(1);
        next < self.frames.len()
    }

    /// How many frames the session has.
    #[must_use]
    pub fn len(&self) -> usize {
        self.frames.len()
    }

    /// Whether the session has no frames.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    fn current(&self) -> Option<&ReplayFrame> {
        self.frames.get(self.cursor.load(Ordering::SeqCst))
    }
}

impl LiveGameSource for ReplaySource {
    fn live_snapshot(&self) -> impl Future<Output = Result<Option<LiveSnapshot>, SourceError>> {
        std::future::ready(Ok(self.current().and_then(|frame| frame.live.clone())))
    }
}

impl LcuSource for ReplaySource {
    fn gameflow_phase(&self) -> impl Future<Output = Result<Option<GameflowPhase>, SourceError>> {
        std::future::ready(Ok(self.current().map(|frame| frame.phase.clone())))
    }

    fn champ_select(
        &self,
    ) -> impl Future<Output = Result<Option<ChampSelectSnapshot>, SourceError>> {
        std::future::ready(Ok(self
            .current()
            .and_then(|frame| frame.champ_select.clone())))
    }

    fn game_window_mode(
        &self,
    ) -> impl Future<Output = Result<Option<GameWindowMode>, SourceError>> {
        std::future::ready(Ok(self.current().and(self.window_mode)))
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{LcuSource, LiveGameSource, ReplayFrame, ReplaySource, SourceError};
    use crate::lcu::{LcuError, LiveClient, LiveClientEndpoint};
    use crate::live::game_settings::GameWindowMode;
    use crate::live::gameflow::GameflowPhase;
    use crate::live::snapshot::tests::{FIXTURE, fixture_snapshot};

    /// Serve `status` and `body` to every request on a loopback port.
    async fn serve(status: &str, body: &'static str) -> Result<String, std::io::Error> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let status = status.to_owned();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request).await;
                let response = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });
        Ok(origin)
    }

    #[test]
    fn the_live_client_endpoint_is_one_fixed_path() {
        assert_eq!(
            LiveClientEndpoint::AllGameData.path(),
            "/liveclientdata/allgamedata"
        );
    }

    #[test]
    fn the_live_client_only_talks_to_loopback() {
        assert!(LiveClient::with_base_url("http://127.0.0.1:4000").is_ok());
        assert!(LiveClient::with_base_url("https://localhost:2999").is_ok());
        for remote in [
            "https://example.com",
            "http://192.168.1.5:2999",
            "file:///tmp/x",
            "not a url",
        ] {
            assert!(
                matches!(
                    LiveClient::with_base_url(remote),
                    Err(LcuError::NotLoopback)
                ),
                "{remote}"
            );
        }
    }

    #[tokio::test]
    async fn the_http_source_projects_a_served_frame() -> Result<(), Box<dyn std::error::Error>> {
        let origin = serve("200 OK", FIXTURE).await?;
        let client = LiveClient::with_base_url(&origin)?;
        assert_eq!(client.live_snapshot().await?, Some(fixture_snapshot()?));
        Ok(())
    }

    #[tokio::test]
    async fn no_game_is_not_an_error() -> Result<(), Box<dyn std::error::Error>> {
        let origin = serve("404 Not Found", "{}").await?;
        assert_eq!(
            LiveClient::with_base_url(&origin)?.live_snapshot().await?,
            None
        );
        // Nothing listens on port 1: the game is simply not running.
        assert_eq!(
            LiveClient::with_base_url("http://127.0.0.1:1")?
                .live_snapshot()
                .await?,
            None
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_served_frame_that_is_not_allgamedata_fails_loudly()
    -> Result<(), Box<dyn std::error::Error>> {
        let origin = serve("200 OK", "{\"activePlayer\": {}}").await?;
        let outcome = LiveClient::with_base_url(&origin)?.live_snapshot().await;
        assert!(matches!(outcome, Err(SourceError::Malformed(_))));
        Ok(())
    }

    #[tokio::test]
    async fn a_replay_walks_its_frames_then_reports_a_closed_client()
    -> Result<(), Box<dyn std::error::Error>> {
        let snapshot = fixture_snapshot()?;
        let replay = ReplaySource::new(vec![
            ReplayFrame {
                phase: GameflowPhase::InProgress,
                live: Some(snapshot.clone()),
                champ_select: None,
            },
            ReplayFrame {
                phase: GameflowPhase::EndOfGame,
                live: None,
                champ_select: None,
            },
        ]);
        assert_eq!(
            replay.gameflow_phase().await?,
            Some(GameflowPhase::InProgress)
        );
        assert_eq!(replay.live_snapshot().await?, Some(snapshot));
        assert!(replay.advance());
        assert_eq!(
            replay.gameflow_phase().await?,
            Some(GameflowPhase::EndOfGame)
        );
        assert_eq!(replay.live_snapshot().await?, None);
        assert!(!replay.advance());
        assert_eq!(replay.gameflow_phase().await?, None);
        assert_eq!(replay.champ_select().await?, None);
        assert_eq!(replay.game_window_mode().await?, None);
        Ok(())
    }

    #[tokio::test]
    async fn a_replay_serves_its_window_mode_until_the_client_closes()
    -> Result<(), Box<dyn std::error::Error>> {
        let replay = ReplaySource::new(vec![ReplayFrame {
            phase: GameflowPhase::ChampSelect,
            live: None,
            champ_select: None,
        }])
        .with_window_mode(GameWindowMode::Fullscreen);
        assert_eq!(
            replay.game_window_mode().await?,
            Some(GameWindowMode::Fullscreen)
        );
        assert!(!replay.advance());
        assert_eq!(replay.game_window_mode().await?, None);
        Ok(())
    }
}
