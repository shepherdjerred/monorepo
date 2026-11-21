//! The proactive coach in the supervisor. Beta profile only.
//!
//! Riot's published policy prohibits unprompted alerts from live game state,
//! so this module is compiled only into the beta release profile
//! (`cfg(scout_proactive_coach)`). A stable build has no code that feeds the
//! detectors or sends a trigger, and the server refuses `coach/triggers` in
//! production as well.
//!
//! While a game is `InProgress`, the supervisor hands each new allowlisted
//! frame to [`ProactiveDriver::observe`], which runs
//! [`scout_client_core::live::detectors::detect`] over it and the frame
//! before. When something fires, the driver returns at most one turn for the
//! chat relay to ask Scout for. The server is the authority on spacing, the
//! per-game cap and duplicates. The driver keeps its own copies of those
//! limits so it does not spam Scout:
//!
//! - one request per [`SPACING`]: the server's 90 seconds, measured from
//!   its own admission, plus [`LATENCY_MARGIN`], so a slow previous request
//!   and a fast next one never land inside the server's spacing (which Scout
//!   answers `rate_limited`, stopping proactive turns for the game);
//! - at most [`MAX_PER_GAME`] requests a game, the server's cap;
//! - each event asked once a game, identified as the server's dedupe
//!   receipts identify it: its kind and window
//!   ([`CoachTrigger::window_key`]). Scout answers a repeat `duplicate`,
//!   which stops proactive turns for the rest of the game.
//!
//! A detection that arrives while the player's own turn runs, inside the
//! spacing, or past the cap is dropped, not queued: by the time it could be
//! sent, the moment it describes has passed. The detectors' state still
//! advances with every frame.

use std::time::{Duration, Instant};

use scout_client_core::desktop_api::CoachTrigger;
use scout_client_core::live::detectors::{DetectorState, ItemCatalog, detect};
use scout_client_core::live::snapshot::LiveSnapshot;
use scout_explore_client::proactive::ProactiveTurn;

/// The server's spacing between admitted triggers.
const SERVER_SPACING: Duration = Duration::from_secs(90);
/// Slack for request latency: the server measures its spacing from when it
/// admitted the previous trigger, which can be later than when it was sent.
pub(super) const LATENCY_MARGIN: Duration = Duration::from_secs(15);
/// The least time between two requests.
pub(super) const SPACING: Duration = SERVER_SPACING.saturating_add(LATENCY_MARGIN);
/// The most requests one game makes, matching the server's cap.
pub(super) const MAX_PER_GAME: u8 = 10;

/// Watches one game's frames for what is worth a proactive turn.
#[derive(Debug, Default)]
pub(super) struct ProactiveDriver {
    game_key: Option<String>,
    previous: Option<LiveSnapshot>,
    state: DetectorState,
    last_asked: Option<Instant>,
    /// The events asked for this game, by kind and window.
    asked: Vec<(&'static str, String)>,
}

/// The event a trigger reports, as the server identifies it.
fn event(trigger: &CoachTrigger) -> (&'static str, String) {
    (trigger.kind(), trigger.window_key())
}

impl ProactiveDriver {
    /// One frame of the game `game_key`. `busy` is whether a turn is running
    /// that Scout cannot start another beside. Returns the turn to ask for,
    /// if any.
    pub(super) fn observe(
        &mut self,
        now: Instant,
        busy: bool,
        game_key: &str,
        frame: &LiveSnapshot,
        catalog: &ItemCatalog,
    ) -> Option<ProactiveTurn> {
        if self.game_key.as_deref() != Some(game_key) {
            *self = Self {
                game_key: Some(game_key.to_owned()),
                ..Self::default()
            };
        }
        let previous = self.previous.replace(frame.clone())?;
        if previous == *frame {
            return None;
        }
        let detection = detect(catalog, self.state, &previous, frame);
        self.state = detection.state;
        let spaced = self
            .last_asked
            .is_none_or(|at| now.saturating_duration_since(at) >= SPACING);
        let under_cap = self.asked.len() < usize::from(MAX_PER_GAME);
        if busy || !spaced || !under_cap {
            return None;
        }
        let trigger = detection
            .triggers
            .into_iter()
            .find(|trigger| !self.asked.contains(&event(trigger)))?;
        self.asked.push(event(&trigger));
        self.last_asked = Some(now);
        Some(ProactiveTurn {
            game_key: game_key.to_owned(),
            trigger,
            snapshot: frame.clone(),
        })
    }

    /// The game is over: forget it.
    pub(super) fn end_game(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use scout_client_core::desktop_api::CoachTrigger;
    use scout_client_core::live::detectors::ItemCatalog;
    use scout_client_core::live::model::AllGameData;
    use scout_client_core::live::snapshot::{LiveSnapshot, Team, project};
    use scout_explore_client::proactive::ProactiveTurn;

    use super::{MAX_PER_GAME, ProactiveDriver, SPACING};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn frame(secs: u32) -> Result<LiveSnapshot, Box<dyn std::error::Error>> {
        let data: AllGameData = serde_json::from_str(include_str!(
            "../../../scout-client-core/testdata/live/allgamedata.json"
        ))?;
        let mut snapshot = project(&data)?;
        snapshot.game.game_time_secs = secs;
        Ok(snapshot)
    }

    /// The next frame, `secs` into the game, with the local player changed.
    fn next(base: &LiveSnapshot, secs: u32, kills_assists: u32, deaths: u32) -> LiveSnapshot {
        let mut next = base.clone();
        next.game.game_time_secs = secs;
        for player in &mut next.participants {
            if player.is_self {
                player.assists += kills_assists;
                player.deaths += deaths;
            }
        }
        next
    }

    /// The next frame with the local player dead `deaths` more times.
    fn died(base: &LiveSnapshot, secs: u32, deaths: u32) -> LiveSnapshot {
        next(base, secs, 0, deaths)
    }

    /// A takedown, then three deaths without one: a new streak. Returns the
    /// last frame and what observing it asked for.
    fn new_streak(
        driver: &mut ProactiveDriver,
        now: Instant,
        busy: bool,
        base: &LiveSnapshot,
        secs: u32,
    ) -> (LiveSnapshot, Option<ProactiveTurn>) {
        let catalog = ItemCatalog::default();
        let after = next(base, secs, 1, 0);
        assert!(driver.observe(now, busy, "g-1", &after, &catalog).is_none());
        let streaked = died(&after, secs + 1, 3);
        let turn = driver.observe(now, busy, "g-1", &streaked, &catalog);
        (streaked, turn)
    }

    fn streak(turn: Option<&ProactiveTurn>) -> Option<u8> {
        match turn.map(|turn| &turn.trigger) {
            Some(CoachTrigger::DeathStreak {
                deaths_without_takedown,
                ..
            }) => Some(*deaths_without_takedown),
            _ => None,
        }
    }

    #[test]
    fn a_detection_asks_once_with_the_frame_it_fired_on() -> TestResult {
        let catalog = ItemCatalog::default();
        let start = Instant::now();
        let mut driver = ProactiveDriver::default();
        let base = frame(600)?;
        assert!(
            driver
                .observe(start, false, "g-1", &base, &catalog)
                .is_none(),
            "one frame has nothing to compare"
        );
        let streaked = died(&base, 660, 3);
        let turn = driver.observe(start, false, "g-1", &streaked, &catalog);
        assert_eq!(streak(turn.as_ref()), Some(3));
        let turn = turn.ok_or("turn")?;
        assert_eq!(turn.game_key, "g-1");
        assert_eq!(turn.snapshot, streaked);
        // The same frame again changes nothing.
        assert!(
            driver
                .observe(start, false, "g-1", &streaked, &catalog)
                .is_none()
        );
        Ok(())
    }

    #[test]
    fn requests_are_spaced_and_a_detection_inside_the_spacing_is_dropped() -> TestResult {
        let catalog = ItemCatalog::default();
        let start = Instant::now();
        let mut driver = ProactiveDriver::default();
        let base = frame(600)?;
        driver.observe(start, false, "g-1", &base, &catalog);
        let first = died(&base, 610, 3);
        assert!(
            driver
                .observe(start, false, "g-1", &first, &catalog)
                .is_some()
        );
        // Another streak fires inside the spacing: dropped.
        let soon = start + SPACING.saturating_sub(std::time::Duration::from_secs(1));
        let (second, dropped) = new_streak(&mut driver, soon, false, &first, 620);
        assert!(dropped.is_none());
        // Past the spacing, the next detection goes.
        let (_, asked) = new_streak(&mut driver, start + SPACING, false, &second, 700);
        assert_eq!(streak(asked.as_ref()), Some(3));
        Ok(())
    }

    #[test]
    fn a_detection_while_the_players_turn_runs_is_dropped_uncounted() -> TestResult {
        let catalog = ItemCatalog::default();
        let start = Instant::now();
        let mut driver = ProactiveDriver::default();
        let base = frame(600)?;
        driver.observe(start, false, "g-1", &base, &catalog);
        let streaked = died(&base, 610, 3);
        assert!(
            driver
                .observe(start, true, "g-1", &streaked, &catalog)
                .is_none()
        );
        // Not counted against the spacing: the next detection goes at once.
        let (_, asked) = new_streak(&mut driver, start, false, &streaked, 620);
        assert!(asked.is_some());
        Ok(())
    }

    #[test]
    fn the_same_event_is_asked_once_a_game_as_the_server_identifies_it() -> TestResult {
        let catalog = ItemCatalog::default();
        let mut now = Instant::now();
        let mut driver = ProactiveDriver::default();
        let base = frame(600)?;
        driver.observe(now, false, "g-1", &base, &catalog);
        // An enemy gets fed, cools off, and gets fed again with another
        // score: the server's event is the champion, so the second is a
        // duplicate it would answer by stopping the game. Never asked.
        let enemy = base
            .participants
            .iter()
            .position(|player| player.team == Team::Chaos)
            .ok_or("an enemy")?;
        let mut score = |frame: &LiveSnapshot, secs: u32, kills: u32, deaths: u32| {
            let mut next = frame.clone();
            next.game.game_time_secs = secs;
            next.participants[enemy].kills = kills;
            next.participants[enemy].deaths = deaths;
            now += SPACING;
            driver
                .observe(now, false, "g-1", &next, &catalog)
                .map(|turn| turn.trigger)
        };
        let calm = {
            let mut calm = base.clone();
            calm.participants[enemy].kills = 0;
            calm.participants[enemy].deaths = 0;
            calm
        };
        score(&base, 601, 0, 0);
        let fed = score(&calm, 610, 5, 0);
        assert!(matches!(fed, Some(CoachTrigger::EnemyFed { kills: 5, .. })));
        assert_eq!(score(&calm, 620, 5, 2), None, "no longer fed");
        assert_eq!(score(&calm, 630, 6, 2), None, "fed again: the same event");
        Ok(())
    }

    #[test]
    fn a_game_asks_at_most_its_cap_and_a_new_game_starts_over() -> TestResult {
        let catalog = ItemCatalog::default();
        let mut now = Instant::now();
        let mut driver = ProactiveDriver::default();
        let mut current = frame(600)?;
        driver.observe(now, false, "g-1", &current, &catalog);
        let mut asked = 0;
        for step in 1..=30_u32 {
            now += SPACING;
            let (last, turn) = new_streak(&mut driver, now, false, &current, 600 + step * 10);
            current = last;
            asked += usize::from(turn.is_some());
        }
        assert_eq!(asked, usize::from(MAX_PER_GAME));

        driver.end_game();
        let base = frame(30)?;
        driver.observe(now, false, "g-2", &base, &catalog);
        assert!(
            driver
                .observe(now, false, "g-2", &died(&base, 40, 3), &catalog)
                .is_some()
        );
        Ok(())
    }
}
