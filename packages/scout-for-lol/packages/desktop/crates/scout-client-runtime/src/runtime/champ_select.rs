//! Champion-select state in the collector: read the select's allowlisted
//! projection while gameflow is `ChampSelect` and publish it on the runtime
//! snapshot, where the supervisor's coach reads it.
//!
//! The projection has no identity field (see
//! `scout_client_core::live::champ_select`), so nothing the League client
//! hides during the select can reach the snapshot from here.

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::lcu::{LcuClient, LcuError, discover_lockfile};
use scout_client_core::live::champ_select::ChampSelectSnapshot;
use scout_client_core::live::gameflow::GameflowPhase;
use scout_client_core::live::source::{LcuSource, SourceError};

use super::state::{StateHub, update_state};

/// The League client found through its lockfile on each read, so a client
/// that restarts between selects is followed without holding a stale port.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct LockfileLcu;

impl LcuSource for LockfileLcu {
    async fn gameflow_phase(&self) -> Result<Option<GameflowPhase>, SourceError> {
        match client()? {
            Some(client) => client.gameflow_phase().await,
            None => Ok(None),
        }
    }

    async fn champ_select(&self) -> Result<Option<ChampSelectSnapshot>, SourceError> {
        match client()? {
            Some(client) => client.champ_select().await,
            None => Ok(None),
        }
    }
}

fn client() -> Result<Option<LcuClient>, SourceError> {
    match discover_lockfile() {
        Ok((_, lockfile)) => Ok(Some(LcuClient::new(&lockfile)?)),
        Err(LcuError::NotRunning) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Polls the select once per collection tick while it is open.
pub(super) struct ChampSelectWatcher<S = LockfileLcu> {
    source: S,
    last_problem: Option<String>,
}

impl Default for ChampSelectWatcher<LockfileLcu> {
    fn default() -> Self {
        Self::new(LockfileLcu)
    }
}

impl<S: LcuSource> ChampSelectWatcher<S> {
    pub(super) const fn new(source: S) -> Self {
        Self {
            source,
            last_problem: None,
        }
    }

    /// Publish the select while the phase is `ChampSelect`, and clear it the
    /// moment the phase leaves it.
    pub(super) async fn tick(&mut self, state: &StateHub, diagnostics: &Diagnostics) {
        if state.current_phase() != GameflowPhase::ChampSelect {
            update_state(state, |snapshot| {
                if snapshot.champ_select.is_some() {
                    snapshot.champ_select = None;
                }
            });
            self.last_problem = None;
            return;
        }
        match self.source.champ_select().await {
            Ok(select) => {
                self.last_problem = None;
                update_state(state, |snapshot| {
                    if snapshot.champ_select != select {
                        snapshot.champ_select = select;
                    }
                });
            }
            Err(error) => {
                let problem = error.to_string();
                if self.last_problem.as_deref() != Some(&problem) {
                    diagnostics.record(
                        DiagnosticEvent::new(
                            DiagnosticLevel::Warn,
                            DiagnosticCategory::Lcu,
                            "champ_select_poll",
                            DiagnosticOutcome::Failed,
                        )
                        .with_detail(&problem),
                    );
                    self.last_problem = Some(problem);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::live::champ_select::{self, ChampSelectSnapshot};
    use scout_client_core::live::gameflow::GameflowPhase;
    use scout_client_core::live::source::{ReplayFrame, ReplaySource};

    use super::ChampSelectWatcher;
    use crate::runtime::state::{StateHub, update_state};

    const FIXTURE: &str =
        include_str!("../../../scout-client-core/testdata/live/champ-select.json");

    fn select() -> Result<ChampSelectSnapshot, Box<dyn std::error::Error>> {
        Ok(champ_select::parse(&serde_json::from_str(FIXTURE)?)?)
    }

    fn set_phase(state: &StateHub, phase: &str) {
        update_state(state, |snapshot| {
            snapshot.gameflow_phase = Some(phase.to_owned());
        });
    }

    #[tokio::test]
    async fn the_select_is_published_while_open_and_cleared_after()
    -> Result<(), Box<dyn std::error::Error>> {
        tokio::time::timeout(Duration::from_secs(5), async {
            let source = ReplaySource::new(vec![
                ReplayFrame {
                    phase: GameflowPhase::ChampSelect,
                    live: None,
                    champ_select: Some(select()?),
                },
                ReplayFrame {
                    phase: GameflowPhase::InProgress,
                    live: None,
                    champ_select: None,
                },
            ]);
            let state = StateHub::default();
            let diagnostics = Diagnostics::in_memory();
            let mut watcher = ChampSelectWatcher::new(source);

            set_phase(&state, "Lobby");
            watcher.tick(&state, &diagnostics).await;
            assert!(state.subscribe().borrow().champ_select.is_none());

            set_phase(&state, "ChampSelect");
            watcher.tick(&state, &diagnostics).await;
            assert_eq!(
                state.subscribe().borrow().champ_select.as_ref(),
                Some(&select()?)
            );

            set_phase(&state, "InProgress");
            watcher.tick(&state, &diagnostics).await;
            assert!(state.subscribe().borrow().champ_select.is_none());
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .await?
    }
}
