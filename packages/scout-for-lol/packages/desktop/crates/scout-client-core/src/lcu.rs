//! Authenticated access to the local League Client API.

use std::fs;
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use reqwest::{Client, StatusCode};
use serde_json::Value;
use thiserror::Error;

/// Parsed League lockfile. The password must never be logged or uploaded.
#[derive(Clone)]
pub struct LeagueLockfile {
    /// League process id.
    pub pid: u32,
    /// Authenticated loopback port.
    pub port: u16,
    password: String,
    protocol: String,
}

impl std::fmt::Debug for LeagueLockfile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LeagueLockfile")
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("protocol", &self.protocol)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

impl LeagueLockfile {
    /// Parse `name:pid:port:password:protocol` without ever exposing the password.
    ///
    /// # Errors
    ///
    /// Returns [`LcuError::InvalidLockfile`] when the lockfile is malformed or
    /// does not describe an HTTPS connection.
    pub fn parse(raw: &str) -> Result<Self, LcuError> {
        let fields: Vec<&str> = raw.trim().split(':').collect();
        if fields.len() != 5 {
            return Err(LcuError::InvalidLockfile);
        }
        let pid = fields[1].parse().map_err(|_| LcuError::InvalidLockfile)?;
        let port = fields[2].parse().map_err(|_| LcuError::InvalidLockfile)?;
        let password = fields[3].to_owned();
        let protocol = fields[4].to_owned();
        if password.is_empty() || protocol != "https" {
            return Err(LcuError::InvalidLockfile);
        }
        Ok(Self {
            pid,
            port,
            password,
            protocol,
        })
    }

    fn authorization(&self) -> String {
        let encoded =
            base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", self.password));
        format!("Basic {encoded}")
    }
}

/// Locate and parse the League lockfile on supported desktop platforms.
///
/// # Errors
///
/// Returns [`LcuError::NotRunning`] when no supported installation is active,
/// or a typed read/parse failure when a lockfile exists but is unusable.
pub fn discover_lockfile() -> Result<(PathBuf, LeagueLockfile), LcuError> {
    for candidate in lockfile_candidates() {
        if !candidate.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&candidate).map_err(LcuError::ReadLockfile)?;
        return Ok((candidate, LeagueLockfile::parse(&raw)?));
    }
    Err(LcuError::NotRunning)
}

fn lockfile_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    let mut candidates = vec![PathBuf::from(
        "/Applications/League of Legends.app/Contents/LoL/lockfile",
    )];
    #[cfg(target_os = "windows")]
    let mut candidates = vec![
        PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"),
        PathBuf::from(r"C:\Program Files\Riot Games\League of Legends\lockfile"),
    ];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let candidates = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(install) = install_path_from_metadata(Path::new(
        "/Users/Shared/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml",
    )) {
        candidates.insert(0, install.join("Contents/LoL/lockfile"));
    }
    #[cfg(target_os = "windows")]
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let metadata = PathBuf::from(program_data)
            .join("Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml");
        if let Some(install) = install_path_from_metadata(&metadata) {
            candidates.insert(0, install.join("lockfile"));
        }
    }
    candidates
}

#[cfg(any(test, target_os = "macos", target_os = "windows"))]
fn install_path_from_metadata(metadata: &Path) -> Option<PathBuf> {
    let contents = fs::read_to_string(metadata).ok()?;
    let raw = contents.lines().find_map(|line| {
        line.strip_prefix("product_install_full_path:")
            .map(str::trim)
    })?;
    let decoded = if raw.starts_with('"') {
        serde_json::from_str::<String>(raw).ok()?
    } else {
        raw.to_owned()
    };
    (!decoded.is_empty()).then(|| PathBuf::from(decoded))
}

/// Read-only LCU adapter restricted to a curated endpoint allowlist.
#[derive(Clone)]
pub struct LcuClient {
    http: Client,
    base_url: String,
    authorization: String,
}

/// Read-only adapter for League's fixed-port Live Client Data API.
///
/// This surface is intentionally separate from [`LcuClient`]: it is exposed by
/// the running game rather than the League Client, has no lockfile credential,
/// and is reachable only on Riot's documented loopback port.
#[derive(Clone)]
pub struct LiveClient {
    http: Client,
}

impl LiveClient {
    /// Construct the bounded loopback-only Live Client adapter.
    ///
    /// # Errors
    ///
    /// Returns [`LcuError::BuildClient`] when the local HTTP client cannot be
    /// constructed.
    pub fn new() -> Result<Self, LcuError> {
        let http = Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_millis(500))
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(LcuError::BuildClient)?;
        Ok(Self { http })
    }

    /// Read one complete in-game frame when the game process is serving it.
    ///
    /// Connection failures and 404s mean there is no active game and are not
    /// operational errors. No caller-controlled address or path is accepted.
    ///
    /// # Errors
    ///
    /// Returns a typed failure for an unexpected HTTP response or malformed
    /// JSON returned by an active game.
    pub async fn all_game_data(&self) -> Result<Option<Value>, LcuError> {
        let response = match self
            .http
            .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) if error.is_connect() || error.is_timeout() => return Ok(None),
            Err(error) => return Err(LcuError::Request(error)),
        };
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(LcuError::Status(response.status()));
        }
        response.json().await.map(Some).map_err(LcuError::Request)
    }
}

impl LcuClient {
    /// Connect to a lockfile-derived loopback endpoint.
    ///
    /// # Errors
    ///
    /// Returns [`LcuError::BuildClient`] if the bounded local HTTP client
    /// cannot be constructed.
    pub fn new(lockfile: &LeagueLockfile) -> Result<Self, LcuError> {
        let http = Client::builder()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(LcuError::BuildClient)?;
        Ok(Self {
            http,
            base_url: format!(
                "https://{}:{}",
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                lockfile.port
            ),
            authorization: lockfile.authorization(),
        })
    }

    /// Read one allowlisted LCU resource. A 404 means the phase/resource is absent.
    ///
    /// # Errors
    ///
    /// Returns a typed request or HTTP status failure. Caller-controlled URLs
    /// are not accepted.
    pub async fn get(&self, endpoint: LcuEndpoint) -> Result<Option<Value>, LcuError> {
        let response = self
            .http
            .get(format!("{}{}", self.base_url, endpoint.path()))
            .header("Authorization", &self.authorization)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(LcuError::Request)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(LcuError::Status(response.status()));
        }
        response.json().await.map(Some).map_err(LcuError::Request)
    }
}

/// Curated read-only LCU resources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LcuEndpoint {
    /// Current summoner.
    CurrentSummoner,
    /// Current gameflow phase.
    GameflowPhase,
    /// Current gameflow session.
    GameflowSession,
    /// Current lobby.
    Lobby,
    /// Current champion select.
    ChampSelect,
    /// Current end-of-game block.
    EndOfGame,
    /// Game-client end-of-game block used while the richer summary catches up.
    GameClientEndOfGame,
    /// Local player mastery list.
    ChampionMastery,
    /// Local player's mastery milestone sets and rewards.
    ChampionMasteryMilestones,
    /// Challenge details.
    Challenges,
    /// Challenge summary.
    ChallengeSummary,
    /// Clash player state.
    ClashPlayer,
    /// Clash tournaments.
    ClashTournaments,
    /// Clash tournament summary.
    ClashSummary,
    /// Whether the local player can check in for Clash.
    ClashCheckinAllowed,
    /// Current Clash tournament identifiers.
    ClashCurrentTournamentIds,
    /// Historical Clash brackets and winners.
    ClashHistoryAndWinners,
    /// Local player's Clash history.
    ClashPlayerHistory,
    /// Current Clash rewards.
    ClashRewards,
    /// Clash registration and client state flags.
    ClashStateFlags,
    /// Current Clash tournament state.
    ClashTournamentState,
    /// Rosters that invited the local player.
    ClashInvitedRosters,
    /// Replay configuration.
    ReplayConfiguration,
    /// Replay directory path.
    ReplayPath,
    /// Recent games for the current local summoner.
    MatchHistoryRecent,
}

impl LcuEndpoint {
    /// Static endpoint path. No caller-controlled path segment is accepted.
    #[must_use]
    pub const fn path(self) -> &'static str {
        match self {
            Self::CurrentSummoner => "/lol-summoner/v1/current-summoner",
            Self::GameflowPhase => "/lol-gameflow/v1/gameflow-phase",
            Self::GameflowSession => "/lol-gameflow/v1/session",
            Self::Lobby => "/lol-lobby/v2/lobby",
            Self::ChampSelect => "/lol-champ-select/v1/session",
            Self::EndOfGame => "/lol-end-of-game/v1/eog-stats-block",
            Self::GameClientEndOfGame => "/lol-end-of-game/v1/gameclient-eog-stats-block",
            Self::ChampionMastery => "/lol-champion-mastery/v1/local-player/champion-mastery",
            Self::ChampionMasteryMilestones => {
                "/lol-champion-mastery/v1/local-player/champion-mastery-sets-and-rewards"
            }
            Self::Challenges => "/lol-challenges/v1/challenges/local-player",
            Self::ChallengeSummary => "/lol-challenges/v1/summary-player-data/local-player",
            Self::ClashPlayer => "/lol-clash/v1/player",
            Self::ClashTournaments => "/lol-clash/v1/all-tournaments",
            Self::ClashSummary => "/lol-clash/v1/tournament-summary",
            Self::ClashCheckinAllowed => "/lol-clash/v1/checkin-allowed",
            Self::ClashCurrentTournamentIds => "/lol-clash/v1/current-tournament-ids",
            Self::ClashHistoryAndWinners => "/lol-clash/v1/historyandwinners",
            Self::ClashPlayerHistory => "/lol-clash/v1/player-history",
            Self::ClashRewards => "/lol-clash/v1/rewards",
            Self::ClashStateFlags => "/lol-clash/v1/simple-state-flags",
            Self::ClashTournamentState => "/lol-clash/v1/tournament-state-info",
            Self::ClashInvitedRosters => "/lol-clash/v1/invited-roster-ids",
            Self::ReplayConfiguration => "/lol-replays/v1/configuration",
            Self::ReplayPath => "/lol-replays/v1/rofls/path",
            Self::MatchHistoryRecent => {
                "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20"
            }
        }
    }
}

/// LCU discovery or request failure.
#[derive(Debug, Error)]
pub enum LcuError {
    /// No known lockfile exists.
    #[error("League is not running")]
    NotRunning,
    /// Lockfile could not be read.
    #[error("could not read League lockfile: {0}")]
    ReadLockfile(std::io::Error),
    /// Lockfile structure was invalid.
    #[error("League lockfile is invalid")]
    InvalidLockfile,
    /// HTTP client construction failed.
    #[error("could not build local League client: {0}")]
    BuildClient(reqwest::Error),
    /// LCU request failed.
    #[error("local League request failed: {0}")]
    Request(reqwest::Error),
    /// LCU returned a non-success response.
    #[error("local League request returned {0}")]
    Status(StatusCode),
}

/// Confirm a lockfile path is a regular file before any request is attempted.
#[must_use]
pub fn is_lockfile(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some("lockfile") && path.is_file()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{LeagueLockfile, install_path_from_metadata};

    #[test]
    fn parses_lockfile_without_exposing_password() -> Result<(), Box<dyn std::error::Error>> {
        let lockfile = LeagueLockfile::parse("LeagueClient:123:4567:secret:https")?;
        assert_eq!(lockfile.pid, 123);
        assert_eq!(lockfile.port, 4567);
        assert!(!format!("{lockfile:?}").contains("secret"));
        Ok(())
    }

    #[test]
    fn authorizes_as_riot_basic_credentials() -> Result<(), Box<dyn std::error::Error>> {
        let lockfile = LeagueLockfile::parse("LeagueClient:123:4567:secret:https")?;
        assert_eq!(lockfile.authorization(), "Basic cmlvdDpzZWNyZXQ=");
        Ok(())
    }

    #[test]
    fn rejects_non_https_lockfile() {
        assert!(LeagueLockfile::parse("LeagueClient:123:4567:secret:http").is_err());
    }

    #[test]
    fn discovers_custom_install_path_from_riot_metadata() -> Result<(), Box<dyn std::error::Error>>
    {
        let path = std::env::temp_dir().join(format!("scout-riot-{}.yaml", Uuid::new_v4()));
        fs::write(
            &path,
            "product_install_full_path: \"D:\\\\Games\\\\League of Legends\"\n",
        )?;
        assert_eq!(
            install_path_from_metadata(&path),
            Some(std::path::PathBuf::from(r"D:\Games\League of Legends")),
        );
        fs::remove_file(path)?;
        Ok(())
    }
}
