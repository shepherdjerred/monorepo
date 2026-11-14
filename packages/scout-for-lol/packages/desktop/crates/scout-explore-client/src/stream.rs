//! Following a run over `explore/runs/stream`, reconnecting until it ends.
//!
//! The server sends a complete `snapshot` as the first frame of every
//! response, so attaching again is idempotent: the reducer replaces its state
//! from the snapshot instead of appending the same answer text twice. That is
//! what makes it safe to reconnect after any lost connection, idle timeout or
//! corrupt frame, with jittered exponential backoff, until `done` arrives or
//! the server says the run cannot be followed.

use std::time::Duration;

use futures_util::StreamExt;
use scout_client_core::desktop_api::RunOutcome;
use serde::Deserialize;
use thiserror::Error;
use uuid::Uuid;

use crate::client::ExploreClient;
use crate::contract::STREAM_EVENT_TYPES;
use crate::error::{ExploreClientError, Recovery, Refusal};
use crate::model::StreamEvent;

/// Why a stream frame could not be used.
#[derive(Debug, Error)]
pub enum FrameError {
    /// The data is not one known event, and did not say it may be skipped.
    #[error("stream frame does not match the contract: {0}")]
    Invalid(#[source] serde_json::Error),
    /// The SSE `event:` name disagrees with the data's `type`.
    #[error("stream frame named {event:?} carries a {kind:?} event")]
    Mismatched {
        /// The `event:` line.
        event: String,
        /// The data's `type`.
        kind: String,
    },
    /// A line is not UTF-8.
    #[error("stream frame is not UTF-8")]
    Encoding,
}

/// Just enough of a frame to tell an optional newer event from corruption.
#[derive(Deserialize)]
struct FrameEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    ignorable: Option<bool>,
}

/// Parse one frame's data, skipping only an unknown event that says it is
/// `ignorable`, exactly as the web's `parseExploreStreamEvent` does.
///
/// A known type in the wrong shape is corruption, and so is an unknown type
/// that did not volunteer to be skippable: both mean this build cannot render
/// the turn honestly.
///
/// # Errors
///
/// Returns [`FrameError`] for corrupt data, or for an `event:` name that
/// disagrees with the data's `type`.
pub fn parse_stream_frame(
    event_name: Option<&str>,
    data: &str,
) -> Result<Option<StreamEvent>, FrameError> {
    match serde_json::from_str::<StreamEvent>(data) {
        Ok(event) => match event_name {
            Some(name) if name != event.kind() => Err(FrameError::Mismatched {
                event: name.to_owned(),
                kind: event.kind().to_owned(),
            }),
            _ => Ok(Some(event)),
        },
        Err(error) => match serde_json::from_str::<FrameEnvelope>(data) {
            Ok(envelope)
                if envelope.ignorable == Some(true)
                    && !STREAM_EVENT_TYPES.contains(&envelope.kind.as_str()) =>
            {
                Ok(None)
            }
            _ => Err(FrameError::Invalid(error)),
        },
    }
}

/// One dispatched SSE frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseFrame {
    /// The `event:` field, when the frame named one.
    pub event: Option<String>,
    /// Every `data:` line, joined with newlines.
    pub data: String,
}

/// An incremental `text/event-stream` decoder.
///
/// Bytes arrive in arbitrary chunks, so a line (or a multi-byte character)
/// can straddle two of them; lines are split on bytes and decoded only once
/// complete. Comment lines (`:`), `id:` and `retry:` are ignored, and a frame
/// left incomplete when the stream ends is discarded, as the SSE standard
/// requires.
#[derive(Debug, Default)]
pub struct SseDecoder {
    line: Vec<u8>,
    event: Option<String>,
    data: Option<String>,
}

impl SseDecoder {
    /// Feed a chunk and return every frame it completed.
    ///
    /// # Errors
    ///
    /// Returns [`FrameError::Encoding`] for a line that is not UTF-8.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseFrame>, FrameError> {
        let mut frames = Vec::new();
        for &byte in chunk {
            if byte != b'\n' {
                self.line.push(byte);
                continue;
            }
            let mut line = std::mem::take(&mut self.line);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line).map_err(|_| FrameError::Encoding)?;
            if let Some(frame) = self.line_complete(&line) {
                frames.push(frame);
            }
        }
        Ok(frames)
    }

    fn line_complete(&mut self, line: &str) -> Option<SseFrame> {
        if line.is_empty() {
            let event = self.event.take();
            return self.data.take().map(|data| SseFrame { event, data });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => match &mut self.data {
                Some(data) => {
                    data.push('\n');
                    data.push_str(value);
                }
                None => self.data = Some(value.to_owned()),
            },
            _ => {}
        }
        None
    }
}

/// Reconnect delays: exponential from `initial` to `max`, each jittered into
/// the upper half of its step so a fleet of clients does not reconnect in
/// lockstep after a backend restart.
#[derive(Debug, Clone)]
pub struct Backoff {
    initial: Duration,
    max: Duration,
    attempt: u32,
}

impl Backoff {
    /// A backoff from `initial` to `max`.
    #[must_use]
    pub const fn new(initial: Duration, max: Duration) -> Self {
        Self {
            initial,
            max,
            attempt: 0,
        }
    }

    /// The next delay, for a uniform sample `unit` in `[0, 1]`.
    ///
    /// The step doubles from `initial` up to `max`; the delay falls in
    /// `[max(step / 2, initial), step]`, so it never drops below `initial`
    /// or exceeds `max`.
    #[must_use]
    pub fn next_delay(&mut self, unit: f64) -> Duration {
        let factor = 2_u32.saturating_pow(self.attempt.min(16));
        self.attempt = self.attempt.saturating_add(1);
        let step = self.initial.saturating_mul(factor).min(self.max);
        let floor = (step / 2).max(self.initial).min(step);
        floor + step.saturating_sub(floor).mul_f64(unit.clamp(0.0, 1.0))
    }

    /// Start over after a healthy connection.
    pub const fn reset(&mut self) {
        self.attempt = 0;
    }
}

/// How the stream reconnects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamOptions {
    /// The first reconnect delay.
    pub initial_backoff: Duration,
    /// The longest reconnect delay.
    pub max_backoff: Duration,
    /// Consecutive connections that may fail on a corrupt frame before the
    /// stream gives up: corruption that survives a fresh snapshot is a broken
    /// contract, not a lost connection.
    pub max_corrupt_connections: u32,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            initial_backoff: Duration::from_millis(500),
            max_backoff: Duration::from_secs(15),
            max_corrupt_connections: 3,
        }
    }
}

/// Something the stream reports while it runs.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamSignal {
    /// A frame, in order. After a reconnect the first one is a `snapshot`.
    Event(Box<StreamEvent>),
    /// The connection was lost; the stream attaches again after `delay`.
    Reconnecting {
        /// Reconnects so far without a healthy connection in between.
        attempt: u32,
        /// How long until the next attempt.
        delay: Duration,
        /// Why the last connection ended, for diagnostics.
        cause: String,
    },
}

/// How following a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEnd {
    /// The run's last frame arrived.
    Done(RunOutcome),
    /// The server no longer has the run (a 404); `runs/outcome` says how it
    /// ended, or none when it has forgotten. Refetch the transcript either way.
    Gone(Option<RunOutcome>),
    /// The device cannot follow runs until the owner acts: pair again
    /// (`unauthorized`, `scope_required`) or sign in on the web
    /// (`reauthorize_required`). [`Refusal::recovery`] says which.
    RePairRequired(Refusal),
    /// This build is older than the server accepts.
    UpgradeRequired {
        /// The server's explanation.
        message: String,
    },
    /// Another refusal that retrying cannot fix, such as `feature_disabled`.
    Refused(Refusal),
}

/// What one failed attempt means for the loop.
enum Next {
    Retry { at_least: Option<Duration> },
    AskOutcome,
    End(StreamEnd),
    Fail(ExploreClientError),
}

fn next_after(error: ExploreClientError) -> Next {
    match error {
        ExploreClientError::Transport(_) | ExploreClientError::Decode(_) => {
            Next::Retry { at_least: None }
        }
        ExploreClientError::Unexpected { status, .. } if status >= 500 => {
            Next::Retry { at_least: None }
        }
        ExploreClientError::UpgradeRequired { message } => {
            Next::End(StreamEnd::UpgradeRequired { message })
        }
        ExploreClientError::Refused(refusal) => match refusal.recovery() {
            Recovery::RetryLater { after } => Next::Retry { at_least: after },
            Recovery::NotFound => Next::AskOutcome,
            Recovery::RePair | Recovery::SignInOnWeb => {
                Next::End(StreamEnd::RePairRequired(refusal))
            }
            Recovery::UpgradeApp => Next::End(StreamEnd::UpgradeRequired {
                message: refusal.message,
            }),
            Recovery::FeatureDisabled
            | Recovery::ExploreForbidden
            | Recovery::ConversationBusy
            | Recovery::FixRequest => Next::End(StreamEnd::Refused(refusal)),
        },
        other => Next::Fail(other),
    }
}

/// How one connection ended without a terminal answer.
enum Lost {
    /// It failed or closed; `healthy` when it delivered at least one frame.
    Connection {
        error: Option<ExploreClientError>,
        healthy: bool,
    },
    /// A frame was corrupt.
    Corrupt(FrameError),
}

impl ExploreClient {
    /// Follow a run until it ends, reconnecting as needed.
    ///
    /// Every frame is passed to `on_signal` in order, as are reconnects.
    /// Dropping the returned future hangs up; the run keeps going on the
    /// server, so it can be followed again later.
    ///
    /// # Errors
    ///
    /// Returns an error only for a broken contract: an answer outside the
    /// contract that retrying cannot fix, or frames that stay corrupt across
    /// [`StreamOptions::max_corrupt_connections`] fresh connections.
    pub async fn follow_run(
        &self,
        run_id: Uuid,
        options: StreamOptions,
        mut on_signal: impl FnMut(StreamSignal) + Send,
    ) -> Result<StreamEnd, ExploreClientError> {
        let mut backoff = Backoff::new(options.initial_backoff, options.max_backoff);
        let mut attempt = 0_u32;
        let mut corrupt = 0_u32;
        loop {
            let (next, cause) = match self.attach(run_id, &mut on_signal).await {
                Ok(end) => return Ok(end),
                Err(Lost::Corrupt(error)) => {
                    corrupt += 1;
                    if corrupt >= options.max_corrupt_connections {
                        return Err(ExploreClientError::Unexpected {
                            status: 200,
                            detail: error.to_string(),
                        });
                    }
                    let cause = error.to_string();
                    (Next::Retry { at_least: None }, cause)
                }
                Err(Lost::Connection { error, healthy }) => {
                    if healthy {
                        backoff.reset();
                        attempt = 0;
                        corrupt = 0;
                    }
                    match error {
                        None => (
                            Next::Retry { at_least: None },
                            "the stream closed before done".to_owned(),
                        ),
                        Some(error) => {
                            let cause = error.to_string();
                            (next_after(error), cause)
                        }
                    }
                }
            };
            match next {
                Next::End(end) => return Ok(end),
                Next::Fail(error) => return Err(error),
                Next::AskOutcome => {
                    return self.settle_outcome(run_id, &mut backoff).await;
                }
                Next::Retry { at_least } => {
                    attempt += 1;
                    let delay = backoff
                        .next_delay(fastrand::f64())
                        .max(at_least.unwrap_or_default());
                    on_signal(StreamSignal::Reconnecting {
                        attempt,
                        delay,
                        cause,
                    });
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    /// One connection: forward frames until `done`, or say how it was lost.
    async fn attach(
        &self,
        run_id: Uuid,
        on_signal: &mut (impl FnMut(StreamSignal) + Send),
    ) -> Result<StreamEnd, Lost> {
        let response = self
            .open_stream(run_id)
            .await
            .map_err(|error| Lost::Connection {
                error: Some(error),
                healthy: false,
            })?;
        let mut body = response.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut healthy = false;
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|error| Lost::Connection {
                error: Some(ExploreClientError::Transport(error)),
                healthy,
            })?;
            for frame in decoder.push(&chunk).map_err(Lost::Corrupt)? {
                let Some(event) = parse_stream_frame(frame.event.as_deref(), &frame.data)
                    .map_err(Lost::Corrupt)?
                else {
                    continue;
                };
                healthy = true;
                let done = match &event {
                    StreamEvent::Done { outcome } => Some(*outcome),
                    _ => None,
                };
                on_signal(StreamSignal::Event(Box::new(event)));
                if let Some(outcome) = done {
                    return Ok(StreamEnd::Done(outcome));
                }
            }
        }
        Err(Lost::Connection {
            error: None,
            healthy,
        })
    }

    /// The run is gone: ask how it ended, retrying only transient failures.
    async fn settle_outcome(
        &self,
        run_id: Uuid,
        backoff: &mut Backoff,
    ) -> Result<StreamEnd, ExploreClientError> {
        loop {
            match self.run_outcome(run_id).await {
                Ok(outcome) => return Ok(StreamEnd::Gone(outcome)),
                Err(error) => match next_after(error) {
                    Next::Retry { at_least } => {
                        let delay = backoff
                            .next_delay(fastrand::f64())
                            .max(at_least.unwrap_or_default());
                        tokio::time::sleep(delay).await;
                    }
                    // A run whose outcome is also missing ended without one.
                    Next::AskOutcome => return Ok(StreamEnd::Gone(None)),
                    Next::End(end) => return Ok(end),
                    Next::Fail(error) => return Err(error),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{Backoff, FrameError, SseDecoder, SseFrame, parse_stream_frame};
    use crate::model::StreamEvent;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn frames_split_across_chunks_and_lines_decode_whole() -> TestResult {
        let mut decoder = SseDecoder::default();
        let text = "event: answer_delta\r\ndata: {\"type\":\"answer_delta\",\"text\":\"Jinx ✓\"}\r\n\r\n: keepalive\n\nevent: done\ndata: {\"type\":\"done\",\n";
        let bytes = text.as_bytes();
        let mut frames = Vec::new();
        // One byte at a time splits the multi-byte check mark too.
        for byte in bytes {
            frames.extend(decoder.push(std::slice::from_ref(byte))?);
        }
        assert_eq!(
            frames,
            vec![SseFrame {
                event: Some("answer_delta".to_owned()),
                data: r#"{"type":"answer_delta","text":"Jinx ✓"}"#.to_owned(),
            }]
        );
        frames = decoder.push(b"data: \"outcome\":\"succeeded\"}\n\n")?;
        assert_eq!(frames.len(), 1);
        let event = parse_stream_frame(frames[0].event.as_deref(), &frames[0].data)?;
        assert!(matches!(event, Some(StreamEvent::Done { .. })), "{event:?}");
        Ok(())
    }

    #[test]
    fn a_frame_without_data_dispatches_nothing() -> TestResult {
        let mut decoder = SseDecoder::default();
        assert_eq!(
            decoder.push(b"event: snapshot\n\nid: 4\nretry: 10\n\n")?,
            Vec::new()
        );
        Ok(())
    }

    #[test]
    fn a_line_that_is_not_utf8_is_corrupt() {
        let mut decoder = SseDecoder::default();
        assert!(matches!(
            decoder.push(b"data: \xff\n"),
            Err(FrameError::Encoding)
        ));
    }

    #[test]
    fn an_unknown_ignorable_frame_is_skipped_and_anything_else_is_corrupt() {
        let skipped = parse_stream_frame(Some("replay"), r#"{"type":"replay","ignorable":true}"#);
        assert!(matches!(skipped, Ok(None)), "{skipped:?}");
        for data in [
            r#"{"type":"replay"}"#,
            r#"{"type":"replay","ignorable":false}"#,
            r#"{"type":"answer_delta","text":"x","extra":1}"#,
            r#"{"type":"activity","text":"x","ignorable":true,"extra":1}"#,
            r#"{"type":"run_preview","preview":null,"ignorable":false}"#,
            "not json",
        ] {
            assert!(
                matches!(parse_stream_frame(None, data), Err(FrameError::Invalid(_))),
                "{data}"
            );
        }
    }

    #[test]
    fn an_event_name_that_disagrees_with_the_data_is_corrupt() {
        let result = parse_stream_frame(Some("final"), r#"{"type":"answer_delta","text":"x"}"#);
        assert!(
            matches!(result, Err(FrameError::Mismatched { .. })),
            "{result:?}"
        );
    }

    #[test]
    fn backoff_doubles_from_half_a_second_to_fifteen_with_jitter() {
        let initial = Duration::from_millis(500);
        let max = Duration::from_secs(15);
        let mut low = Backoff::new(initial, max);
        let mut high = Backoff::new(initial, max);
        let lows: Vec<_> = (0..8).map(|_| low.next_delay(0.0)).collect();
        let highs: Vec<_> = (0..8).map(|_| high.next_delay(1.0)).collect();
        let ms = |delays: &[Duration]| {
            delays
                .iter()
                .map(|delay| u64::try_from(delay.as_millis()).unwrap_or(u64::MAX))
                .collect::<Vec<_>>()
        };
        assert_eq!(ms(&lows), [500, 500, 1000, 2000, 4000, 7500, 7500, 7500]);
        assert_eq!(
            ms(&highs),
            [500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]
        );
        let mut sampled = Backoff::new(initial, max);
        for _ in 0..40 {
            let delay = sampled.next_delay(fastrand::f64());
            assert!(delay >= initial && delay <= max, "{delay:?}");
        }
        high.reset();
        assert_eq!(high.next_delay(1.0), initial);
    }
}
