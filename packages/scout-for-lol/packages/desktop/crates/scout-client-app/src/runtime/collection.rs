//! Independent optional collectors never hold the gameflow/end-screen loop.

use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::{LcuClient, LcuEndpoint, discover_lockfile};
use scout_client_core::outbox::ObservationOutbox;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::task::JoinHandle;

use super::{RuntimeState, set_error};

type CollectionTask = JoinHandle<(HashMap<String, Vec<u8>>, Result<(), String>)>;

#[derive(Default)]
struct Worker {
    payloads: HashMap<String, Vec<u8>>,
    task: Option<CollectionTask>,
}

#[derive(Clone, Copy)]
enum Collector {
    History,
    Profile,
    Clash,
}

#[derive(Default)]
pub(super) struct CollectionWorkers {
    history: Worker,
    profile: Worker,
    clash: Worker,
}

impl CollectionWorkers {
    pub(super) async fn tick(
        &mut self,
        state: &Arc<RwLock<RuntimeState>>,
        outbox: &ObservationOutbox,
        diagnostics: &Arc<Diagnostics>,
        tick: u64,
        ready: bool,
    ) {
        for (worker, kind, cadence) in [
            (&mut self.history, Collector::History, 15),
            (&mut self.profile, Collector::Profile, 30),
            (&mut self.clash, Collector::Clash, 5),
        ] {
            if worker.task.as_ref().is_some_and(JoinHandle::is_finished)
                && let Some(task) = worker.task.take()
            {
                match task.await {
                    Ok((payloads, result)) => {
                        worker.payloads = payloads;
                        if let Err(error) = result {
                            set_error(state, error);
                        }
                    }
                    Err(error) => set_error(state, format!("Optional collector stopped: {error}")),
                }
            }
            if ready && tick % cadence == 1 && worker.task.is_none() {
                let outbox = outbox.clone();
                let diagnostics = Arc::clone(diagnostics);
                let mut payloads = std::mem::take(&mut worker.payloads);
                worker.task = Some(tokio::spawn(async move {
                    let result = collect(kind, &outbox, &mut payloads, &diagnostics, tick).await;
                    (payloads, result)
                }));
            }
        }
    }

    pub(super) fn stop(&mut self) {
        for worker in [&mut self.history, &mut self.profile, &mut self.clash] {
            if let Some(task) = worker.task.take() {
                task.abort();
            }
            worker.payloads.clear();
        }
    }
}

async fn collect(
    kind: Collector,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    diagnostics: &Diagnostics,
    tick: u64,
) -> Result<(), String> {
    let lockfile = match discover_lockfile() {
        Ok((_, lockfile)) => lockfile,
        Err(scout_client_core::lcu::LcuError::NotRunning) => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let client = LcuClient::new(&lockfile).map_err(|error| error.to_string())?;
    let Some(account) = client
        .get(LcuEndpoint::CurrentSummoner)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let Some(observer) = account.get("puuid").and_then(serde_json::Value::as_str) else {
        return Ok(());
    };
    if payloads.get("observer").map(Vec::as_slice) != Some(observer.as_bytes()) {
        payloads.clear();
        payloads.insert("observer".to_owned(), observer.as_bytes().to_vec());
    }
    match kind {
        Collector::History => {
            super::history::collect_recent_matches(
                &client,
                outbox,
                payloads,
                Some(observer),
                diagnostics,
            )
            .await
        }
        Collector::Profile => {
            super::collect_profile_snapshots(&client, outbox, payloads, Some(observer), diagnostics)
                .await
        }
        Collector::Clash => {
            super::clash::collect_snapshots(
                &client,
                outbox,
                payloads,
                Some(observer),
                diagnostics,
                tick,
            )
            .await
        }
    }
}
