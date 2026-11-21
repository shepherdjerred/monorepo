//! Proactive coach turns, which Scout asks for when the scoreboard changes.
//! Beta profile only.
//!
//! Riot's published policy prohibits unprompted alerts from live game state.
//! So this module, [`ExploreClient::start_coach_trigger`], the
//! [`CoachInput::Trigger`] input and the coach panel's `proactive` kind are
//! compiled only into the beta release profile (`cfg(scout_proactive_coach)`,
//! set by each crate's `build.rs`). A stable build has no code that can send
//! a trigger. The server refuses `coach/triggers` in production as well, and
//! it is the authority on spacing, the per-game cap and duplicates.
//!
//! The supervisor's detectors decide what is worth asking about and space
//! their own requests. [`TriggerGate`] decides whether the relay may still ask
//! Scout at all. Every answer other than a started turn stops the game:
//! spacing, the per-game cap, a duplicate, an invalid snapshot or any other
//! refusal. `feature_disabled` stops proactive coaching until the next
//! refresh. Only a request that never got an answer leaves the next detection
//! free to ask.
//!
//! [`ExploreClient::start_coach_trigger`]: crate::ExploreClient::start_coach_trigger
//! [`CoachInput::Trigger`]: crate::app_turns::CoachInput::Trigger

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use scout_client_core::coach_context::GameContext;
use scout_client_core::desktop_api::{
    ActiveRun, CoachTrigger, CoachTriggerRequest, CoachTriggerResponse, CoachTriggerSpeechResponse,
};
use scout_client_core::live::snapshot::LiveSnapshot;
use uuid::Uuid;

use crate::contract::{SPEECH_ENCODING, SPEECH_MAX_CHUNK_BYTES, SPEECH_SAMPLE_RATE_HZ};
use crate::error::{ExploreClientError, Recovery};

/// One proactive coach turn the supervisor's detectors asked for. It carries
/// no text: the server words the question from the trigger.
#[derive(Debug, Clone, PartialEq)]
pub struct ProactiveTurn {
    /// The game it belongs to, which the server's cap and dedupe count by.
    pub game_key: String,
    /// What the detector saw.
    pub trigger: CoachTrigger,
    /// The allowlisted frame it saw it in.
    pub snapshot: LiveSnapshot,
}

impl ProactiveTurn {
    /// The `coach/triggers` body for this turn, continuing `conversation_id`
    /// or starting a new conversation. None when the frame breaks a bound of
    /// the coach contract, which Scout would refuse.
    #[must_use]
    pub fn request(&self, conversation_id: Option<Uuid>) -> Option<CoachTriggerRequest> {
        let snapshot = GameContext::live(&self.snapshot).live?;
        if let Err(error) = snapshot.validate() {
            tracing::warn!(%error, "not asking for a proactive turn over an out-of-bounds frame");
            return None;
        }
        Some(CoachTriggerRequest {
            conversation_id,
            game_key: self.game_key.clone(),
            trigger: self.trigger.clone(),
            snapshot,
        })
    }
}

/// A proactive answer's speech, from `coach/triggers/speech`, checked against
/// the voice turn's speech format.
#[derive(Clone, PartialEq, Eq)]
pub struct ProactiveSpeech {
    /// The answer spoken.
    pub message_id: Uuid,
    /// What is said.
    pub spoken_text: String,
    /// Samples per second.
    pub sample_rate_hz: u32,
    /// Little-endian 16-bit mono PCM.
    pub pcm: Vec<u8>,
}

impl std::fmt::Debug for ProactiveSpeech {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProactiveSpeech")
            .field("message_id", &self.message_id)
            .field("sample_rate_hz", &self.sample_rate_hz)
            .field("bytes", &self.pcm.len())
            .finish_non_exhaustive()
    }
}

impl ProactiveSpeech {
    /// Decode the route's answer.
    ///
    /// # Errors
    ///
    /// A message when the speech breaks the contract's format: another
    /// encoding or rate, a chunk that is not base64, larger than a chunk may
    /// be, or not whole samples.
    pub fn decode(response: CoachTriggerSpeechResponse) -> Result<Self, String> {
        if response.encoding != SPEECH_ENCODING || response.sample_rate_hz != SPEECH_SAMPLE_RATE_HZ
        {
            return Err(format!(
                "speech is {} at {} Hz, not {SPEECH_ENCODING} at {SPEECH_SAMPLE_RATE_HZ} Hz",
                response.encoding, response.sample_rate_hz
            ));
        }
        if response.chunks.is_empty() {
            return Err("speech has no audio".to_owned());
        }
        let mut pcm = Vec::new();
        for chunk in &response.chunks {
            let bytes = STANDARD
                .decode(chunk.as_bytes())
                .map_err(|error| format!("a speech chunk is not base64: {error}"))?;
            let too_large =
                u32::try_from(bytes.len()).map_or(true, |len| len > SPEECH_MAX_CHUNK_BYTES);
            if too_large || bytes.len() % 2 != 0 {
                return Err(format!("a speech chunk of {} bytes", bytes.len()));
            }
            pcm.extend_from_slice(&bytes);
        }
        Ok(Self {
            message_id: response.message_id,
            spoken_text: response.spoken_text,
            sample_rate_hz: response.sample_rate_hz,
            pcm,
        })
    }
}

/// What the relay does with Scout's answer to `coach/triggers`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerVerdict {
    /// Scout started the turn: follow it like any run.
    Started(ActiveRun),
    /// Scout refused or had already admitted this event: ask nothing more
    /// for this game.
    StopGame,
    /// Scout says proactive coaching is off: ask nothing until the next
    /// refresh.
    Disabled,
    /// No answer arrived. The next detection may ask again; the supervisor's
    /// own spacing still holds.
    Unanswered,
}

impl TriggerVerdict {
    /// Read Scout's answer.
    #[must_use]
    pub fn of(result: &Result<CoachTriggerResponse, ExploreClientError>) -> Self {
        match result {
            Ok(CoachTriggerResponse::Started { run }) => Self::Started(run.clone()),
            Err(ExploreClientError::Transport(_)) => Self::Unanswered,
            Err(error) if error.recovery() == Some(Recovery::FeatureDisabled) => Self::Disabled,
            // Scout already admitted this event, or refused it.
            Ok(CoachTriggerResponse::Duplicate) | Err(_) => Self::StopGame,
        }
    }
}

/// Whether the relay may ask Scout for a proactive turn.
#[derive(Debug, Default)]
pub struct TriggerGate {
    /// Scout said `feature_disabled`; cleared by the next refresh.
    disabled: bool,
    /// The game Scout said to stop for.
    stopped_game: Option<String>,
}

impl TriggerGate {
    /// A gate that lets requests through.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a turn for `game_key` may be asked for now.
    #[must_use]
    pub fn admits(&self, game_key: &str) -> bool {
        !self.disabled && self.stopped_game.as_deref() != Some(game_key)
    }

    /// Record Scout's answer for a turn of `game_key`.
    pub fn settle(&mut self, game_key: &str, verdict: &TriggerVerdict) {
        match verdict {
            TriggerVerdict::Started(_) | TriggerVerdict::Unanswered => {}
            TriggerVerdict::StopGame => self.stopped_game = Some(game_key.to_owned()),
            TriggerVerdict::Disabled => {
                self.disabled = true;
                self.stopped_game = Some(game_key.to_owned());
            }
        }
    }

    /// Pairing, a new window or a retry: Scout may have turned proactive
    /// coaching on. A game Scout stopped stays stopped.
    pub fn refresh(&mut self) {
        self.disabled = false;
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use scout_client_core::desktop_api::{
        ActiveRun, CoachTriggerResponse, DesktopApiErrorCode as Code,
    };
    use uuid::Uuid;

    use super::{TriggerGate, TriggerVerdict};
    use crate::error::{ExploreClientError, Refusal};

    fn refused(code: Code) -> ExploreClientError {
        ExploreClientError::Refused(Refusal {
            code,
            message: "no".to_owned(),
            retry_after: None,
        })
    }

    fn run() -> ActiveRun {
        ActiveRun {
            run_id: Uuid::from_u128(1),
            conversation_id: Uuid::from_u128(2),
            question_message_id: Uuid::from_u128(3),
            leaf_id_at_start: None,
            version_count_at_start: 0,
            started_at: Utc::now(),
        }
    }

    #[test]
    fn every_answer_but_a_started_turn_stops_the_game() {
        let started = run();
        assert_eq!(
            TriggerVerdict::of(&Ok(CoachTriggerResponse::Started {
                run: started.clone()
            })),
            TriggerVerdict::Started(started)
        );
        assert_eq!(
            TriggerVerdict::of(&Ok(CoachTriggerResponse::Duplicate)),
            TriggerVerdict::StopGame
        );
        for code in [
            Code::RateLimited,
            Code::QuotaExceeded,
            Code::InvalidGameContext,
            Code::InvalidRequest,
            Code::ConversationBusy,
            Code::Unavailable,
        ] {
            assert_eq!(
                TriggerVerdict::of(&Err(refused(code))),
                TriggerVerdict::StopGame,
                "{code:?}"
            );
        }
        assert_eq!(
            TriggerVerdict::of(&Err(refused(Code::FeatureDisabled))),
            TriggerVerdict::Disabled
        );
        assert_eq!(
            TriggerVerdict::of(&Err(ExploreClientError::Unexpected {
                status: 500,
                detail: "boom".to_owned(),
            })),
            TriggerVerdict::StopGame
        );
    }

    #[test]
    fn a_stopped_game_stays_stopped_and_the_next_game_may_ask() {
        let mut gate = TriggerGate::new();
        assert!(gate.admits("g-1"));
        gate.settle("g-1", &TriggerVerdict::Unanswered);
        assert!(gate.admits("g-1"), "no answer is not a refusal");
        gate.settle("g-1", &TriggerVerdict::StopGame);
        assert!(!gate.admits("g-1"));
        gate.refresh();
        assert!(
            !gate.admits("g-1"),
            "a refresh does not undo Scout's answer"
        );
        assert!(gate.admits("g-2"));
    }

    #[test]
    fn feature_disabled_stops_every_game_until_the_next_refresh() {
        let mut gate = TriggerGate::new();
        gate.settle("g-1", &TriggerVerdict::Disabled);
        assert!(!gate.admits("g-1"));
        assert!(!gate.admits("g-2"));
        gate.refresh();
        assert!(gate.admits("g-2"));
        assert!(!gate.admits("g-1"));
    }
}
