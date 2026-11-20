//! When Scout asks for coaching itself.
//!
//! Two moments, both inside what Riot's policy approves for pre-game help:
//! champion-select advice when a pick or ban changes, and the plan when the
//! game first reaches `InProgress`. Neither carries live state, and neither
//! carries text: each is an [`AppTurn`] that [`crate::session::app_turn_request`]
//! turns into a `runs/start-app` body, which the server holds to the same
//! limits this planner keeps (4 per champion select, 1 per game). The planner
//! is the polite half; the server's count is the one that cannot be bypassed.
//!
//! This is pure state with no clock or I/O: the supervisor tells it what it
//! saw and sends what it returns.

use scout_client_core::coach_context::{ChampSelectContext, GameContext, PregameContext};
use scout_client_core::desktop_api::AppInitiation;

/// Champion-select advice a game key may have asked for, the server's limit.
pub const MAX_CHAMP_SELECT_TURNS: u8 = 4;

/// One turn Scout asks for.
#[derive(Debug, Clone, PartialEq)]
pub struct AppTurn {
    /// Why it starts.
    pub initiation: AppInitiation,
    /// The champion select or game it belongs to.
    pub game_key: String,
    /// The one section it carries.
    pub context: GameContext,
}

/// What a champion select's pick and ban state looks like: a change in any of
/// these is a reason to offer advice again; a timer tick or a hover is not.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Picks {
    mine: Vec<u32>,
    theirs: Vec<u32>,
    my_bans: Vec<u32>,
    their_bans: Vec<u32>,
}

impl Picks {
    fn of(select: &ChampSelectContext) -> Self {
        let revealed = |ids: Vec<u32>| ids.into_iter().filter(|id| *id != 0).collect();
        Self {
            mine: revealed(select.my_team.iter().map(|slot| slot.champion_id).collect()),
            theirs: revealed(
                select
                    .their_team
                    .iter()
                    .map(|slot| slot.champion_id)
                    .collect(),
            ),
            my_bans: revealed(select.my_bans.clone()),
            their_bans: revealed(select.their_bans.clone()),
        }
    }

    fn is_empty(&self) -> bool {
        self.mine.is_empty()
            && self.theirs.is_empty()
            && self.my_bans.is_empty()
            && self.their_bans.is_empty()
    }
}

#[derive(Debug)]
struct Select {
    key: String,
    sent: u8,
    last: Option<Picks>,
}

/// Decides when to ask. One planner lives as long as the supervisor.
#[derive(Debug, Default)]
pub struct AppTurnPlanner {
    select: Option<Select>,
    pregame_for: Option<String>,
}

impl AppTurnPlanner {
    /// A planner that has asked for nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The champion-select screen as it stands for the select named
    /// `game_key`. Returns a turn when a pick or ban changed since the last
    /// one asked for, until the select has had [`MAX_CHAMP_SELECT_TURNS`].
    pub fn champ_select(&mut self, game_key: &str, select: &ChampSelectContext) -> Option<AppTurn> {
        let picks = Picks::of(select);
        let state = match &mut self.select {
            Some(state) if state.key == game_key => state,
            slot => slot.insert(Select {
                key: game_key.to_owned(),
                sent: 0,
                last: None,
            }),
        };
        // A change is measured against the last state seen, so a long select
        // is not asked about once per timer tick, and an empty screen at the
        // start of a select is not a change.
        let changed = state.last.as_ref().is_none_or(|last| *last != picks);
        let worth_asking = changed && !picks.is_empty();
        state.last = Some(picks);
        if !worth_asking || state.sent >= MAX_CHAMP_SELECT_TURNS {
            return None;
        }
        state.sent += 1;
        Some(AppTurn {
            initiation: AppInitiation::AppChampSelect,
            game_key: game_key.to_owned(),
            context: GameContext {
                champ_select: Some(select.clone()),
                ..GameContext::default()
            },
        })
    }

    /// The loading screen when the game first reaches `InProgress`. Returns
    /// the plan's turn once per `game_key`.
    pub fn in_progress(&mut self, game_key: &str, pregame: &PregameContext) -> Option<AppTurn> {
        if self.pregame_for.as_deref() == Some(game_key) {
            return None;
        }
        self.pregame_for = Some(game_key.to_owned());
        Some(AppTurn {
            initiation: AppInitiation::AppPregame,
            game_key: game_key.to_owned(),
            context: GameContext {
                pregame: Some(pregame.clone()),
                ..GameContext::default()
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use scout_client_core::coach_context::{
        AllySlot, ChampSelectContext, EnemySlot, PregameContext, PregameGame,
    };

    use super::{AppInitiation, AppTurnPlanner, MAX_CHAMP_SELECT_TURNS};

    fn select(mine: u32, theirs: u32, bans: u32) -> ChampSelectContext {
        ChampSelectContext {
            phase: Some("BAN_PICK".to_owned()),
            local_cell_id: 0,
            my_team: vec![AllySlot {
                cell_id: 0,
                champion_id: mine,
                assigned_role: None,
            }],
            their_team: vec![EnemySlot {
                cell_id: 5,
                champion_id: theirs,
            }],
            my_bans: vec![bans],
            their_bans: Vec::new(),
        }
    }

    fn pregame() -> PregameContext {
        PregameContext {
            game: PregameGame {
                mode: "CLASSIC".to_owned(),
                map: "Map11".to_owned(),
            },
            participants: Vec::new(),
        }
    }

    #[test]
    fn a_changed_pick_asks_and_an_unchanged_screen_does_not() {
        let mut planner = AppTurnPlanner::new();
        let first = planner.champ_select("cs-1", &select(0, 64, 0));
        assert_eq!(
            first.as_ref().map(|turn| turn.initiation),
            Some(AppInitiation::AppChampSelect)
        );
        assert!(planner.champ_select("cs-1", &select(0, 64, 0)).is_none());
        assert!(planner.champ_select("cs-1", &select(54, 64, 0)).is_some());
        assert!(planner.champ_select("cs-1", &select(54, 64, 0)).is_none());
    }

    #[test]
    fn an_empty_screen_is_not_a_change() {
        let mut planner = AppTurnPlanner::new();
        assert!(planner.champ_select("cs-1", &select(0, 0, 0)).is_none());
    }

    #[test]
    fn a_select_asks_at_most_four_times() {
        let mut planner = AppTurnPlanner::new();
        let asked = (1..=10)
            .filter(|pick| {
                planner
                    .champ_select("cs-1", &select(*pick, 64, 0))
                    .is_some()
            })
            .count();
        assert_eq!(asked, usize::from(MAX_CHAMP_SELECT_TURNS));
        // A new champion select starts its own count.
        assert!(planner.champ_select("cs-2", &select(1, 64, 0)).is_some());
    }

    #[test]
    fn the_champ_select_turn_carries_only_the_screen() {
        let mut planner = AppTurnPlanner::new();
        let turn = planner.champ_select("cs-1", &select(0, 64, 0));
        let context = turn.map(|turn| turn.context);
        assert!(context.as_ref().is_some_and(|c| c.champ_select.is_some()));
        assert!(
            context.as_ref().is_some_and(|c| {
                c.pregame.is_none() && c.live.is_none() && c.postgame.is_none()
            })
        );
    }

    #[test]
    fn the_plan_is_asked_once_per_game_and_carries_no_live_state() {
        let mut planner = AppTurnPlanner::new();
        let turn = planner.in_progress("g-1", &pregame());
        assert_eq!(
            turn.as_ref().map(|turn| turn.initiation),
            Some(AppInitiation::AppPregame)
        );
        assert!(
            turn.is_some_and(|turn| turn.context.live.is_none() && turn.context.pregame.is_some())
        );
        assert!(planner.in_progress("g-1", &pregame()).is_none());
        assert!(planner.in_progress("g-2", &pregame()).is_some());
    }
}
