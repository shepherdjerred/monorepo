//! Sending a spoken question to Scout and following its answer.

use futures_util::StreamExt as _;
use scout_explore_client::ExploreClient;
use scout_explore_client::ExploreClientError;
use scout_explore_client::voice::VoiceTurnEvents;
use tokio::sync::mpsc::UnboundedSender;

use super::capture::SpokenTurn;
use super::controller::TurnUpdate;

/// Runs spoken turns. Production posts to `coach/voice/turns`; tests script
/// the answer.
pub trait TurnRunner: Send + Sync {
    /// Start `turn` and report its progress on `updates`, ending with `done`,
    /// a refusal, or a broken stream. Dropping the returned handle stops the
    /// turn, so a superseded turn never reports into the next one.
    fn run(&self, turn: SpokenTurn, updates: UnboundedSender<TurnUpdate>) -> TurnHandle;
}

/// A running turn; dropping it aborts the request and its forwarding.
#[derive(Debug, Default)]
pub struct TurnHandle(Option<tokio::task::AbortHandle>);

impl TurnHandle {
    /// A turn with nothing to stop.
    #[cfg(test)]
    #[must_use]
    pub const fn detached() -> Self {
        Self(None)
    }
}

impl Drop for TurnHandle {
    fn drop(&mut self) {
        if let Some(task) = &self.0 {
            task.abort();
        }
    }
}

/// What a refusal says to the player.
fn refusal_message(error: &ExploreClientError) -> String {
    error.refusal().map_or_else(
        || format!("Scout could not take the question: {error}"),
        |refusal| refusal.message.clone(),
    )
}

/// Forward a voice turn's events until `done` or the first failure.
pub async fn forward(mut events: VoiceTurnEvents, updates: &UnboundedSender<TurnUpdate>) {
    while let Some(event) = events.next().await {
        let update = match event {
            Ok(event) => TurnUpdate::Event(event),
            Err(error) => TurnUpdate::Broken(format!("The answer was cut off: {error}")),
        };
        if updates.send(update).is_err() {
            // The voice service stopped: Scout is quitting.
            return;
        }
    }
}

/// The voice route on Scout, with the device credential this process holds.
#[derive(Debug, Clone)]
pub struct ScoutTurns {
    origin: String,
}

impl ScoutTurns {
    /// Turns against `origin`.
    #[must_use]
    pub const fn new(origin: String) -> Self {
        Self { origin }
    }
}

impl TurnRunner for ScoutTurns {
    fn run(&self, turn: SpokenTurn, updates: UnboundedSender<TurnUpdate>) -> TurnHandle {
        let origin = self.origin.clone();
        let task = tokio::spawn(async move {
            // Read the credential each turn: pairing may have replaced it,
            // and the store can block on the operating system.
            let client =
                tokio::task::spawn_blocking(move || ExploreClient::from_credential_store(&origin))
                    .await
                    .map_err(|join| format!("Scout could not read the device credential: {join}"))
                    .and_then(|client| client.map_err(|error| refusal_message(&error)));
            let client = match client {
                Ok(client) => client,
                Err(message) => {
                    let _ = updates.send(TurnUpdate::Refused(message));
                    return;
                }
            };
            match client
                .start_voice_turn(
                    &turn.utterance,
                    turn.trigger,
                    turn.conversation_id,
                    turn.game,
                )
                .await
            {
                Ok(events) => forward(events, &updates).await,
                Err(error) => {
                    let _ = updates.send(TurnUpdate::Refused(refusal_message(&error)));
                }
            }
        });
        TurnHandle(Some(task.abort_handle()))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use futures_util::stream;
    use scout_explore_client::voice::{VoiceTurnEvent, VoiceTurnOutcome, voice_events};
    use tokio::sync::mpsc;

    use super::forward;
    use crate::voice::controller::TurnUpdate;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// The route's body as the response stream yields it: one SSE frame per
    /// chunk.
    fn body(frames: &[(&str, &str)]) -> Vec<Result<String, reqwest::Error>> {
        frames
            .iter()
            .map(|(event, data)| Ok(format!("event: {event}\ndata: {data}\n\n")))
            .collect()
    }

    #[tokio::test]
    async fn dropping_the_handle_stops_a_turn_from_reporting() {
        let (updates, mut received) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let _ = updates.send(TurnUpdate::Broken("late".to_owned()));
        });
        drop(super::TurnHandle(Some(task.abort_handle())));
        assert!(received.recv().await.is_none());
    }

    #[tokio::test]
    async fn a_scripted_stream_is_forwarded_until_done() -> TestResult {
        let (updates, mut received) = mpsc::unbounded_channel();
        let events = voice_events(stream::iter(body(&[
            (
                "transcript",
                r#"{"type":"transcript","text":"What next?","trigger":"push_to_talk","wake":"not_required"}"#,
            ),
            ("done", r#"{"type":"done","outcome":"succeeded"}"#),
        ])));
        tokio::time::timeout(Duration::from_secs(5), forward(events, &updates)).await?;
        let mut kinds = Vec::new();
        while let Ok(update) = received.try_recv() {
            kinds.push(update);
        }
        assert!(matches!(
            kinds.as_slice(),
            [
                TurnUpdate::Event(VoiceTurnEvent::Transcript { .. }),
                TurnUpdate::Event(VoiceTurnEvent::Done {
                    outcome: VoiceTurnOutcome::Succeeded
                })
            ]
        ));
        Ok(())
    }

    #[tokio::test]
    async fn a_stream_that_ends_early_is_reported_broken() -> TestResult {
        let (updates, mut received) = mpsc::unbounded_channel();
        let events = voice_events(stream::iter(body(&[(
            "transcript",
            r#"{"type":"transcript","text":"What next?","trigger":"wake_word","wake":"verified"}"#,
        )])));
        tokio::time::timeout(Duration::from_secs(5), forward(events, &updates)).await?;
        assert!(matches!(
            received.try_recv()?,
            TurnUpdate::Event(VoiceTurnEvent::Transcript { .. })
        ));
        assert_eq!(
            received.try_recv()?,
            TurnUpdate::Broken(
                "The answer was cut off: the voice turn stream ended before it was done".to_owned()
            )
        );
        Ok(())
    }
}
