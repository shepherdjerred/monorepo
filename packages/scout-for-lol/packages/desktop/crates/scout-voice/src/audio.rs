//! Audio sources: the microphone (see `capture`) and WAV files.

use std::io::Cursor;
use std::path::Path;

use crate::error::VoiceError;

/// The shape of the samples a source produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    /// Frames per second.
    pub sample_rate_hz: u32,
    /// Interleaved channels per frame.
    pub channels: u16,
}

/// A source of interleaved `f32` samples in `[-1, 1]`.
pub trait AudioInput {
    /// The format every chunk is in.
    fn format(&self) -> AudioFormat;

    /// The next chunk of whole frames, or `None` when the source has ended.
    /// A live source blocks until audio arrives.
    ///
    /// # Errors
    ///
    /// Returns the device or decoding error that stopped the source.
    fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, VoiceError>;
}

/// A WAV file played as if it were a device, in chunks whose sizes cycle
/// through a pattern, so tests see the irregular buffers real devices deliver.
#[derive(Debug, Clone)]
pub struct FileInput {
    format: AudioFormat,
    samples: Vec<f32>,
    position: usize,
    chunk_frames: Vec<usize>,
    next_pattern: usize,
}

impl FileInput {
    /// Open a 16-bit PCM or 32-bit float WAV file.
    ///
    /// # Errors
    ///
    /// Fails if the file cannot be read or is in another sample format.
    pub fn open(path: &Path) -> Result<Self, VoiceError> {
        let bytes = std::fs::read(path).map_err(|source| VoiceError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_wav_bytes(&bytes)
    }

    /// Decode WAV bytes already in memory.
    ///
    /// # Errors
    ///
    /// Fails on a malformed file or an unsupported sample format.
    pub fn from_wav_bytes(bytes: &[u8]) -> Result<Self, VoiceError> {
        let (format, samples) = read_wav(bytes)?;
        Ok(Self::from_samples(format, samples))
    }

    /// Play samples already decoded.
    #[must_use]
    pub fn from_samples(format: AudioFormat, samples: Vec<f32>) -> Self {
        Self {
            format,
            samples,
            position: 0,
            chunk_frames: vec![320],
            next_pattern: 0,
        }
    }

    /// Deliver chunks of these frame counts, cycling. Zero entries are ignored.
    #[must_use]
    pub fn with_chunk_frames(mut self, pattern: &[usize]) -> Self {
        let pattern: Vec<usize> = pattern
            .iter()
            .copied()
            .filter(|frames| *frames > 0)
            .collect();
        if !pattern.is_empty() {
            self.chunk_frames = pattern;
        }
        self
    }

    /// Every decoded sample, interleaved.
    #[must_use]
    pub fn samples(&self) -> &[f32] {
        &self.samples
    }
}

impl AudioInput for FileInput {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, VoiceError> {
        if self.position >= self.samples.len() {
            return Ok(None);
        }
        let frames = self.chunk_frames[self.next_pattern % self.chunk_frames.len()];
        self.next_pattern = self.next_pattern.wrapping_add(1);
        let end = self
            .position
            .saturating_add(frames.saturating_mul(usize::from(self.format.channels)))
            .min(self.samples.len());
        let chunk = self.samples[self.position..end].to_vec();
        self.position = end;
        Ok(Some(chunk))
    }
}

/// Decode a WAV file's interleaved samples.
///
/// # Errors
///
/// Fails on a malformed file or a format other than 16-bit PCM or 32-bit float.
pub fn read_wav(bytes: &[u8]) -> Result<(AudioFormat, Vec<f32>), VoiceError> {
    let reader = hound::WavReader::new(Cursor::new(bytes))?;
    let spec = reader.spec();
    let format = AudioFormat {
        sample_rate_hz: spec.sample_rate,
        channels: spec.channels,
    };
    let samples = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Int, 16) => reader
            .into_samples::<i16>()
            .map(|sample| sample.map(|value| f32::from(value) / 32_768.0))
            .collect::<Result<Vec<f32>, _>>()?,
        (hound::SampleFormat::Float, 32) => {
            reader.into_samples::<f32>().collect::<Result<_, _>>()?
        }
        (sample_format, bits) => {
            return Err(VoiceError::UnsupportedAudio(format!(
                "{bits}-bit {sample_format:?} WAV"
            )));
        }
    };
    Ok((format, samples))
}
