//! The production microphone engine: sherpa-onnx keyword spotting and VAD,
//! the tract phrase verifier, and the default input device.

use std::path::PathBuf;

use scout_voice::capture::DefaultMicrophone;
use scout_voice::models::ModelPaths;
use scout_voice::sherpa::{SherpaKeywordSpotter, SherpaVad};
use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
use scout_voice::{EngineEvent, VoiceCascade, VoiceEngine, VoiceError, VoicePipeline};
use tokio::sync::mpsc::UnboundedSender;

use super::{EnginePort, EngineStarter};

/// Starts the engine from the first model directory that exists.
#[derive(Debug, Clone)]
pub struct ModelEngine {
    directories: Vec<PathBuf>,
}

impl ModelEngine {
    /// Look for the models in `directories`, in order.
    #[must_use]
    pub const fn new(directories: Vec<PathBuf>) -> Self {
        Self { directories }
    }
}

/// An engine that never started; its failure was already reported.
struct NoEngine;

impl EnginePort for NoEngine {
    fn send(&self, _command: scout_voice::EngineCommand) {}
}

fn build(
    directories: &[PathBuf],
) -> Result<
    (
        VoicePipeline<SherpaKeywordSpotter, SherpaVad, TractWakeVerifier>,
        DefaultMicrophone,
    ),
    VoiceError,
> {
    let directory = directories
        .iter()
        .find(|directory| directory.is_dir())
        .ok_or_else(|| {
            VoiceError::MissingModel(
                directories
                    .first()
                    .cloned()
                    .unwrap_or_else(|| PathBuf::from("voice-models")),
            )
        })?;
    let contract = VoiceCascade::shared()?;
    // Every file is checked against its pinned SHA-256 before it loads.
    let paths = ModelPaths::locate(directory, &contract)?;
    let pipeline = VoicePipeline::new(
        contract.clone(),
        SherpaKeywordSpotter::load(&paths, &contract)?,
        SherpaVad::load(&paths, &contract)?,
        TractWakeVerifier::load(
            VerifierGraphs {
                melspectrogram: &paths.verifier.melspectrogram,
                embedding: &paths.verifier.embedding,
                classifier: &paths.verifier.classifier,
            },
            paths.verifier.threshold,
        )?,
    );
    Ok((pipeline, DefaultMicrophone))
}

impl EngineStarter for ModelEngine {
    fn start(&mut self, events: UnboundedSender<EngineEvent>) -> Box<dyn EnginePort> {
        let directories = self.directories.clone();
        let reporter = events.clone();
        match VoiceEngine::spawn(
            move || build(&directories),
            move |event| {
                // The service is gone only while Scout quits.
                let _ = reporter.send(event);
            },
        ) {
            Ok(engine) => Box::new(engine),
            Err(error) => {
                let _ = events.send(EngineEvent::Failed(error.to_string()));
                Box::new(NoEngine)
            }
        }
    }
}
