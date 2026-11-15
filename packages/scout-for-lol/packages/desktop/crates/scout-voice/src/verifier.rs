//! The "hey scout" phrase verifier: the LiveKit/openWakeWord mel, embedding
//! and classifier graphs, run with tract.
//!
//! This is a port of `packages/voice-assistant/src/phrase-verifier.ts`, which
//! runs the same three graphs on ONNX Runtime. It uses tract rather than a
//! second ONNX Runtime because sherpa-onnx already links one statically.

use std::path::Path;
use std::sync::Arc;

use tract_onnx::prelude::{
    DatumExt, Framework, InferenceModelExt, IntoRunnable, Tensor, TypedRunnableModel, tvec,
};

use crate::detect::{Verification, WakeVerifier};
use crate::error::VoiceError;

/// Two seconds at 16 kHz.
pub const VERIFIER_WINDOW_SAMPLES: usize = 32_000;
const MEL_WINDOW_FRAMES: usize = 76;
const MEL_BINS: usize = 32;
const MEL_STRIDE_FRAMES: usize = 8;
const EMBEDDING_SIZE: usize = 96;
const CLASSIFIER_FRAMES: usize = 16;
/// Mel frames the graph produces for one verifier window.
const MEL_FRAMES: usize = 197;
/// Embedding windows over those frames: exactly what the classifier takes.
const EMBEDDING_WINDOWS: usize = (MEL_FRAMES - MEL_WINDOW_FRAMES) / MEL_STRIDE_FRAMES + 1;

/// Paths to the three graphs.
#[derive(Debug, Clone, Copy)]
pub struct VerifierGraphs<'a> {
    /// `melspectrogram.onnx`.
    pub melspectrogram: &'a Path,
    /// `embedding_model.onnx`.
    pub embedding: &'a Path,
    /// `hey_scout.onnx`.
    pub classifier: &'a Path,
}

/// The phrase verifier.
pub struct TractWakeVerifier {
    mel: Arc<TypedRunnableModel>,
    embedding: Arc<TypedRunnableModel>,
    classifier: Arc<TypedRunnableModel>,
    threshold: f32,
}

impl std::fmt::Debug for TractWakeVerifier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TractWakeVerifier")
            .field("threshold", &self.threshold)
            .finish_non_exhaustive()
    }
}

fn verifier_error(error: impl std::fmt::Display) -> VoiceError {
    VoiceError::Verifier(error.to_string())
}

fn load(path: &Path, shape: &[usize]) -> Result<Arc<TypedRunnableModel>, VoiceError> {
    if !path.is_file() {
        return Err(VoiceError::MissingModel(path.to_path_buf()));
    }
    // Fix the shape after typing, not on the inference model: pinning the
    // classifier's symbolic batch before analysis fails on its first
    // transpose in tract 0.23.
    tract_onnx::onnx()
        .model_for_path(path)
        .and_then(InferenceModelExt::into_typed)
        .and_then(|mut model| {
            model.set_input_fact(0, f32::fact(shape))?;
            model.into_optimized()
        })
        .and_then(IntoRunnable::into_runnable)
        .map_err(|error| VoiceError::Verifier(format!("{}: {error}", path.display())))
}

impl TractWakeVerifier {
    /// Load and optimize the three graphs for a fixed two-second window.
    ///
    /// # Errors
    ///
    /// Fails if a graph is missing or tract cannot load it.
    pub fn load(graphs: VerifierGraphs<'_>, threshold: f32) -> Result<Self, VoiceError> {
        Ok(Self {
            mel: load(graphs.melspectrogram, &[1, VERIFIER_WINDOW_SAMPLES])?,
            embedding: load(
                graphs.embedding,
                &[EMBEDDING_WINDOWS, MEL_WINDOW_FRAMES, MEL_BINS, 1],
            )?,
            classifier: load(graphs.classifier, &[1, CLASSIFIER_FRAMES, EMBEDDING_SIZE])?,
            threshold,
        })
    }

    /// The trained acceptance threshold.
    #[must_use]
    pub fn threshold(&self) -> f32 {
        self.threshold
    }
}

fn run(
    model: &Arc<TypedRunnableModel>,
    shape: &[usize],
    data: &[f32],
) -> Result<Vec<f32>, VoiceError> {
    let input = Tensor::from_shape(shape, data).map_err(verifier_error)?;
    let outputs = model.run(tvec!(input.into())).map_err(verifier_error)?;
    let output = outputs
        .first()
        .ok_or_else(|| VoiceError::Verifier("a graph returned no output".to_owned()))?;
    let view = output
        .to_plain_array_view::<f32>()
        .map_err(verifier_error)?;
    Ok(view.iter().copied().collect())
}

/// The trailing window, left-padded with silence.
fn verifier_window(samples: &[f32]) -> Vec<f32> {
    let mut window = vec![0.0; VERIFIER_WINDOW_SAMPLES];
    let take = samples.len().min(VERIFIER_WINDOW_SAMPLES);
    window[VERIFIER_WINDOW_SAMPLES - take..].copy_from_slice(&samples[samples.len() - take..]);
    window
}

impl WakeVerifier for TractWakeVerifier {
    fn verify(&mut self, samples: &[f32]) -> Result<Verification, VoiceError> {
        let mut audio = verifier_window(samples);
        let mut mel = run(&self.mel, &[1, VERIFIER_WINDOW_SAMPLES], &audio)?;
        audio.fill(0.0);
        if mel.len() != MEL_FRAMES * MEL_BINS {
            return Err(VoiceError::Verifier(format!(
                "the mel graph returned {} values, expected {}",
                mel.len(),
                MEL_FRAMES * MEL_BINS
            )));
        }
        for value in &mut mel {
            *value = *value / 10.0 + 2.0;
        }
        let mut batch = Vec::with_capacity(EMBEDDING_WINDOWS * MEL_WINDOW_FRAMES * MEL_BINS);
        for window in 0..EMBEDDING_WINDOWS {
            let start = window * MEL_STRIDE_FRAMES * MEL_BINS;
            batch.extend_from_slice(&mel[start..start + MEL_WINDOW_FRAMES * MEL_BINS]);
        }
        mel.fill(0.0);
        let mut embeddings = run(
            &self.embedding,
            &[EMBEDDING_WINDOWS, MEL_WINDOW_FRAMES, MEL_BINS, 1],
            &batch,
        )?;
        batch.fill(0.0);
        if embeddings.len() != EMBEDDING_WINDOWS * EMBEDDING_SIZE {
            return Err(VoiceError::Verifier(
                "the embedding graph returned an invalid shape".to_owned(),
            ));
        }
        let features = &embeddings[embeddings.len() - CLASSIFIER_FRAMES * EMBEDDING_SIZE..];
        let scores = run(
            &self.classifier,
            &[1, CLASSIFIER_FRAMES, EMBEDDING_SIZE],
            features,
        )?;
        embeddings.fill(0.0);
        let score = scores
            .first()
            .copied()
            .filter(|score| score.is_finite())
            .ok_or_else(|| VoiceError::Verifier("the classifier returned no score".to_owned()))?;
        Ok(Verification {
            accepted: score >= self.threshold,
            score,
        })
    }
}
