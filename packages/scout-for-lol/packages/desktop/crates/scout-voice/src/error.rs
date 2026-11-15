//! Errors from the local voice cascade.

use std::path::PathBuf;

use thiserror::Error;

/// A failure anywhere in the local cascade. None of these are retried
/// silently: a missing or altered model is a packaging bug, and an audio
/// device error is reported to the user.
#[derive(Debug, Error)]
pub enum VoiceError {
    /// The shared contract failed validation.
    #[error("the voice cascade contract is invalid: {0}")]
    Contract(String),
    /// A model file is missing from the model directory.
    #[error("voice model file is missing: {0}")]
    MissingModel(PathBuf),
    /// A model file does not match its pinned checksum.
    #[error("voice model file {path} has checksum {actual}, expected {expected}")]
    ModelChecksum {
        /// The file that failed.
        path: PathBuf,
        /// The pinned SHA-256.
        expected: String,
        /// The SHA-256 on disk.
        actual: String,
    },
    /// Reading a model or audio file failed.
    #[error("could not read {path}: {source}")]
    Io {
        /// The file being read.
        path: PathBuf,
        /// The underlying error.
        source: std::io::Error,
    },
    /// A WAV file could not be read or written.
    #[error("WAV encoding failed: {0}")]
    Wav(#[from] hound::Error),
    /// The input audio is in a shape the cascade does not accept.
    #[error("unsupported audio input: {0}")]
    UnsupportedAudio(String),
    /// The resampler rejected its configuration or input.
    #[error("resampling failed: {0}")]
    Resample(String),
    /// The keyword spotter or VAD runtime failed to load.
    #[error("the {component} runtime failed to load")]
    RuntimeLoad {
        /// Which component failed.
        component: &'static str,
    },
    /// The phrase verifier failed to load or run.
    #[error("the wake phrase verifier failed: {0}")]
    Verifier(String),
    /// A keyword fragment has no tail in the contract.
    #[error("no verification tail is defined for keyword fragment {0}")]
    UnknownFragment(String),
    /// The audio device failed.
    #[error("audio device error: {0}")]
    Device(String),
}
