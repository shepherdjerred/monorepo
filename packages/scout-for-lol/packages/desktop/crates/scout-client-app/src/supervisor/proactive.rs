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
//! - one request per [`SPACING`], the server's own spacing;
//! - at most [`MAX_PER_GAME`] requests a game, the server's cap;
//! - each trigger (kind and evidence) asked once a game.
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

/// The least time between two requests, matching the server's spacing.
pub(super) const SPACING: Duration = Duration::from_secs(90);
/// The most requests one game makes, matching the server's cap.
pub(super) const MAX_PER_GAME: u8 = 10;

/// Watches one game's frames for what is worth a proactive turn.
#[derive(Debug, Default)]
pub(super) struct ProactiveDriver {
    game_key: Option<String>,
    previous: Option<LiveSnapshot>,
    state: DetectorState,
    last_asked: Option<Instant>,
    asked: Vec<CoachTrigger>,
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
            .find(|trigger| !self.asked.contains(trigger))?;
        self.asked.push(trigger.clone());
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
    use std::time::{Duration, Instant};

    use scout_client_core::desktop_api::CoachTrigger;
    use scout_client_core::live::detectors::ItemCatalog;
    use scout_client_core::live::model::AllGameData;
    use scout_client_core::live::snapshot::{LiveSnapshot, project};

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

    /// The next frame: the local player took part in a takedown (ending any
    /// streak), then died `deaths` more times without one, which is a new
    /// death streak each time.
    fn died(base: &LiveSnapshot, secs: u32, deaths: u32) -> LiveSnapshot {
        let mut next = base.clone();
        next.game.game_time_secs = secs;
        for player in &mut next.participants {
            if player.is_self {
                player.assists += 1;
                player.deaths += deaths;
            }
        }
        next
    }

    fn streak(turn: Option<&scout_explore_client::proactive::ProactiveTurn>) -> Option<u8> {
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
        let second = died(&first, 620, 3);
        let soon = start + SPACING.saturating_sub(Duration::from_secs(1));
        assert!(
            driver
                .observe(soon, false, "g-1", &second, &catalog)
                .is_none()
        );
        // Past the spacing, the next detection goes.
        let third = died(&second, 700, 3);
        let later = start + SPACING;
        assert!(
            streak(
                driver
                    .observe(later, false, "g-1", &third, &catalog)
                    .as_ref()
            )
            .is_some()
        );
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
        let again = died(&streaked, 620, 3);
        assert!(
            driver
                .observe(start, false, "g-1", &again, &catalog)
                .is_some()
        );
        Ok(())
    }

    #[test]
    fn the_same_trigger_is_asked_once_a_game() -> TestResult {
        let catalog = ItemCatalog::default();
        let start = Instant::now();
        let mut driver = ProactiveDriver::default();
        let base = frame(600)?;
        driver.observe(start, false, "g-1", &base, &catalog);
        let streaked = died(&base, 610, 3);
        assert!(
            driver
                .observe(start, false, "g-1", &streaked, &catalog)
                .is_some()
        );
        // The roster reorders (a broken frame resets the detectors), then
        // the very same streak shows up again: not asked twice.
        let later = start + SPACING * 2;
        let mut reset = base.clone();
        reset.participants.reverse();
        reset.game.game_time_secs = 620;
        driver.observe(later, false, "g-1", &reset, &catalog);
        driver.observe(later, false, "g-1", &base, &catalog);
        let mut same = streaked.clone();
        same.game.game_time_secs = 630;
        assert!(
            driver
                .observe(later, false, "g-1", &same, &catalog)
                .is_none()
        );
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
            current = died(&current, 600 + step * 10, 3);
            asked += usize::from(
                driver
                    .observe(now, false, "g-1", &current, &catalog)
                    .is_some(),
            );
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
