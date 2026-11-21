//! When the supervisor's coach asks Scout for help on its own.
//!
//! Two moments, both inside what Riot's policy approves before a game:
//! champion-select advice when a pick or ban changes, and the plan when a game
//! begins. This is pure state: the supervisor feeds it the gameflow phase and
//! what the League client showed on each tick, and relays what it returns.
//! Neither turn carries live state; the planner holds the per-select and
//! per-game counts the server also enforces (4 and 1).
//!
//! A turn the player's own question is in the way of is not asked and not
//! counted: the planner only hears of a turn at the moment it can be sent. The
//! select that held still stays waiting, so the newest screen goes once the
//! player's turn ends; a game's plan goes then too, if the game is still
//! inside its start window.
//!
//! The beta profile adds a third moment, Scout's own: the proactive driver
//! ([`super::proactive`]) watches the game's frames and asks for a turn when
//! the scoreboard changes in a way worth a note. It shares the game's key with
//! the plan. A stable build does not compile it.

use std::time::{Duration, Instant};

use scout_client_core::coach_context::{ChampSelectContext, GameContext};
use scout_client_core::live::champ_select::ChampSelectSnapshot;
use scout_client_core::live::snapshot::LiveSnapshot;
use scout_client_runtime::runtime::GameflowPhase;
use scout_explore_client::app_turns::{AppTurnPlanner, CoachInput};
use uuid::Uuid;

/// How long the select must hold still before advice is asked for: a player
/// hovering through champions is not a pick.
pub(super) const DEBOUNCE: Duration = Duration::from_secs(3);
/// How far into a game its plan is still the plan. A game already under way
/// when Scout starts (an update, a restart) gets none.
pub(super) const PLAN_WINDOW_SECS: u32 = 120;

/// A key the server counts a select or a game's turns by.
fn key(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

struct Watch {
    key: String,
    /// The screen as last seen, and when it last changed.
    observed: Option<ChampSelectContext>,
    since: Instant,
    /// Whether the screen that has held still has been offered to the planner.
    offered: bool,
}

/// Decides, tick by tick, what the coach asks for.
pub(super) struct CoachDriver {
    planner: AppTurnPlanner,
    debounce: Duration,
    watch: Option<Watch>,
    game_key: Option<String>,
    showing: bool,
    #[cfg(scout_proactive_coach)]
    proactive: super::proactive::ProactiveDriver,
}

impl CoachDriver {
    pub(super) fn new(debounce: Duration) -> Self {
        Self {
            planner: AppTurnPlanner::new(),
            debounce,
            watch: None,
            game_key: None,
            showing: false,
            #[cfg(scout_proactive_coach)]
            proactive: super::proactive::ProactiveDriver::default(),
        }
    }

    /// One look at the League client. `busy` is whether a turn of the
    /// player's (typed or spoken) is running, which Scout cannot start another
    /// beside. Returns what to hand the chat relay, in order.
    pub(super) fn tick(
        &mut self,
        now: Instant,
        busy: bool,
        phase: &GameflowPhase,
        select: Option<&ChampSelectSnapshot>,
        live: Option<&LiveSnapshot>,
    ) -> Vec<CoachInput> {
        let mut out = Vec::new();
        let selecting = *phase == GameflowPhase::ChampSelect;
        let playing = matches!(
            phase,
            GameflowPhase::GameStart | GameflowPhase::InProgress | GameflowPhase::Reconnect
        );
        // The panel stays up from the start of a select to the end of the
        // game, and goes when that is over.
        if self.showing && !(selecting || playing) {
            out.push(CoachInput::Clear);
        }
        self.showing = selecting || playing;
        if !selecting {
            self.watch = None;
        }
        if !playing {
            self.game_key = None;
            #[cfg(scout_proactive_coach)]
            self.proactive.end_game();
        }
        if selecting {
            out.extend(self.select_turn(now, busy, select));
        }
        if *phase == GameflowPhase::InProgress {
            out.extend(self.plan_turn(busy, live));
        }
        out
    }

    /// One look at the game for the proactive coach. Beta profile only.
    /// Runs while the game is `InProgress` and its plan has a key, with the
    /// item facts Scout's Data Dragon version names.
    #[cfg(scout_proactive_coach)]
    pub(super) fn proactive_tick(
        &mut self,
        now: Instant,
        busy: bool,
        phase: &GameflowPhase,
        live: Option<&LiveSnapshot>,
        catalog: &scout_client_core::live::detectors::ItemCatalog,
    ) -> Option<CoachInput> {
        if *phase != GameflowPhase::InProgress {
            return None;
        }
        let key = self.game_key.as_deref()?;
        self.proactive
            .observe(now, busy, key, live?, catalog)
            .map(|turn| CoachInput::Trigger(Box::new(turn)))
    }

    fn select_turn(
        &mut self,
        now: Instant,
        busy: bool,
        select: Option<&ChampSelectSnapshot>,
    ) -> Option<CoachInput> {
        let watch = self.watch.get_or_insert_with(|| Watch {
            key: key("cs"),
            observed: None,
            since: now,
            offered: true,
        });
        // A screen that breaks the contract is not asked about: Scout would
        // refuse it, and the next frame may be whole.
        let screen = select
            .and_then(|snapshot| GameContext::champ_select(snapshot).ok())
            .and_then(|context| context.champ_select)?;
        if watch.observed.as_ref() != Some(&screen) {
            watch.observed = Some(screen);
            watch.since = now;
            watch.offered = false;
            return None;
        }
        // Blocked, the screen stays unoffered: the planner has not counted it,
        // and the latest one goes when the player's turn is over.
        if watch.offered || busy || now.duration_since(watch.since) < self.debounce {
            return None;
        }
        watch.offered = true;
        self.planner
            .champ_select(&watch.key, &screen)
            .map(|turn| CoachInput::Turn(Box::new(turn)))
    }

    fn plan_turn(&mut self, busy: bool, live: Option<&LiveSnapshot>) -> Option<CoachInput> {
        let key = self.game_key.get_or_insert_with(|| key("g")).clone();
        let snapshot = live.filter(|snapshot| snapshot.game.game_time_secs <= PLAN_WINDOW_SECS)?;
        // Asked again on each look until it can be sent, while the game is
        // still inside the window; past it, it is dropped uncounted.
        if busy {
            return None;
        }
        let pregame = GameContext::pregame(snapshot).ok()?.pregame?;
        self.planner
            .in_progress(&key, &pregame)
            .map(|turn| CoachInput::Turn(Box::new(turn)))
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use scout_client_core::desktop_api::AppInitiation;
    use scout_client_core::live::champ_select::{AllySlot, ChampSelectSnapshot, EnemySlot};
    use scout_client_core::live::model::AllGameData;
    use scout_client_core::live::snapshot::{LiveSnapshot, project};
    use scout_client_runtime::runtime::GameflowPhase;
    use scout_explore_client::app_turns::CoachInput;

    use super::{CoachDriver, DEBOUNCE, PLAN_WINDOW_SECS};

    fn select(mine: i64, theirs: i64) -> ChampSelectSnapshot {
        ChampSelectSnapshot {
            phase: Some("BAN_PICK".to_owned()),
            local_cell_id: 0,
            my_team: vec![AllySlot {
                cell_id: 0,
                champion_id: mine,
                assigned_position: None,
            }],
            their_team: vec![EnemySlot {
                cell_id: 5,
                champion_id: theirs,
            }],
            my_bans: Vec::new(),
            their_bans: Vec::new(),
        }
    }

    fn game(secs: u32) -> Result<LiveSnapshot, Box<dyn std::error::Error>> {
        let data: AllGameData = serde_json::from_str(include_str!(
            "../../../scout-client-core/testdata/live/allgamedata.json"
        ))?;
        let mut snapshot = project(&data)?;
        snapshot.game.game_time_secs = secs;
        Ok(snapshot)
    }

    fn initiation(input: &CoachInput) -> Option<AppInitiation> {
        match input {
            CoachInput::Turn(turn) => Some(turn.initiation),
            CoachInput::Clear => None,
            #[cfg(scout_proactive_coach)]
            CoachInput::Trigger(_) => None,
        }
    }

    #[test]
    fn advice_waits_for_the_select_to_hold_still_and_is_asked_once() {
        let start = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        let phase = GameflowPhase::ChampSelect;
        let at = |secs| start + Duration::from_secs(secs);
        assert_eq!(
            driver.tick(at(0), false, &phase, Some(&select(64, 0)), None),
            []
        );
        // The player hovers: each change restarts the wait.
        assert_eq!(
            driver.tick(at(2), false, &phase, Some(&select(103, 0)), None),
            []
        );
        assert_eq!(
            driver.tick(at(4), false, &phase, Some(&select(103, 0)), None),
            []
        );
        let asked = driver.tick(at(5), false, &phase, Some(&select(103, 0)), None);
        assert_eq!(
            asked.first().and_then(initiation),
            Some(AppInitiation::AppChampSelect)
        );
        assert_eq!(
            driver.tick(at(9), false, &phase, Some(&select(103, 0)), None),
            []
        );
    }

    #[test]
    fn a_select_gets_at_most_four_turns() {
        let start = Instant::now();
        let mut driver = CoachDriver::new(Duration::ZERO);
        let phase = GameflowPhase::ChampSelect;
        let mut asked = 0;
        for pick in 1..=12_i64 {
            let now = start + Duration::from_secs(u64::try_from(pick).unwrap_or(0) * 10);
            // One tick sees the change, the next is past the (zero) wait.
            for _ in 0..2 {
                asked += driver
                    .tick(now, false, &phase, Some(&select(pick, 64)), None)
                    .iter()
                    .filter(|input| initiation(input).is_some())
                    .count();
            }
        }
        assert_eq!(asked, 4);
    }

    #[test]
    fn the_plan_is_asked_once_at_the_start_of_a_game_and_never_late()
    -> Result<(), Box<dyn std::error::Error>> {
        let now = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        // Loading: no frame yet, so nothing to plan from.
        assert_eq!(
            driver.tick(now, false, &GameflowPhase::InProgress, None, None),
            []
        );
        let planned = driver.tick(
            now,
            false,
            &GameflowPhase::InProgress,
            None,
            Some(&game(5)?),
        );
        assert_eq!(
            planned.first().and_then(initiation),
            Some(AppInitiation::AppPregame)
        );
        if let Some(CoachInput::Turn(turn)) = planned.first() {
            assert!(turn.context.live.is_none(), "never live state");
        }
        assert_eq!(
            driver.tick(
                now,
                false,
                &GameflowPhase::InProgress,
                None,
                Some(&game(9)?)
            ),
            []
        );

        // A game already well under way when Scout starts gets no plan.
        let mut late = CoachDriver::new(DEBOUNCE);
        assert_eq!(
            late.tick(
                now,
                false,
                &GameflowPhase::InProgress,
                None,
                Some(&game(PLAN_WINDOW_SECS + 1)?)
            ),
            []
        );
        Ok(())
    }

    #[test]
    fn the_panel_comes_down_when_the_game_is_over_and_the_next_game_plans_again()
    -> Result<(), Box<dyn std::error::Error>> {
        let now = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        assert_eq!(
            driver
                .tick(
                    now,
                    false,
                    &GameflowPhase::InProgress,
                    None,
                    Some(&game(5)?)
                )
                .len(),
            1
        );
        assert_eq!(
            driver.tick(now, false, &GameflowPhase::Reconnect, None, None),
            []
        );
        assert_eq!(
            driver.tick(now, false, &GameflowPhase::EndOfGame, None, None),
            [CoachInput::Clear]
        );
        assert_eq!(
            driver.tick(now, false, &GameflowPhase::None, None, None),
            []
        );
        let again = driver.tick(
            now,
            false,
            &GameflowPhase::InProgress,
            None,
            Some(&game(5)?),
        );
        assert_eq!(
            again.first().and_then(initiation),
            Some(AppInitiation::AppPregame)
        );
        Ok(())
    }

    #[test]
    fn a_screen_that_breaks_the_contract_is_not_asked_about() {
        let now = Instant::now();
        let mut driver = CoachDriver::new(Duration::ZERO);
        let mut broken = select(64, 0);
        broken.local_cell_id = -1;
        for _ in 0..3 {
            assert_eq!(
                driver.tick(now, false, &GameflowPhase::ChampSelect, Some(&broken), None),
                []
            );
        }
    }
    fn picked(inputs: &[CoachInput]) -> Vec<u32> {
        inputs
            .iter()
            .filter_map(|input| match input {
                CoachInput::Turn(turn) => turn.context.champ_select.as_ref(),
                CoachInput::Clear => None,
                #[cfg(scout_proactive_coach)]
                CoachInput::Trigger(_) => None,
            })
            .flat_map(|screen| screen.my_team.iter().map(|slot| slot.champion_id))
            .collect()
    }

    #[test]
    fn a_select_turn_blocked_by_the_players_turn_costs_no_budget_and_goes_after_it_coalesced() {
        let start = Instant::now();
        let mut driver = CoachDriver::new(Duration::ZERO);
        let phase = GameflowPhase::ChampSelect;
        let at = |secs| start + Duration::from_secs(secs);
        // The first pick is asked for.
        driver.tick(at(0), false, &phase, Some(&select(1, 64)), None);
        let first = driver.tick(at(1), false, &phase, Some(&select(1, 64)), None);
        assert_eq!(picked(&first), [1]);
        // Five more picks pass while the player's own turn runs: none is
        // sent, none is counted.
        for pick in 2..=6_i64 {
            for step in 0..2 {
                let now = at(10 + u64::try_from(pick).unwrap_or(0) * 2 + step);
                assert_eq!(
                    driver.tick(now, true, &phase, Some(&select(pick, 64)), None),
                    []
                );
            }
        }
        // The player's turn ends: only the newest screen is sent, once.
        let after = driver.tick(at(40), false, &phase, Some(&select(6, 64)), None);
        assert_eq!(picked(&after), [6]);
        assert_eq!(
            driver.tick(at(41), false, &phase, Some(&select(6, 64)), None),
            []
        );
        // The select still has the rest of its four: the deferred ones were
        // never counted.
        let mut later = 0;
        for pick in 7..=12_i64 {
            let now = at(50 + u64::try_from(pick).unwrap_or(0) * 2);
            for _ in 0..2 {
                later += driver
                    .tick(now, false, &phase, Some(&select(pick, 64)), None)
                    .len();
            }
        }
        assert_eq!(later, 2, "four sent in all: one, the deferred, and two");
    }

    #[test]
    fn a_screen_that_changes_back_while_blocked_is_not_asked_again() {
        let start = Instant::now();
        let mut driver = CoachDriver::new(Duration::ZERO);
        let phase = GameflowPhase::ChampSelect;
        let at = |secs| start + Duration::from_secs(secs);
        driver.tick(at(0), false, &phase, Some(&select(1, 64)), None);
        assert_eq!(
            picked(&driver.tick(at(1), false, &phase, Some(&select(1, 64)), None)),
            [1]
        );
        driver.tick(at(2), true, &phase, Some(&select(2, 64)), None);
        driver.tick(at(3), true, &phase, Some(&select(1, 64)), None);
        driver.tick(at(4), true, &phase, Some(&select(1, 64)), None);
        assert_eq!(
            driver.tick(at(5), false, &phase, Some(&select(1, 64)), None),
            []
        );
    }

    #[test]
    fn the_plan_blocked_by_the_players_turn_goes_after_it_within_the_window()
    -> Result<(), Box<dyn std::error::Error>> {
        let now = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        let phase = GameflowPhase::InProgress;
        assert_eq!(driver.tick(now, true, &phase, None, Some(&game(5)?)), []);
        assert_eq!(driver.tick(now, true, &phase, None, Some(&game(30)?)), []);
        let planned = driver.tick(now, false, &phase, None, Some(&game(40)?));
        assert_eq!(
            planned.first().and_then(initiation),
            Some(AppInitiation::AppPregame)
        );
        assert_eq!(driver.tick(now, false, &phase, None, Some(&game(45)?)), []);
        Ok(())
    }

    #[test]
    fn the_plan_blocked_past_the_window_is_dropped_without_counting()
    -> Result<(), Box<dyn std::error::Error>> {
        let now = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        let phase = GameflowPhase::InProgress;
        assert_eq!(driver.tick(now, true, &phase, None, Some(&game(5)?)), []);
        let late = game(PLAN_WINDOW_SECS + 1)?;
        assert_eq!(driver.tick(now, false, &phase, None, Some(&late)), []);
        // The count is untouched: a new game under the same driver plans.
        assert_eq!(
            driver.tick(now, false, &GameflowPhase::None, None, None),
            [CoachInput::Clear]
        );
        let next = driver.tick(now, false, &phase, None, Some(&game(5)?));
        assert_eq!(
            next.first().and_then(initiation),
            Some(AppInitiation::AppPregame)
        );
        Ok(())
    }
}
