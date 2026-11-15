//! Downmix to mono and resample to 16 kHz.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

use crate::audio::AudioFormat;
use crate::contract::SAMPLE_RATE_HZ;
use crate::error::VoiceError;

/// Input frames per resampler call: about 21 ms at 48 kHz.
const CHUNK_FRAMES: usize = 1024;

/// Converts any device format to the 16 kHz mono the models take.
///
/// Rubato's synchronous FFT resampler is used because the device rate is
/// fixed for a stream's life; a device change rebuilds the stream and this
/// converter with it.
pub struct MonoResampler {
    channels: usize,
    resampler: Option<Fft<f32>>,
    pending: Vec<f32>,
    output: Vec<f32>,
}

impl std::fmt::Debug for MonoResampler {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MonoResampler")
            .field("channels", &self.channels)
            .field("resampling", &self.resampler.is_some())
            .field("pending", &self.pending.len())
            .finish_non_exhaustive()
    }
}

impl MonoResampler {
    /// A converter from `input` to 16 kHz mono.
    ///
    /// # Errors
    ///
    /// Fails on zero channels or a rate rubato cannot convert.
    pub fn new(input: AudioFormat) -> Result<Self, VoiceError> {
        if input.channels == 0 || input.sample_rate_hz == 0 {
            return Err(VoiceError::UnsupportedAudio(format!("{input:?}")));
        }
        let resampler = if input.sample_rate_hz == SAMPLE_RATE_HZ {
            None
        } else {
            let rate = |hz: u32| {
                usize::try_from(hz).map_err(|error| VoiceError::Resample(error.to_string()))
            };
            let resampler = Fft::<f32>::new(
                rate(input.sample_rate_hz)?,
                rate(SAMPLE_RATE_HZ)?,
                CHUNK_FRAMES,
                1,
                FixedSync::Input,
            )
            .map_err(|error| VoiceError::Resample(error.to_string()))?;
            Some(resampler)
        };
        let output = vec![0.0; resampler.as_ref().map_or(0, Resampler::output_frames_max)];
        Ok(Self {
            channels: usize::from(input.channels),
            resampler,
            pending: Vec::with_capacity(CHUNK_FRAMES * 2),
            output,
        })
    }

    /// Output frames of delay the resampler adds; zero when passing through.
    #[must_use]
    pub fn delay_frames(&self) -> usize {
        self.resampler.as_ref().map_or(0, Resampler::output_delay)
    }

    /// Convert one interleaved chunk. Output may be empty while the resampler
    /// fills its first chunk.
    ///
    /// # Errors
    ///
    /// Fails on a partial frame or a resampler error.
    pub fn process(&mut self, interleaved: &[f32]) -> Result<Vec<f32>, VoiceError> {
        if !interleaved.len().is_multiple_of(self.channels) {
            return Err(VoiceError::UnsupportedAudio(format!(
                "a chunk of {} samples is not whole {}-channel frames",
                interleaved.len(),
                self.channels
            )));
        }
        let mono = downmix(interleaved, self.channels);
        if self.resampler.is_none() {
            return Ok(mono);
        }
        self.pending.extend_from_slice(&mono);
        self.drain()
    }

    /// Push out what is buffered by padding the last chunk with silence.
    ///
    /// # Errors
    ///
    /// Fails on a resampler error.
    pub fn flush(&mut self) -> Result<Vec<f32>, VoiceError> {
        let Some(resampler) = self.resampler.as_ref() else {
            return Ok(Vec::new());
        };
        if self.pending.is_empty() {
            return Ok(Vec::new());
        }
        let needed = resampler.input_frames_next();
        if self.pending.len() < needed {
            self.pending.resize(needed, 0.0);
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<f32>, VoiceError> {
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(Vec::new());
        };
        let mut converted = Vec::new();
        let resample_error =
            |error: &dyn std::fmt::Display| VoiceError::Resample(error.to_string());
        loop {
            let needed = resampler.input_frames_next();
            if self.pending.len() < needed {
                break;
            }
            let input = InterleavedSlice::new(&self.pending[..needed], 1, needed)
                .map_err(|error| resample_error(&error))?;
            let capacity = self.output.len();
            let mut output = InterleavedSlice::new_mut(&mut self.output, 1, capacity)
                .map_err(|error| resample_error(&error))?;
            let (read, written) = resampler
                .process_into_buffer(&input, &mut output, None)
                .map_err(|error| resample_error(&error))?;
            converted.extend_from_slice(&self.output[..written]);
            self.pending.drain(..read);
        }
        Ok(converted)
    }
}

/// Average interleaved channels into one.
#[must_use]
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let scale = 1.0 / f32::from(u16::try_from(channels).unwrap_or(u16::MAX));
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() * scale)
        .collect()
}
