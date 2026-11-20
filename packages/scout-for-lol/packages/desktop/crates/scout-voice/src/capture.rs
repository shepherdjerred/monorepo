//! The microphone through cpal.
//!
//! The device callback only copies samples into a bounded channel; all
//! resampling and inference happen on the reader's thread. A full channel
//! drops the chunk and counts it, so a stalled reader shows up as
//! [`CpalInput::dropped_chunks`] rather than as a blocked audio thread.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};

use crate::audio::{AudioFormat, AudioInput};
use crate::error::VoiceError;

/// About two seconds of 10 ms callbacks.
const CHANNEL_CHUNKS: usize = 200;

/// The default input device, capturing until dropped.
pub struct CpalInput {
    stream: Stream,
    format: AudioFormat,
    chunks: Receiver<Result<Vec<f32>, String>>,
    dropped: Arc<AtomicU64>,
    callbacks: Arc<AtomicU64>,
}

impl std::fmt::Debug for CpalInput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CpalInput")
            .field("format", &self.format)
            .field("dropped", &self.dropped_chunks())
            .finish_non_exhaustive()
    }
}

fn device_error(error: impl std::fmt::Display) -> VoiceError {
    VoiceError::Device(error.to_string())
}

fn send(
    sender: &SyncSender<Result<Vec<f32>, String>>,
    dropped: &AtomicU64,
    chunk: Result<Vec<f32>, String>,
) {
    if let Err(TrySendError::Full(_)) = sender.try_send(chunk) {
        dropped.fetch_add(1, Ordering::Relaxed);
    }
}

impl CpalInput {
    /// Open and start the default input device in its default format.
    ///
    /// # Errors
    ///
    /// Fails if there is no input device, it has no usable format, or the
    /// operating system refuses the stream.
    pub fn open_default() -> Result<Self, VoiceError> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| VoiceError::Device("no default input device".to_owned()))?;
        let supported = device.default_input_config().map_err(device_error)?;
        let format = AudioFormat {
            sample_rate_hz: supported.sample_rate(),
            channels: supported.channels(),
        };
        let (sender, chunks) = sync_channel(CHANNEL_CHUNKS);
        let dropped = Arc::new(AtomicU64::new(0));
        let callbacks = Arc::new(AtomicU64::new(0));
        let error_sender = sender.clone();
        let error_dropped = Arc::clone(&dropped);
        let on_error = move |error: cpal::Error| {
            send(&error_sender, &error_dropped, Err(error.to_string()));
        };
        let config = supported.config();
        let (data_dropped, data_callbacks) = (Arc::clone(&dropped), Arc::clone(&callbacks));
        let stream = match supported.sample_format() {
            SampleFormat::F32 => device.build_input_stream(
                config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    data_callbacks.fetch_add(1, Ordering::Relaxed);
                    send(&sender, &data_dropped, Ok(data.to_vec()));
                },
                on_error,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    data_callbacks.fetch_add(1, Ordering::Relaxed);
                    let chunk = data
                        .iter()
                        .map(|sample| f32::from(*sample) / 32_768.0)
                        .collect();
                    send(&sender, &data_dropped, Ok(chunk));
                },
                on_error,
                None,
            ),
            other => {
                return Err(VoiceError::UnsupportedAudio(format!(
                    "input sample format {other}"
                )));
            }
        }
        .map_err(device_error)?;
        stream.play().map_err(device_error)?;
        Ok(Self {
            stream,
            format,
            chunks,
            dropped,
            callbacks,
        })
    }

    /// Chunks dropped because the reader fell behind.
    #[must_use]
    pub fn dropped_chunks(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Device callbacks so far.
    #[must_use]
    pub fn callbacks(&self) -> u64 {
        self.callbacks.load(Ordering::Relaxed)
    }

    /// Stop capturing without dropping the input.
    ///
    /// # Errors
    ///
    /// Returns the device's error.
    pub fn pause(&self) -> Result<(), VoiceError> {
        self.stream.pause().map_err(device_error)
    }
}

impl AudioInput for CpalInput {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, VoiceError> {
        match self.chunks.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(chunk)) => Ok(Some(chunk)),
            Ok(Err(message)) => Err(VoiceError::Device(message)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(VoiceError::Device(
                "the input device delivered no audio for two seconds".to_owned(),
            )),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Ok(None),
        }
    }
}

/// The default input device, opened fresh each time the engine wants it.
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultMicrophone;

impl crate::engine::Microphone for DefaultMicrophone {
    fn open(&mut self) -> Result<Box<dyn AudioInput>, VoiceError> {
        Ok(Box::new(CpalInput::open_default()?))
    }
}
