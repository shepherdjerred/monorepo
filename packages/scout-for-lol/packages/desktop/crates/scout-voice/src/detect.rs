//! The three local detectors, behind traits so the pipeline runs on fakes in
//! CI and on sherpa-onnx and tract on a desktop.

use crate::error::VoiceError;

/// A keyword fragment the spotter matched.
#[derive(Debug, Clone, PartialEq)]
pub struct KeywordHit {
    /// The fragment label from the keywords file, such as `HEY_SCOUT`.
    pub fragment: String,
    /// When the fragment's last token began, in seconds since the spotter
    /// last reset; `None` when the runtime reports no timestamps.
    pub fragment_end_seconds: Option<f32>,
}

/// A streaming keyword spotter over 16 kHz mono audio. It is permissive: a
/// hit is only a candidate until the [`WakeVerifier`] accepts it.
pub trait KeywordSpotter {
    /// Feed samples; returns a hit once a fragment completes. The spotter
    /// resets itself after a hit.
    ///
    /// # Errors
    ///
    /// Returns a runtime failure.
    fn accept(&mut self, samples: &[f32]) -> Result<Option<KeywordHit>, VoiceError>;

    /// Forget all state.
    fn reset(&mut self);
}

/// End-of-speech detection over 16 kHz mono audio.
pub trait VoiceActivity {
    /// Feed samples.
    fn accept(&mut self, samples: &[f32]);

    /// Whether speech is in progress now.
    fn speech_active(&self) -> bool;

    /// Whether a speech segment has started and then ended in silence.
    fn completed_speech(&self) -> bool;

    /// Forget all state, ready for the next capture.
    fn reset(&mut self);
}

/// A phrase verifier's verdict.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Verification {
    /// Whether the score reached the trained threshold.
    pub accepted: bool,
    /// The classifier's score in `[0, 1]`.
    pub score: f32,
}

/// Scores the last verifier window of audio for the wake phrase.
pub trait WakeVerifier {
    /// Score `samples`; only the trailing window is used, and shorter input
    /// is padded with leading silence.
    ///
    /// # Errors
    ///
    /// Returns an inference failure.
    fn verify(&mut self, samples: &[f32]) -> Result<Verification, VoiceError>;
}
