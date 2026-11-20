//! The cascade: pre-roll, keyword spotting, verification, end of speech.
//!
//! A port of the capture half of
//! `packages/voice-assistant/src/audio/audio-lifecycle.ts` for one local
//! speaker. The pipeline never opens a device or a socket: it takes 16 kHz
//! mono samples and returns [`Utterance`]s.

use std::collections::VecDeque;

use scout_client_core::live::gameflow::GameflowPhase;

use crate::contract::{VoiceCascade, ms_to_samples};
use crate::conversation::conversation_open;
use crate::detect::{KeywordHit, KeywordSpotter, VoiceActivity, WakeVerifier};
use crate::error::VoiceError;
use crate::state::{Trigger, VoiceEvent, VoiceMachine, VoiceState};
use crate::utterance::Utterance;

/// Something the pipeline did, stamped with the input sample it happened at.
/// The spike's latency numbers are measured from these.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineEvent {
    /// Samples accepted since the pipeline was created.
    pub at_sample: u64,
    /// What happened.
    pub kind: PipelineEventKind,
}

/// The kinds of [`PipelineEvent`].
#[derive(Debug, Clone, PartialEq)]
pub enum PipelineEventKind {
    /// The spotter matched a fragment.
    Candidate {
        /// The fragment label.
        fragment: String,
    },
    /// The verifier accepted.
    Verified {
        /// Its score.
        score: f32,
    },
    /// The verifier rejected.
    Rejected {
        /// Its score.
        score: f32,
    },
    /// A capture ended and produced an utterance.
    Ended,
}

/// The cascade over three detectors.
#[derive(Debug)]
pub struct VoicePipeline<K, V, W> {
    machine: VoiceMachine,
    spotter: K,
    vad: V,
    verifier: W,
    contract: VoiceCascade,
    frame_samples: usize,
    pre_roll_samples: usize,
    max_utterance_samples: usize,
    post_verification_samples: usize,
    frame: Vec<f32>,
    pre_roll: VecDeque<f32>,
    capture: Vec<f32>,
    spotter_stream_samples: usize,
    post_candidate: usize,
    verification_target: usize,
    after_verification: usize,
    saw_speech: bool,
    speech_completed: bool,
    wake_score: Option<f32>,
    delivered: bool,
    total_samples: u64,
    events: Vec<PipelineEvent>,
}

impl<K: KeywordSpotter, V: VoiceActivity, W: WakeVerifier> VoicePipeline<K, V, W> {
    /// A pipeline in [`VoiceState::Idle`].
    #[must_use]
    pub fn new(contract: VoiceCascade, spotter: K, vad: V, verifier: W) -> Self {
        let frame_samples = ms_to_samples(contract.audio.frame_ms);
        let pre_roll_samples = ms_to_samples(contract.utterance.pre_roll_ms);
        Self {
            machine: VoiceMachine::default(),
            spotter,
            vad,
            verifier,
            frame_samples,
            pre_roll_samples,
            max_utterance_samples: ms_to_samples(contract.utterance.max_utterance_ms),
            post_verification_samples: ms_to_samples(contract.utterance.post_verification_ms),
            contract,
            frame: Vec::with_capacity(frame_samples),
            pre_roll: VecDeque::with_capacity(pre_roll_samples),
            capture: Vec::new(),
            spotter_stream_samples: 0,
            post_candidate: 0,
            verification_target: 0,
            after_verification: 0,
            saw_speech: false,
            speech_completed: false,
            wake_score: None,
            delivered: false,
            total_samples: 0,
            events: Vec::new(),
        }
    }

    /// The current state.
    #[must_use]
    pub fn state(&self) -> VoiceState {
        self.machine.state
    }

    /// Whether the microphone should be open: listening or recording.
    #[must_use]
    pub fn wants_microphone(&self) -> bool {
        matches!(
            self.machine.state,
            VoiceState::Armed | VoiceState::Capturing { .. }
        )
    }

    /// The keyword spotter.
    #[must_use]
    pub fn spotter(&self) -> &K {
        &self.spotter
    }

    /// The VAD.
    #[must_use]
    pub fn vad(&self) -> &V {
        &self.vad
    }

    /// The phrase verifier.
    #[must_use]
    pub fn verifier(&self) -> &W {
        &self.verifier
    }

    /// Take the events recorded since the last call.
    pub fn drain_events(&mut self) -> Vec<PipelineEvent> {
        std::mem::take(&mut self.events)
    }

    /// Follow League's gameflow: conversation mode is on only in game.
    pub fn set_gameflow_phase(&mut self, phase: &GameflowPhase) {
        self.set_conversation_open(conversation_open(phase));
    }

    /// Turn hands-free listening on or off. The app decides this from the
    /// gameflow phase together with the player's own choices (opted in, not
    /// muted, conversation mode on).
    pub fn set_conversation_open(&mut self, open: bool) {
        if open != self.machine.conversation_open {
            self.apply(if open {
                VoiceEvent::ConversationOpened
            } else {
                VoiceEvent::ConversationClosed
            });
        }
    }

    /// The push-to-talk key changed. Releasing it ends the capture.
    pub fn push_to_talk(&mut self, pressed: bool) -> Option<Utterance> {
        if pressed {
            // A wake capture keeps its audio when the key takes over; an
            // ended turn ignores the key until it is finished.
            if matches!(self.machine.state, VoiceState::Idle | VoiceState::Armed) {
                self.start_capture(Vec::new());
            }
            self.apply(VoiceEvent::PushToTalkPressed);
            None
        } else {
            self.apply(VoiceEvent::PushToTalkReleased);
            self.take_if_ended()
        }
    }

    /// The caller is done with the last utterance; listening resumes.
    pub fn finish_turn(&mut self) {
        self.apply(VoiceEvent::TurnFinished);
    }

    /// Feed 16 kHz mono samples of any length.
    ///
    /// # Errors
    ///
    /// Returns a detector failure, or a fragment with no tail in the contract.
    pub fn accept(&mut self, samples: &[f32]) -> Result<Option<Utterance>, VoiceError> {
        let mut utterance = None;
        for sample in samples {
            self.frame.push(*sample);
            if self.frame.len() == self.frame_samples {
                let frame =
                    std::mem::replace(&mut self.frame, Vec::with_capacity(self.frame_samples));
                if let Some(ended) = self.process_frame(&frame)? {
                    utterance = Some(ended);
                }
            }
        }
        Ok(utterance)
    }

    fn apply(&mut self, event: VoiceEvent) {
        let before = self.machine.state;
        self.machine = self.machine.step(event);
        let dropped_capture = matches!(before, VoiceState::Capturing { .. })
            && matches!(self.machine.state, VoiceState::Idle | VoiceState::Armed);
        if dropped_capture || matches!(self.machine.state, VoiceState::Idle) {
            self.capture.fill(0.0);
            self.capture.clear();
        }
        if matches!(self.machine.state, VoiceState::Idle) {
            self.frame.fill(0.0);
            self.frame.clear();
            self.pre_roll.iter_mut().for_each(|sample| *sample = 0.0);
            self.pre_roll.clear();
            self.spotter.reset();
            self.spotter_stream_samples = 0;
        }
    }

    fn record(&mut self, kind: PipelineEventKind) {
        self.events.push(PipelineEvent {
            at_sample: self.total_samples,
            kind,
        });
    }

    fn process_frame(&mut self, frame: &[f32]) -> Result<Option<Utterance>, VoiceError> {
        self.total_samples = self
            .total_samples
            .saturating_add(u64::try_from(frame.len()).unwrap_or(u64::MAX));
        match self.machine.state {
            VoiceState::Idle | VoiceState::Ended { .. } => Ok(None),
            VoiceState::Armed => {
                self.push_pre_roll(frame);
                self.spotter_stream_samples += frame.len();
                if let Some(hit) = self.spotter.accept(frame)? {
                    self.begin_wake(&hit)?;
                    return self.after_capture_frame();
                }
                Ok(None)
            }
            VoiceState::Capturing { .. } => {
                self.capture.extend_from_slice(frame);
                self.post_candidate += frame.len();
                if matches!(
                    self.machine.state,
                    VoiceState::Capturing { verified: true, .. }
                ) {
                    self.after_verification += frame.len();
                }
                self.vad.accept(frame);
                self.observe_vad();
                self.after_capture_frame()
            }
        }
    }

    fn push_pre_roll(&mut self, frame: &[f32]) {
        self.pre_roll.extend(frame.iter().copied());
        let excess = self.pre_roll.len().saturating_sub(self.pre_roll_samples);
        for _ in 0..excess {
            self.pre_roll.pop_front();
        }
    }

    fn observe_vad(&mut self) {
        if self.vad.speech_active() {
            self.saw_speech = true;
        }
        if self.saw_speech && self.vad.completed_speech() {
            self.speech_completed = true;
        }
    }

    fn start_capture(&mut self, initial: Vec<f32>) {
        self.capture = initial;
        self.post_candidate = 0;
        self.after_verification = 0;
        self.saw_speech = false;
        self.speech_completed = false;
        self.wake_score = None;
        self.delivered = false;
        self.vad.reset();
    }

    fn begin_wake(&mut self, hit: &KeywordHit) -> Result<(), VoiceError> {
        self.verification_target = self.verification_target(hit)?;
        self.record(PipelineEventKind::Candidate {
            fragment: hit.fragment.clone(),
        });
        let pre_roll: Vec<f32> = self.pre_roll.drain(..).collect();
        // Prime the VAD with the whole retained pre-roll, so speech that ended
        // before the spotter fired still counts and endpointing can complete.
        self.start_capture(pre_roll.clone());
        for frame in pre_roll.chunks(self.frame_samples) {
            self.vad.accept(frame);
            self.observe_vad();
        }
        // sherpa resets its stream on a match, so timestamps restart here.
        self.spotter_stream_samples = 0;
        self.apply(VoiceEvent::WakeCandidate);
        Ok(())
    }

    /// How much more audio to collect before scoring the verifier, anchored
    /// to the fragment's own timestamp rather than to when the spotter fired.
    fn verification_target(&self, hit: &KeywordHit) -> Result<usize, VoiceError> {
        let wake = &self.contract.wake;
        let Some(fragment_end_seconds) = hit.fragment_end_seconds else {
            return Ok(ms_to_samples(wake.verification_delay_ms));
        };
        let tail_ms = wake
            .fragment_tail_ms
            .get(&hit.fragment)
            .ok_or_else(|| VoiceError::UnknownFragment(hit.fragment.clone()))?;
        let tail = ms_to_samples(tail_ms.saturating_add(wake.fragment_tail_margin_ms));
        let fragment_end = seconds_to_samples(fragment_end_seconds);
        let already_collected = self.spotter_stream_samples.saturating_sub(fragment_end);
        Ok(tail.saturating_sub(already_collected))
    }

    fn after_capture_frame(&mut self) -> Result<Option<Utterance>, VoiceError> {
        let unverified_wake = matches!(
            self.machine.state,
            VoiceState::Capturing {
                trigger: Trigger::Wake,
                verified: false
            }
        );
        if unverified_wake && self.post_candidate >= self.verification_target {
            let verification = self.verifier.verify(&self.capture)?;
            if verification.accepted {
                self.wake_score = Some(verification.score);
                self.record(PipelineEventKind::Verified {
                    score: verification.score,
                });
                self.apply(VoiceEvent::WakeVerified);
            } else {
                self.record(PipelineEventKind::Rejected {
                    score: verification.score,
                });
                self.apply(VoiceEvent::WakeRejected);
                self.spotter.reset();
                return Ok(None);
            }
        }
        let verified_wake = matches!(
            self.machine.state,
            VoiceState::Capturing {
                trigger: Trigger::Wake,
                verified: true
            }
        );
        if verified_wake
            && self.speech_completed
            && self.after_verification >= self.post_verification_samples
        {
            self.apply(VoiceEvent::SpeechEnded);
        } else if matches!(self.machine.state, VoiceState::Capturing { .. })
            && self.capture.len() >= self.max_utterance_samples
        {
            self.apply(VoiceEvent::MaxDurationReached);
        }
        Ok(self.take_if_ended())
    }

    fn take_if_ended(&mut self) -> Option<Utterance> {
        let VoiceState::Ended { trigger, reason } = self.machine.state else {
            return None;
        };
        if self.delivered {
            return None;
        }
        self.delivered = true;
        self.record(PipelineEventKind::Ended);
        self.spotter.reset();
        self.spotter_stream_samples = 0;
        self.pre_roll.clear();
        Some(Utterance {
            samples: std::mem::take(&mut self.capture),
            trigger,
            reason,
            wake_score: self.wake_score.take(),
        })
    }
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a sherpa timestamp is a few seconds into a stream; negative or non-finite values become zero"
)]
fn seconds_to_samples(seconds: f32) -> usize {
    if seconds.is_finite() && seconds > 0.0 {
        (f64::from(seconds) * 16_000.0).round() as usize
    } else {
        0
    }
}
