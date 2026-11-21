//! Product events waiting to be sent, and the tick that sends them.
//!
//! Events are queued from anywhere (the collector, the supervisor) and sent
//! from the collector, which is the one place holding the backend client and
//! the device credential. The queue is small and lossy by design: telemetry
//! must never grow without bound or delay collection. Whether anything is
//! actually sent is decided by [`UsageReporter`] and its opt-out gate, not here.
//!
//! Sending is paced to half the backend's per-device limit, one event at a
//! time. A first start can queue a burst — `app_started`, `update_applied`,
//! and one `post_game_reported` for each backlogged game the outbox delivers —
//! and sending all of it at once ran straight into the backend's limit, so
//! every event past it was lost to a 429. A 429 now keeps the event at the
//! front of the queue and waits for the server's `Retry-After`.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::settings::SendGate;
use scout_client_core::telemetry::{
    SERVER_EVENTS_PER_MINUTE, UsageEvent, UsageOutcome, UsageReporter,
};
use tokio::time::Instant;
use uuid::Uuid;

/// More than this and the oldest event is dropped.
const MAX_QUEUED: usize = 32;

/// The gap between two sends: half the backend's per-device budget, so a
/// burst drains at a steady rate well inside it.
const SEND_SPACING: Duration = Duration::from_secs(60 * 2 / SERVER_EVENTS_PER_MINUTE as u64);

/// How long to wait after a 429 that named no `Retry-After`: the backend's
/// whole window.
const DEFAULT_BACKOFF: Duration = Duration::from_mins(1);

/// The longest `Retry-After` honoured as given; a longer one is capped.
const MAX_BACKOFF: Duration = Duration::from_mins(10);

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

    /// Put back an event the backend asked to see later, ahead of the rest.
    /// When the queue has filled up meanwhile, it is the oldest and is dropped.
    fn retry(&self, event: UsageEvent) {
        let mut events = self.events.lock().unwrap_or_else(PoisonError::into_inner);
        if events.len() < MAX_QUEUED {
            events.push_front(event);
        }
    }

    fn pop(&self) -> Option<UsageEvent> {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop_front()
    }

    #[cfg(test)]
    fn drain(&self) -> Vec<UsageEvent> {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect()
    }
}

/// When the next event may go, and whether one is on the wire.
#[derive(Debug)]
struct Pacing {
    spacing: Duration,
    sending: bool,
    not_before: Option<Instant>,
    /// Whether the current 429 back-off has been logged; one line per episode.
    backoff_logged: bool,
}

/// The queue and the reporter, as the collector holds them.
pub(super) struct UsageChannel {
    /// Where events are queued from.
    pub queue: UsageQueue,
    reporter: UsageReporter,
    pacing: Arc<Mutex<Pacing>>,
}

impl UsageChannel {
    /// A channel whose reporter obeys the "Send usage data" `gate`.
    pub(super) fn new(queue: UsageQueue, gate: SendGate) -> Self {
        Self::paced(queue, gate, SEND_SPACING)
    }

    fn paced(queue: UsageQueue, gate: SendGate, spacing: Duration) -> Self {
        Self {
            queue,
            reporter: UsageReporter::new(gate, env!("CARGO_PKG_VERSION")),
            pacing: Arc::new(Mutex::new(Pacing {
                spacing,
                sending: false,
                not_before: None,
                backoff_logged: false,
            })),
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
            self.send_next(backend, credential, diagnostics);
        }
    }

    /// Send the next queued event in the background, without waiting for the
    /// network, when no other is on the wire and the pace allows one.
    ///
    /// A failure is a warning in the local log, never an error report:
    /// telemetry about telemetry would be noise.
    fn send_next(
        &self,
        backend: &ScoutBackendClient,
        credential: &DeviceCredential,
        diagnostics: &Arc<Diagnostics>,
    ) {
        let now = Instant::now();
        let mut pacing = self.pacing.lock().unwrap_or_else(PoisonError::into_inner);
        if pacing.sending || pacing.not_before.is_some_and(|at| now < at) {
            return;
        }
        let Some(event) = self.queue.pop() else {
            return;
        };
        pacing.sending = true;
        pacing.not_before = Some(now + pacing.spacing);
        drop(pacing);
        let reporter = self.reporter.clone();
        let backend = backend.clone();
        let credential = credential.clone();
        let diagnostics = Arc::clone(diagnostics);
        let queue = self.queue.clone();
        let pacing = Arc::clone(&self.pacing);
        tokio::spawn(async move {
            let outcome = reporter.report(&backend, &credential, event).await;
            let mut pacing = pacing.lock().unwrap_or_else(PoisonError::into_inner);
            pacing.sending = false;
            match outcome {
                UsageOutcome::Sent | UsageOutcome::Suppressed => pacing.backoff_logged = false,
                UsageOutcome::RateLimited { retry_after } => {
                    let wait = retry_after
                        .unwrap_or(DEFAULT_BACKOFF)
                        .clamp(pacing.spacing, MAX_BACKOFF);
                    pacing.not_before = Some(Instant::now() + wait);
                    queue.retry(event);
                    if !pacing.backoff_logged {
                        pacing.backoff_logged = true;
                        diagnostics.record(
                            DiagnosticEvent::new(
                                DiagnosticLevel::Info,
                                DiagnosticCategory::Backend,
                                "send_usage_event",
                                DiagnosticOutcome::Deferred,
                            )
                            .with_status(429)
                            .with_detail(format!(
                                "rate limited; queued events wait {}s",
                                wait.as_secs()
                            )),
                        );
                    }
                }
                UsageOutcome::Failed(error) => {
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
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, PoisonError};
    use std::time::Duration;

    use scout_client_core::backend::ScoutBackendClient;
    use scout_client_core::credentials::DeviceCredential;
    use scout_client_core::diagnostics::{DiagnosticOutcome, Diagnostics};
    use scout_client_core::settings::SendGate;
    use scout_client_core::telemetry::{SERVER_EVENTS_PER_MINUTE, UsageEvent};
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;
    use uuid::Uuid;

    use super::{MAX_QUEUED, SEND_SPACING, UsageChannel, UsageQueue};

    /// What the mock backend saw: each event name in arrival order with the
    /// status it answered, and the most requests it ever held at once.
    #[derive(Default)]
    struct Seen {
        events: Vec<(String, u16)>,
        open: usize,
        most_open: usize,
    }

    /// A backend that answers the first `limited` events with 429 and a
    /// `Retry-After: 0`, then accepts the rest.
    async fn backend(
        limited: usize,
    ) -> Result<(String, Arc<Mutex<Seen>>), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let seen: Arc<Mutex<Seen>> = Arc::default();
        let record = Arc::clone(&seen);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let record = Arc::clone(&record);
                tokio::spawn(async move {
                    {
                        let mut seen = record.lock().unwrap_or_else(PoisonError::into_inner);
                        seen.open += 1;
                        seen.most_open = seen.most_open.max(seen.open);
                    }
                    let mut received = Vec::new();
                    let mut buffer = [0_u8; 4096];
                    while !String::from_utf8_lossy(&received).contains('}') {
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => break,
                            Ok(read) => received.extend_from_slice(&buffer[..read]),
                        }
                    }
                    let request = String::from_utf8_lossy(&received);
                    let event = request
                        .split("\"event\":\"")
                        .nth(1)
                        .and_then(|rest| rest.split('"').next())
                        .unwrap_or_default()
                        .to_owned();
                    // Hold the request a moment, so overlapping sends would show.
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    let status = {
                        let mut seen = record.lock().unwrap_or_else(PoisonError::into_inner);
                        let status = if seen.events.len() < limited {
                            429
                        } else {
                            202
                        };
                        seen.events.push((event, status));
                        seen.open -= 1;
                        status
                    };
                    let reply = if status == 429 {
                        "HTTP/1.1 429 Too Many Requests\r\nretry-after: 0\r\ncontent-length: 24\r\nconnection: close\r\n\r\n{\"error\":\"rate_limited\"}"
                    } else {
                        "HTTP/1.1 202 Accepted\r\ncontent-length: 17\r\nconnection: close\r\n\r\n{\"accepted\":true}"
                    };
                    let _ = stream.write_all(reply.as_bytes()).await;
                });
            }
        });
        Ok((origin, seen))
    }

    #[test]
    fn the_relay_paces_itself_to_half_the_server_limit() {
        assert_eq!(
            u64::from(SERVER_EVENTS_PER_MINUTE) * SEND_SPACING.as_secs(),
            120
        );
    }

    #[tokio::test]
    async fn a_burst_is_sent_one_at_a_time_and_a_429_is_retried_in_order()
    -> Result<(), Box<dyn std::error::Error>> {
        let (origin, seen) = backend(2).await?;
        let backend = ScoutBackendClient::new(&origin)?;
        let credential = DeviceCredential {
            device_id: Uuid::new_v4(),
            token: "sct_test".to_owned(),
        };
        let diagnostics = Arc::new(Diagnostics::in_memory());
        let channel = UsageChannel::paced(
            UsageQueue::default(),
            SendGate::new(true),
            Duration::from_millis(30),
        );
        let burst = [
            UsageEvent::AppStarted,
            UsageEvent::UpdateApplied,
            UsageEvent::PostGameReported,
            UsageEvent::PostGameReported,
            UsageEvent::DevicePaired,
        ];
        for event in burst {
            channel.queue.push(event);
        }

        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .events
            .iter()
            .filter(|(_, status)| *status == 202)
            .count()
            < burst.len()
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "the burst never drained"
            );
            channel.flush_after_check_in(
                &backend,
                Some(&credential),
                Some(credential.device_id),
                &diagnostics,
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }

        let seen = seen.lock().unwrap_or_else(PoisonError::into_inner);
        assert_eq!(seen.most_open, 1);
        let accepted: Vec<&str> = seen
            .events
            .iter()
            .filter(|(_, status)| *status == 202)
            .map(|(event, _)| event.as_str())
            .collect();
        assert_eq!(
            accepted,
            [
                "app_started",
                "update_applied",
                "post_game_reported",
                "post_game_reported",
                "device_paired",
            ]
        );
        // The first event was refused twice, then accepted: nothing was lost.
        assert_eq!(seen.events[0].0, "app_started");
        assert_eq!(seen.events[1].0, "app_started");
        assert_eq!(seen.events.len(), burst.len() + 2);
        // One line for the back-off, not one per refused send.
        let usage: Vec<_> = diagnostics
            .events()
            .into_iter()
            .filter(|event| event.operation == "send_usage_event")
            .collect();
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].outcome, DiagnosticOutcome::Deferred);
        assert_eq!(channel.queue.drain(), Vec::<UsageEvent>::new());
        Ok(())
    }

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
