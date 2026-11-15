//! Scout Desktop's local voice cascade: microphone capture, resampling to
//! 16 kHz mono, "hey scout" keyword spotting, phrase verification, end of
//! speech, and push-to-talk, producing WAV utterances.
//!
//! Nothing here opens a socket. The microphone never streams anywhere; the
//! crate's only output is an in-memory [`Utterance`], and sending it to the
//! server is the caller's decision.
//!
//! The microphone ([`capture`]) and the sherpa-onnx detectors ([`sherpa`])
//! build only on Windows and macOS. Everything else, including the tract
//! phrase verifier, builds and is tested on every target.

pub mod audio;
#[cfg(any(windows, target_os = "macos"))]
pub mod capture;
pub mod contract;
pub mod conversation;
pub mod detect;
pub mod error;
pub mod models;
pub mod pipeline;
pub mod resample;
#[cfg(any(windows, target_os = "macos"))]
pub mod sherpa;
pub mod state;
pub mod utterance;
pub mod verifier;

pub use audio::{AudioFormat, AudioInput, FileInput};
pub use contract::VoiceCascade;
pub use detect::{KeywordHit, KeywordSpotter, Verification, VoiceActivity, WakeVerifier};
pub use error::VoiceError;
pub use pipeline::{PipelineEvent, PipelineEventKind, VoicePipeline};
pub use resample::MonoResampler;
pub use state::{EndReason, Trigger, VoiceEvent, VoiceMachine, VoiceState};
pub use utterance::Utterance;
