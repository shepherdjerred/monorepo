use std::sync::Arc;
use std::time::Duration;

use tokio::sync::watch;

use crate::AppState;
use crate::store::EvictionOutcome;

pub async fn run_eviction_pass(
    state: &AppState,
) -> Result<EvictionOutcome, crate::store::StoreError> {
    let outcome = state.store.run_eviction(&state.config).await?;
    for (ns, count) in &outcome.ttl_evicted_by_ns {
        state.metrics.record_evictions(ns, "ttl", *count);
    }
    for (ns, count) in &outcome.watermark_evicted_by_ns {
        state.metrics.record_evictions(ns, "watermark", *count);
    }
    Ok(outcome)
}

pub fn spawn_background_workers(
    state: Arc<AppState>,
    mut shutdown: watch::Receiver<bool>,
) -> (tokio::task::JoinHandle<()>, tokio::task::JoinHandle<()>) {
    let flush_state = Arc::clone(&state);
    let mut flush_shutdown = shutdown.clone();
    let flush_interval = Duration::from_secs(state.config.flush_interval_secs.max(1));

    let flush_handle = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(flush_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip immediate zero-time tick.
        ticker.tick().await;

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if let Err(err) = flush_state.store.flush_pending_deltas().await {
                        tracing::warn!(error = %err, "failed to flush pending access deltas");
                    }
                }
                _ = flush_shutdown.changed() => {
                    break;
                }
            }
        }
        if let Err(err) = flush_state.store.flush_pending_deltas().await {
            tracing::warn!(error = %err, "failed to flush pending access deltas on shutdown");
        }
    });

    let evict_state = Arc::clone(&state);
    let evict_interval = Duration::from_secs(state.config.evict_interval_secs.max(1));
    let evict_handle = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(evict_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    match run_eviction_pass(&evict_state).await {
                        Ok(outcome) => {
                            let ttl_total: u64 = outcome.ttl_evicted_by_ns.values().sum();
                            let wm_total: u64 = outcome.watermark_evicted_by_ns.values().sum();
                            if ttl_total > 0 || wm_total > 0 {
                                tracing::info!(
                                    ttl_evicted = ttl_total,
                                    watermark_evicted = wm_total,
                                    "completed eviction sweep"
                                );
                            }
                        }
                        Err(err) => {
                            tracing::warn!(error = %err, "eviction sweep failed");
                        }
                    }
                }
                _ = shutdown.changed() => {
                    break;
                }
            }
        }
    });

    (flush_handle, evict_handle)
}
