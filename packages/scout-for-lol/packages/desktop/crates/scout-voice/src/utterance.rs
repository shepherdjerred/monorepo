//! A captured utterance, the cascade's only output.

use std::io::Cursor;

use crate::contract::SAMPLE_RATE_HZ;
use crate::error::VoiceError;
use crate::state::{EndReason, Trigger};

/// One captured utterance in 16 kHz mono. It exists only in memory; sending
/// it anywhere is the caller's decision.
#[derive(Debug, Clone, PartialEq)]
pub struct Utterance {
    /// The samples, including the wake pre-roll for a wake capture.
    pub samples: Vec<f32>,
    /// What started the capture.
    pub trigger: Trigger,
    /// Why it ended.
    pub reason: EndReason,
    /// The phrase verifier's score for a wake capture.
    pub wake_score: Option<f32>,
}

impl Utterance {
    /// The utterance's length in milliseconds.
    #[must_use]
    pub fn duration_ms(&self) -> u64 {
        u64::try_from(self.samples.len()).map_or(u64::MAX, |samples| samples / 16)
    }

    /// Encode as a 16-bit PCM mono WAV file.
    ///
    /// # Errors
    ///
    /// Fails only if the encoder does.
    pub fn to_wav(&self) -> Result<Vec<u8>, VoiceError> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE_HZ,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut bytes = Cursor::new(Vec::new());
        let mut writer = hound::WavWriter::new(&mut bytes, spec)?;
        for sample in &self.samples {
            writer.write_sample(pcm16(*sample))?;
        }
        writer.finalize()?;
        Ok(bytes.into_inner())
    }

    /// Overwrite the samples, for callers done with the audio.
    pub fn erase(&mut self) {
        self.samples.fill(0.0);
        self.samples.clear();
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the value is clamped to the i16 range before the cast"
)]
fn pcm16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * 32_767.0).round() as i16
}
