//! Playing Scout's spoken answer.
//!
//! The server streams the answer's speech as 16-bit mono PCM chunks.
//! [`SpeechOutput`] queues them on the default output device; tests use a
//! fake that records what it was given. Nothing here records anything.

use std::time::Duration;

use crate::error::VoiceError;

/// Where spoken answers play.
pub trait SpeechOutput: Send {
    /// Queue `pcm`, mono samples at `sample_rate_hz`, after whatever is
    /// already queued.
    ///
    /// # Errors
    ///
    /// Returns why the output device could not take the audio.
    fn enqueue(&mut self, sample_rate_hz: u32, pcm: &[i16]) -> Result<(), VoiceError>;

    /// How much queued audio has not played yet.
    fn pending(&self) -> Duration;

    /// Drop whatever is queued and fall silent.
    fn stop(&mut self);
}

/// Decode `pcm_s16le` bytes into samples.
///
/// # Errors
///
/// Returns [`VoiceError::UnsupportedAudio`] for an odd byte count.
pub fn pcm_s16le(bytes: &[u8]) -> Result<Vec<i16>, VoiceError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(VoiceError::UnsupportedAudio(format!(
            "{} bytes of 16-bit PCM",
            bytes.len()
        )));
    }
    Ok(bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes(*pair))
        .collect())
}

/// A streaming linear-interpolation resampler for speech playback, where a
/// device runs at 44.1 or 48 kHz and the answer arrives at 24 kHz. Speech
/// needs no better; capture uses rubato because the detectors are sensitive
/// to aliasing and playback is not.
#[derive(Debug, Clone)]
pub struct LinearResampler {
    from_hz: u32,
    to_hz: u32,
    /// The previous chunk's last sample, which the next chunk interpolates
    /// from so a chunk boundary does not click.
    previous: Option<f32>,
    /// Where the next output sample falls, in input samples after
    /// `previous` (or after the first sample, before any chunk).
    phase: f64,
}

impl LinearResampler {
    /// A resampler from `from_hz` to `to_hz`.
    #[must_use]
    pub const fn new(from_hz: u32, to_hz: u32) -> Self {
        Self {
            from_hz,
            to_hz,
            previous: None,
            phase: 0.0,
        }
    }

    /// The rate it reads.
    #[must_use]
    pub const fn from_hz(&self) -> u32 {
        self.from_hz
    }

    /// Resample one chunk, continuing from the previous one. The last
    /// fraction of a step waits for the next chunk.
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "positions are non-negative and bounded by one chunk of speech"
    )]
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if input.is_empty() {
            return Vec::new();
        }
        if self.from_hz == self.to_hz {
            return input.to_vec();
        }
        let mut samples = Vec::with_capacity(input.len() + 1);
        samples.extend(self.previous);
        samples.extend_from_slice(input);
        let last = (samples.len() - 1) as f64;
        let step = f64::from(self.from_hz) / f64::from(self.to_hz);
        let mut output = Vec::new();
        while self.phase < last {
            let index = self.phase as usize;
            let fraction = (self.phase - self.phase.floor()) as f32;
            let current = samples[index];
            let next = samples[index + 1];
            output.push(current + (next - current) * fraction);
            self.phase += step;
        }
        self.phase -= last;
        self.previous = input.last().copied();
        output
    }
}

/// The default output device through cpal, on Windows and macOS.
#[cfg(any(windows, target_os = "macos"))]
pub mod device {
    use std::collections::VecDeque;
    use std::sync::mpsc::{Sender, channel, sync_channel};
    use std::sync::{Arc, Mutex, PoisonError};
    use std::thread::JoinHandle;
    use std::time::Duration;

    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{SampleFormat, Stream};

    use super::{LinearResampler, SpeechOutput};
    use crate::error::VoiceError;

    fn device_error(error: impl std::fmt::Display) -> VoiceError {
        VoiceError::Device(error.to_string())
    }

    type Queue = Arc<Mutex<VecDeque<f32>>>;

    fn pop(queue: &Queue) -> f32 {
        queue
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop_front()
            .unwrap_or(0.0)
    }

    /// Build the output stream; it plays mono samples from `queue` on every
    /// channel and silence when the queue is empty.
    fn build_stream(queue: &Queue) -> Result<(Stream, u32), VoiceError> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or_else(|| VoiceError::Device("no default output device".to_owned()))?;
        let supported = device.default_output_config().map_err(device_error)?;
        let rate = supported.sample_rate();
        let channels = usize::from(supported.channels());
        let config = supported.config();
        let on_error = |error: cpal::Error| {
            // The stream keeps running; a lost device shows as audio that
            // never drains, which the caller times out.
            let _ = error;
        };
        let stream = match supported.sample_format() {
            SampleFormat::F32 => {
                let queue = Arc::clone(queue);
                device.build_output_stream(
                    config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        for frame in data.chunks_mut(channels) {
                            frame.fill(pop(&queue));
                        }
                    },
                    on_error,
                    None,
                )
            }
            SampleFormat::I16 => {
                let queue = Arc::clone(queue);
                device.build_output_stream(
                    config,
                    move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                        for frame in data.chunks_mut(channels) {
                            #[expect(
                                clippy::cast_possible_truncation,
                                reason = "clamped to the i16 range first"
                            )]
                            let sample = (pop(&queue).clamp(-1.0, 1.0) * 32_767.0) as i16;
                            frame.fill(sample);
                        }
                    },
                    on_error,
                    None,
                )
            }
            other => {
                return Err(VoiceError::UnsupportedAudio(format!(
                    "output sample format {other}"
                )));
            }
        }
        .map_err(device_error)?;
        stream.play().map_err(device_error)?;
        Ok((stream, rate))
    }

    /// The default output device. The stream lives on its own thread, so
    /// this handle is `Send`; the device opens on the first answer and stays
    /// open until the handle is dropped.
    #[derive(Debug, Default)]
    pub struct CpalSpeaker {
        open: Option<Opened>,
    }

    #[derive(Debug)]
    struct Opened {
        queue: Queue,
        rate: u32,
        resampler: Option<LinearResampler>,
        stop: Sender<()>,
        thread: Option<JoinHandle<()>>,
    }

    impl Drop for Opened {
        fn drop(&mut self) {
            let _ = self.stop.send(());
            if let Some(thread) = self.thread.take() {
                let _panicked = thread.join();
            }
        }
    }

    impl CpalSpeaker {
        fn opened(&mut self) -> Result<&mut Opened, VoiceError> {
            if self.open.is_none() {
                self.open = Some(Self::open_device()?);
            }
            self.open
                .as_mut()
                .ok_or_else(|| VoiceError::Device("the output device did not open".to_owned()))
        }

        fn open_device() -> Result<Opened, VoiceError> {
            let queue: Queue = Arc::default();
            let (ready, ready_receiver) = sync_channel(1);
            let (stop, stopped) = channel::<()>();
            let stream_queue = Arc::clone(&queue);
            let thread = std::thread::Builder::new()
                .name("scout-speaker".to_owned())
                .spawn(move || match build_stream(&stream_queue) {
                    Ok((stream, rate)) => {
                        let _ = ready.send(Ok(rate));
                        // Hold the stream until the handle goes away.
                        let _ = stopped.recv();
                        drop(stream);
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                    }
                })
                .map_err(device_error)?;
            let rate = ready_receiver
                .recv_timeout(Duration::from_secs(5))
                .map_err(|_| VoiceError::Device("the output device did not open".to_owned()))??;
            Ok(Opened {
                queue,
                rate,
                resampler: None,
                stop,
                thread: Some(thread),
            })
        }
    }

    impl SpeechOutput for CpalSpeaker {
        fn enqueue(&mut self, sample_rate_hz: u32, pcm: &[i16]) -> Result<(), VoiceError> {
            // A device that failed to open is tried again on the next answer.
            let opened = self.opened()?;
            let resampler = match opened.resampler.as_mut() {
                Some(resampler) if resampler.from_hz() == sample_rate_hz => resampler,
                _ => opened
                    .resampler
                    .insert(LinearResampler::new(sample_rate_hz, opened.rate)),
            };
            let samples: Vec<f32> = pcm
                .iter()
                .map(|sample| f32::from(*sample) / 32_768.0)
                .collect();
            let converted = resampler.process(&samples);
            opened
                .queue
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .extend(converted);
            Ok(())
        }

        fn pending(&self) -> Duration {
            self.open.as_ref().map_or(Duration::ZERO, |opened| {
                let queued = opened
                    .queue
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .len();
                let queued = u64::try_from(queued).unwrap_or(u64::MAX);
                Duration::from_millis(queued.saturating_mul(1000) / u64::from(opened.rate.max(1)))
            })
        }

        fn stop(&mut self) {
            if let Some(opened) = self.open.as_mut() {
                opened
                    .queue
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clear();
                opened.resampler = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{LinearResampler, pcm_s16le};

    #[test]
    fn pcm_decodes_little_endian_pairs_and_refuses_a_half_sample() {
        assert_eq!(
            pcm_s16le(&[0x01, 0x00, 0xFF, 0x7F, 0x00, 0x80]).ok(),
            Some(vec![1, i16::MAX, i16::MIN])
        );
        assert!(pcm_s16le(&[0x01]).is_err());
    }

    #[test]
    fn the_same_rate_passes_through() {
        let mut resampler = LinearResampler::new(24_000, 24_000);
        assert_eq!(resampler.process(&[0.1, 0.2]), [0.1, 0.2]);
    }

    #[test]
    fn doubling_the_rate_doubles_the_samples_across_chunks() {
        let mut resampler = LinearResampler::new(24_000, 48_000);
        let input: Vec<f32> = (0..480_u16).map(|index| f32::from(index) / 480.0).collect();
        let mut output = Vec::new();
        for chunk in input.chunks(37) {
            output.extend(resampler.process(chunk));
        }
        // One output per half input step; the last input sample waits for a
        // next chunk to interpolate towards.
        assert_eq!(output.len(), 958);
        // A ramp stays a ramp: no step larger than half the input's.
        let largest = output
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).abs())
            .fold(0.0_f32, f32::max);
        assert!(largest <= 1.0 / 480.0 / 2.0 + 1e-6, "{largest}");
    }

    #[test]
    fn halving_the_rate_halves_the_samples() {
        let mut resampler = LinearResampler::new(48_000, 24_000);
        assert_eq!(resampler.process(&[0.0; 480]).len(), 240);
    }
}
