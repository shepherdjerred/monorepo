//! Where a recording becomes a question.
//!
//! The microphone engine hands over a finished utterance only after the
//! player said the wake word or held push-to-talk. This is the one place in
//! the workspace that marks such a recording as the player's own
//! ([`PlayerAuthored::from_voice_capture`]); a test in `scout-explore-client`
//! holds it to this file. Only a turn built here may carry the live game, and
//! one spoken in champion select carries what the select shows, as a typed
//! question does.

use scout_client_core::coach_context::GameContext;
use scout_client_core::live::champ_select::ChampSelectSnapshot;
use scout_client_core::live::snapshot::LiveSnapshot;
use scout_explore_client::PlayerAuthored;
use scout_explore_client::voice::{Utterance, VoiceTrigger};
use uuid::Uuid;

/// A question the player spoke, ready for the voice route.
#[derive(Debug)]
pub struct SpokenTurn {
    /// The recording, checked against the route's contract.
    pub utterance: PlayerAuthored<Utterance>,
    /// What started it.
    pub trigger: VoiceTrigger,
    /// The conversation to continue; none starts a new one.
    pub conversation_id: Option<Uuid>,
    /// The game in progress, or the champion-select screen, allowlisted and
    /// validated.
    pub game: Option<GameContext>,
}

/// The live game as the coach contract carries it, or none when this frame
/// breaks a bound Scout would refuse, so the question still goes.
fn live_game(snapshot: &LiveSnapshot) -> Option<GameContext> {
    let game = GameContext::live(snapshot);
    match game.validate() {
        Ok(()) => Some(game),
        Err(error) => {
            tracing::warn!(%error, "asking without the live game");
            None
        }
    }
}

/// The champion-select screen as the coach contract carries it, or none when
/// this screen breaks a bound Scout would refuse, so the question still goes.
fn champ_select_game(snapshot: &ChampSelectSnapshot) -> Option<GameContext> {
    match GameContext::champ_select(snapshot) {
        Ok(game) => Some(game),
        Err(error) => {
            tracing::warn!(%error, "asking without the champion select");
            None
        }
    }
}

/// Turn what the microphone engine recorded into a question.
///
/// # Errors
///
/// A message safe to show when the recording is not one the route accepts,
/// such as a tap of push-to-talk too short to hold a question.
pub fn spoken_turn(
    recorded: &scout_voice::Utterance,
    conversation_id: Option<Uuid>,
    live: Option<&LiveSnapshot>,
    champ_select: Option<&ChampSelectSnapshot>,
) -> Result<SpokenTurn, String> {
    let wav = recorded
        .to_wav()
        .map_err(|error| format!("Scout could not encode the recording: {error}"))?;
    let utterance =
        Utterance::from_wav(wav).map_err(|error| format!("Scout did not send that: {error}."))?;
    let trigger = match recorded.trigger {
        scout_voice::Trigger::Wake => VoiceTrigger::WakeWord,
        scout_voice::Trigger::PushToTalk => VoiceTrigger::PushToTalk,
    };
    Ok(SpokenTurn {
        utterance: PlayerAuthored::from_voice_capture(utterance),
        trigger,
        conversation_id,
        game: live
            .and_then(live_game)
            .or_else(|| champ_select.and_then(champ_select_game)),
    })
}

#[cfg(test)]
mod tests {
    use scout_explore_client::voice::VoiceTrigger;
    use scout_voice::{EndReason, Trigger, Utterance};
    use uuid::Uuid;

    use super::spoken_turn;

    fn recorded(seconds: usize, trigger: Trigger) -> Utterance {
        Utterance {
            samples: vec![0.25; seconds * 16_000],
            trigger,
            reason: EndReason::PushToTalkReleased,
            wake_score: None,
        }
    }

    #[test]
    fn a_recording_becomes_a_checked_wav_with_its_trigger() -> Result<(), String> {
        let conversation = Uuid::from_u128(7);
        let turn = spoken_turn(
            &recorded(2, Trigger::PushToTalk),
            Some(conversation),
            None,
            None,
        )?;
        assert_eq!(turn.trigger, VoiceTrigger::PushToTalk);
        assert_eq!(turn.conversation_id, Some(conversation));
        assert_eq!(turn.utterance.get().duration_ms(), 2_000);
        assert!(turn.game.is_none());
        let wake = spoken_turn(&recorded(1, Trigger::Wake), None, None, None)?;
        assert_eq!(wake.trigger, VoiceTrigger::WakeWord);
        Ok(())
    }

    #[test]
    fn a_tap_too_short_to_hold_a_question_is_not_sent() {
        let tap = Utterance {
            samples: vec![0.25; 160],
            ..recorded(0, Trigger::PushToTalk)
        };
        let error = spoken_turn(&tap, None, None, None)
            .err()
            .unwrap_or_default();
        assert!(error.contains("too short"), "{error}");
    }
}
