//! The capture state machine, as a pure transition function.

/// What started a capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// "hey scout", spotted and then verified.
    Wake,
    /// The push-to-talk key.
    PushToTalk,
}

/// Why a capture ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    /// The VAD saw speech end in silence.
    EndOfSpeech,
    /// The push-to-talk key was released.
    PushToTalkReleased,
    /// The capture reached the contract's limit.
    MaxDuration,
}

/// Where the cascade is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceState {
    /// The microphone is closed: conversation mode is off and push-to-talk
    /// is not held. Audio is dropped.
    Idle,
    /// Listening for the wake word, holding only a short rolling pre-roll.
    Armed,
    /// Recording an utterance.
    Capturing {
        /// What started it.
        trigger: Trigger,
        /// Whether a wake candidate has passed the phrase verifier. A
        /// push-to-talk capture needs no verification and is always `true`.
        verified: bool,
    },
    /// An utterance is ready. Audio is dropped until the turn is finished,
    /// so Scout's own spoken answer cannot wake it.
    Ended {
        /// What started it.
        trigger: Trigger,
        /// Why it ended.
        reason: EndReason,
    },
}

/// An input to the state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceEvent {
    /// Conversation mode turned on (the game started).
    ConversationOpened,
    /// Conversation mode turned off (the game ended).
    ConversationClosed,
    /// The keyword spotter matched a fragment.
    WakeCandidate,
    /// The phrase verifier accepted the candidate.
    WakeVerified,
    /// The phrase verifier rejected the candidate.
    WakeRejected,
    /// The push-to-talk key went down.
    PushToTalkPressed,
    /// The push-to-talk key came up.
    PushToTalkReleased,
    /// The VAD saw speech end.
    SpeechEnded,
    /// The capture reached its limit.
    MaxDurationReached,
    /// The caller took the utterance and the turn is over.
    TurnFinished,
}

/// The state plus whether conversation mode is on, which decides where a
/// finished or abandoned capture returns to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoiceMachine {
    /// The current state.
    pub state: VoiceState,
    /// Whether conversation mode is on.
    pub conversation_open: bool,
}

impl Default for VoiceMachine {
    fn default() -> Self {
        Self {
            state: VoiceState::Idle,
            conversation_open: false,
        }
    }
}

impl VoiceMachine {
    /// Where the machine rests between captures.
    #[must_use]
    pub fn resting(conversation_open: bool) -> VoiceState {
        if conversation_open {
            VoiceState::Armed
        } else {
            VoiceState::Idle
        }
    }

    /// The machine after `event`. Events that do not apply in the current
    /// state leave it unchanged.
    #[must_use]
    pub fn step(self, event: VoiceEvent) -> Self {
        use VoiceEvent as E;
        use VoiceState as S;
        let rest = Self::resting(self.conversation_open);
        let state = match (self.state, event) {
            (S::Idle, E::ConversationOpened) => S::Armed,
            // Closing conversation mode drops a hands-free capture, but a
            // push-to-talk capture is the user holding the key on purpose.
            (
                S::Armed
                | S::Capturing {
                    trigger: Trigger::Wake,
                    ..
                },
                E::ConversationClosed,
            ) => S::Idle,
            (S::Armed, E::WakeCandidate) => S::Capturing {
                trigger: Trigger::Wake,
                verified: false,
            },
            (
                S::Capturing {
                    trigger: Trigger::Wake,
                    verified: false,
                },
                E::WakeVerified,
            ) => S::Capturing {
                trigger: Trigger::Wake,
                verified: true,
            },
            (S::Idle | S::Armed | S::Capturing { .. }, E::PushToTalkPressed) => S::Capturing {
                trigger: Trigger::PushToTalk,
                verified: true,
            },
            (
                S::Capturing {
                    trigger: Trigger::PushToTalk,
                    ..
                },
                E::PushToTalkReleased,
            ) => S::Ended {
                trigger: Trigger::PushToTalk,
                reason: EndReason::PushToTalkReleased,
            },
            (
                S::Capturing {
                    trigger: Trigger::Wake,
                    verified: true,
                },
                E::SpeechEnded,
            ) => S::Ended {
                trigger: Trigger::Wake,
                reason: EndReason::EndOfSpeech,
            },
            (
                S::Capturing {
                    trigger,
                    verified: true,
                },
                E::MaxDurationReached,
            ) => S::Ended {
                trigger,
                reason: EndReason::MaxDuration,
            },
            (
                S::Capturing {
                    trigger: Trigger::Wake,
                    verified: false,
                },
                E::WakeRejected | E::MaxDurationReached,
            )
            | (S::Ended { .. }, E::TurnFinished) => rest,
            (state, _) => state,
        };
        let conversation_open = match event {
            E::ConversationOpened => true,
            E::ConversationClosed => false,
            _ => self.conversation_open,
        };
        Self {
            state,
            conversation_open,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{EndReason, Trigger, VoiceEvent as E, VoiceMachine, VoiceState as S};

    fn run(events: &[E]) -> VoiceMachine {
        events
            .iter()
            .fold(VoiceMachine::default(), |machine, event| {
                machine.step(*event)
            })
    }

    #[test]
    fn it_starts_idle_and_arms_when_conversation_opens() {
        assert_eq!(VoiceMachine::default().state, S::Idle);
        assert_eq!(run(&[E::ConversationOpened]).state, S::Armed);
    }

    #[test]
    fn a_wake_word_needs_verification_before_end_of_speech_counts() {
        let candidate = run(&[E::ConversationOpened, E::WakeCandidate]);
        assert_eq!(
            candidate.state,
            S::Capturing {
                trigger: Trigger::Wake,
                verified: false
            }
        );
        assert_eq!(candidate.step(E::SpeechEnded), candidate);
        let ended = candidate.step(E::WakeVerified).step(E::SpeechEnded);
        assert_eq!(
            ended.state,
            S::Ended {
                trigger: Trigger::Wake,
                reason: EndReason::EndOfSpeech
            }
        );
        assert_eq!(ended.step(E::TurnFinished).state, S::Armed);
    }

    #[test]
    fn a_rejected_or_timed_out_candidate_returns_to_listening() {
        assert_eq!(
            run(&[E::ConversationOpened, E::WakeCandidate, E::WakeRejected]).state,
            S::Armed
        );
        assert_eq!(
            run(&[
                E::ConversationOpened,
                E::WakeCandidate,
                E::MaxDurationReached
            ])
            .state,
            S::Armed
        );
    }

    #[test]
    fn a_verified_capture_ends_at_the_limit() {
        let machine = run(&[
            E::ConversationOpened,
            E::WakeCandidate,
            E::WakeVerified,
            E::MaxDurationReached,
        ]);
        assert_eq!(
            machine.state,
            S::Ended {
                trigger: Trigger::Wake,
                reason: EndReason::MaxDuration
            }
        );
    }

    #[test]
    fn push_to_talk_works_with_conversation_mode_off() {
        let held = run(&[E::PushToTalkPressed]);
        assert_eq!(
            held.state,
            S::Capturing {
                trigger: Trigger::PushToTalk,
                verified: true
            }
        );
        let released = held.step(E::PushToTalkReleased);
        assert_eq!(
            released.state,
            S::Ended {
                trigger: Trigger::PushToTalk,
                reason: EndReason::PushToTalkReleased
            }
        );
        assert_eq!(released.step(E::TurnFinished).state, S::Idle);
    }

    #[test]
    fn push_to_talk_takes_over_a_wake_capture_and_ignores_end_of_speech() {
        let machine = run(&[
            E::ConversationOpened,
            E::WakeCandidate,
            E::PushToTalkPressed,
            E::SpeechEnded,
        ]);
        assert_eq!(
            machine.state,
            S::Capturing {
                trigger: Trigger::PushToTalk,
                verified: true
            }
        );
    }

    #[test]
    fn closing_conversation_mode_drops_a_hands_free_capture_only() {
        assert_eq!(
            run(&[
                E::ConversationOpened,
                E::WakeCandidate,
                E::ConversationClosed
            ])
            .state,
            S::Idle
        );
        let push_to_talk = run(&[
            E::ConversationOpened,
            E::PushToTalkPressed,
            E::ConversationClosed,
        ]);
        assert!(matches!(
            push_to_talk.state,
            S::Capturing {
                trigger: Trigger::PushToTalk,
                ..
            }
        ));
        assert_eq!(
            push_to_talk
                .step(E::PushToTalkReleased)
                .step(E::TurnFinished)
                .state,
            S::Idle
        );
    }

    #[test]
    fn an_ended_turn_ignores_audio_events_until_finished() {
        let ended = run(&[E::PushToTalkPressed, E::PushToTalkReleased]);
        for event in [
            E::WakeCandidate,
            E::WakeVerified,
            E::SpeechEnded,
            E::MaxDurationReached,
            E::PushToTalkReleased,
        ] {
            assert_eq!(ended.step(event).state, ended.state);
        }
    }

    #[test]
    fn idle_ignores_wake_events() {
        for event in [
            E::WakeCandidate,
            E::WakeVerified,
            E::SpeechEnded,
            E::TurnFinished,
        ] {
            assert_eq!(VoiceMachine::default().step(event).state, S::Idle);
        }
    }
}
