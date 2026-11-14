//! Product events waiting to be sent, and the tick that sends them.
//!
//! Events are queued from anywhere (the collector, the supervisor) and sent
//! from the collector, which is the one place holding the backend client and
//! the device credential. The queue is small and lossy by design: telemetry
//! must never grow, retry forever, or delay collection. Whether anything is
//! actually sent is decided by [`UsageReporter`] and its opt-out gate, not here.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};

use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::settings::SendGate;
use scout_client_core::telemetry::{UsageEvent, UsageOutcome, UsageReporter};
use uuid::Uuid;

/// More than this and the oldest event is dropped.
const MAX_QUEUED: usize = 32;

/// Events waiting for the collector's next tick. Cheap to clone and share.
#[derive(Debug, Clone, Default)]
pub struct UsageQueue {
    events: Arc<Mutex<VecDeque<UsageEvent>>>,
}

impl UsageQueue {
    /// Queue `event`.
    pub fn push(&self, event: UsageEvent) {
        let mut events = self.events.lock().unwrap_or_else(PoisonError::into_inner);
        if events.len() >= MAX_QUEUED {
            events.pop_front();
        }
        events.push_back(event);
    }

    fn drain(&self) -> Vec<UsageEvent> {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect()
    }
}

/// The queue and the reporter, as the collector holds them.
pub(super) struct UsageChannel {
    /// Where events are queued from.
    pub queue: UsageQueue,
    reporter: UsageReporter,
}

impl UsageChannel {
    /// A channel whose reporter obeys the "Send usage data" `gate`.
    pub(super) fn new(queue: UsageQueue, gate: SendGate) -> Self {
        Self {
            queue,
            reporter: UsageReporter::new(gate, env!("CARGO_PKG_VERSION")),
        }
    }

    /// Send what is queued, once the device has checked in. Before that, or
    /// while unpaired, events simply wait.
    pub(super) fn flush_after_check_in(
        &self,
        backend: &ScoutBackendClient,
        credential: Option<&DeviceCredential>,
        checked_in_device: Option<Uuid>,
        diagnostics: &Arc<Diagnostics>,
    ) {
        if let Some(credential) = credential
            && checked_in_device == Some(credential.device_id)
        {
            flush(
                &self.queue,
                &self.reporter,
                backend,
                credential,
                diagnostics,
            );
        }
    }
}

/// Send every queued event in the background, without waiting for the network.
///
/// A failure is a warning in the local log, never an error report: telemetry
/// about telemetry would be noise.
fn flush(
    queue: &UsageQueue,
    reporter: &UsageReporter,
    backend: &ScoutBackendClient,
    credential: &DeviceCredential,
    diagnostics: &Arc<Diagnostics>,
) {
    for event in queue.drain() {
        let reporter = reporter.clone();
        let backend = backend.clone();
        let credential = credential.clone();
        let diagnostics = Arc::clone(diagnostics);
        tokio::spawn(async move {
            if let UsageOutcome::Failed(error) = reporter.report(&backend, &credential, event).await
            {
                let mut record = DiagnosticEvent::new(
                    DiagnosticLevel::Warn,
                    DiagnosticCategory::Backend,
                    "send_usage_event",
                    DiagnosticOutcome::Failed,
                )
                .with_detail(error.to_string());
                if let Some(status) = error.status() {
                    record = record.with_status(status);
                }
                diagnostics.record(record);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use scout_client_core::telemetry::UsageEvent;

    use super::{MAX_QUEUED, UsageQueue};

    #[test]
    fn the_queue_is_bounded_and_drops_the_oldest() {
        let queue = UsageQueue::default();
        queue.push(UsageEvent::DevicePaired);
        for _ in 0..MAX_QUEUED {
            queue.push(UsageEvent::AppStarted);
        }
        let drained = queue.drain();
        assert_eq!(drained.len(), MAX_QUEUED);
        assert!(!drained.contains(&UsageEvent::DevicePaired));
        assert_eq!(queue.drain().len(), 0);
    }
}
