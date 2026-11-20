//! When the supervisor's coach asks Scout for help on its own.
//!
//! Two moments, both inside what Riot's policy approves before a game:
//! champion-select advice when a pick or ban changes, and the plan when a game
//! begins. This is pure state: the supervisor feeds it the gameflow phase and
//! what the League client showed on each tick, and relays what it returns.
//! Neither turn carries live state; the planner holds the per-select and
//! per-game counts the server also enforces (4 and 1).

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
}

impl CoachDriver {
    pub(super) fn new(debounce: Duration) -> Self {
        Self {
            planner: AppTurnPlanner::new(),
            debounce,
            watch: None,
            game_key: None,
            showing: false,
        }
    }

    /// One look at the League client. Returns what to hand the chat relay, in
    /// order.
    pub(super) fn tick(
        &mut self,
        now: Instant,
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
        }
        if selecting {
            out.extend(self.select_turn(now, select));
        }
        if *phase == GameflowPhase::InProgress {
            out.extend(self.plan_turn(live));
        }
        out
    }

    fn select_turn(
        &mut self,
        now: Instant,
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
        if watch.offered || now.duration_since(watch.since) < self.debounce {
            return None;
        }
        watch.offered = true;
        self.planner
            .champ_select(&watch.key, &screen)
            .map(|turn| CoachInput::Turn(Box::new(turn)))
    }

    fn plan_turn(&mut self, live: Option<&LiveSnapshot>) -> Option<CoachInput> {
        let key = self.game_key.get_or_insert_with(|| key("g")).clone();
        let snapshot = live.filter(|snapshot| snapshot.game.game_time_secs <= PLAN_WINDOW_SECS)?;
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
        }
    }

    #[test]
    fn advice_waits_for_the_select_to_hold_still_and_is_asked_once() {
        let start = Instant::now();
        let mut driver = CoachDriver::new(DEBOUNCE);
        let phase = GameflowPhase::ChampSelect;
        let at = |secs| start + Duration::from_secs(secs);
        assert_eq!(driver.tick(at(0), &phase, Some(&select(64, 0)), None), []);
        // The player hovers: each change restarts the wait.
        assert_eq!(driver.tick(at(2), &phase, Some(&select(103, 0)), None), []);
        assert_eq!(driver.tick(at(4), &phase, Some(&select(103, 0)), None), []);
        let asked = driver.tick(at(5), &phase, Some(&select(103, 0)), None);
        assert_eq!(
            asked.first().and_then(initiation),
            Some(AppInitiation::AppChampSelect)
        );
        assert_eq!(driver.tick(at(9), &phase, Some(&select(103, 0)), None), []);
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
                    .tick(now, &phase, Some(&select(pick, 64)), None)
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
        assert_eq!(driver.tick(now, &GameflowPhase::InProgress, None, None), []);
        let planned = driver.tick(now, &GameflowPhase::InProgress, None, Some(&game(5)?));
        assert_eq!(
            planned.first().and_then(initiation),
            Some(AppInitiation::AppPregame)
        );
        if let Some(CoachInput::Turn(turn)) = planned.first() {
            assert!(turn.context.live.is_none(), "never live state");
        }
        assert_eq!(
            driver.tick(now, &GameflowPhase::InProgress, None, Some(&game(9)?)),
            []
        );

        // A game already well under way when Scout starts gets no plan.
        let mut late = CoachDriver::new(DEBOUNCE);
        assert_eq!(
            late.tick(
                now,
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
                .tick(now, &GameflowPhase::InProgress, None, Some(&game(5)?))
                .len(),
            1
        );
        assert_eq!(driver.tick(now, &GameflowPhase::Reconnect, None, None), []);
        assert_eq!(
            driver.tick(now, &GameflowPhase::EndOfGame, None, None),
            [CoachInput::Clear]
        );
        assert_eq!(driver.tick(now, &GameflowPhase::None, None, None), []);
        let again = driver.tick(now, &GameflowPhase::InProgress, None, Some(&game(5)?));
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
                driver.tick(now, &GameflowPhase::ChampSelect, Some(&broken), None),
                []
            );
        }
    }
}
