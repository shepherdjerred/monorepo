//! The production microphone engine: sherpa-onnx keyword spotting and VAD,
//! the tract phrase verifier, and the default input device.

use std::path::{Path, PathBuf};

use scout_voice::capture::DefaultMicrophone;
use scout_voice::models::{MODEL_DIRECTORY_NAME, ModelPaths};
use scout_voice::sherpa::{SherpaKeywordSpotter, SherpaVad};
use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
use scout_voice::{EngineEvent, VoiceCascade, VoiceEngine, VoiceError, VoicePipeline};
use tokio::sync::mpsc::UnboundedSender;

use super::{EnginePort, EngineStarter};

/// Starts the engine from the installed model directory, found by
/// [`ModelPaths::locate_installed`].
#[derive(Debug, Clone)]
pub struct ModelEngine {
    executable: Option<PathBuf>,
    data_dir: Option<PathBuf>,
}

impl ModelEngine {
    /// Look for the models relative to `executable` and in `data_dir`.
    #[must_use]
    pub const fn new(executable: Option<PathBuf>, data_dir: Option<PathBuf>) -> Self {
        Self {
            executable,
            data_dir,
        }
    }
}

/// An engine that never started; its failure was already reported.
struct NoEngine;

impl EnginePort for NoEngine {
    fn send(&self, _command: scout_voice::EngineCommand) {}
}

fn build(
    executable: Option<&Path>,
    data_dir: Option<&Path>,
) -> Result<
    (
        VoicePipeline<SherpaKeywordSpotter, SherpaVad, TractWakeVerifier>,
        DefaultMicrophone,
    ),
    VoiceError,
> {
    let executable =
        executable.ok_or_else(|| VoiceError::MissingModel(PathBuf::from(MODEL_DIRECTORY_NAME)))?;
    let contract = VoiceCascade::shared()?;
    // Every file is checked against its pinned SHA-256 before it loads.
    let paths = ModelPaths::locate_installed(executable, data_dir, &contract)?;
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
        let executable = self.executable.clone();
        let data_dir = self.data_dir.clone();
        let reporter = events.clone();
        match VoiceEngine::spawn(
            move || build(executable.as_deref(), data_dir.as_deref()),
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
