//! sherpa-onnx keyword spotting and Silero VAD. One ONNX Runtime, linked
//! statically by `sherpa-onnx-sys`, serves both; all FFI stays inside the
//! `sherpa-onnx` crate.

use sherpa_onnx::{
    KeywordSpotter as SherpaSpotter, KeywordSpotterConfig, OnlineStream, VadModelConfig,
    VoiceActivityDetector,
};

use crate::contract::{SAMPLE_RATE_HZ, VoiceCascade};
use crate::detect::{KeywordHit, KeywordSpotter, VoiceActivity};
use crate::error::VoiceError;
use crate::models::ModelPaths;

const SAMPLE_RATE: i32 = 16_000;

fn path_string(path: &std::path::Path) -> Option<String> {
    path.to_str().map(str::to_owned)
}

/// The streaming "hey scout" spotter.
pub struct SherpaKeywordSpotter {
    spotter: SherpaSpotter,
    stream: OnlineStream,
}

impl std::fmt::Debug for SherpaKeywordSpotter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SherpaKeywordSpotter")
            .finish_non_exhaustive()
    }
}

impl SherpaKeywordSpotter {
    /// Load the transducer and the keywords file.
    ///
    /// # Errors
    ///
    /// Fails if sherpa-onnx cannot load the model.
    pub fn load(paths: &ModelPaths, contract: &VoiceCascade) -> Result<Self, VoiceError> {
        let settings = &contract.wake.keyword_spotter;
        let mut config = KeywordSpotterConfig::default();
        config.feat_config.sample_rate = SAMPLE_RATE;
        config.feat_config.feature_dim = settings.feature_dim;
        config.model_config.transducer.encoder = path_string(&paths.encoder);
        config.model_config.transducer.decoder = path_string(&paths.decoder);
        config.model_config.transducer.joiner = path_string(&paths.joiner);
        config.model_config.tokens = path_string(&paths.tokens);
        config.model_config.num_threads = settings.num_threads;
        config.model_config.provider = Some("cpu".to_owned());
        config.model_config.modeling_unit = Some("bpe".to_owned());
        config.model_config.bpe_vocab = path_string(&paths.bpe);
        config.max_active_paths = settings.max_active_paths;
        config.num_trailing_blanks = settings.num_trailing_blanks;
        config.keywords_score = settings.keywords_score;
        config.keywords_threshold = settings.keywords_threshold;
        config.keywords_file = path_string(&paths.keywords);
        let spotter = SherpaSpotter::create(&config).ok_or(VoiceError::RuntimeLoad {
            component: "keyword spotter",
        })?;
        let stream = spotter.create_stream();
        Ok(Self { spotter, stream })
    }
}

impl KeywordSpotter for SherpaKeywordSpotter {
    fn accept(&mut self, samples: &[f32]) -> Result<Option<KeywordHit>, VoiceError> {
        self.stream.accept_waveform(SAMPLE_RATE, samples);
        while self.spotter.is_ready(&self.stream) {
            self.spotter.decode(&self.stream);
        }
        let Some(result) = self.spotter.get_result(&self.stream) else {
            return Ok(None);
        };
        if result.keyword.is_empty() {
            return Ok(None);
        }
        self.spotter.reset(&self.stream);
        Ok(Some(KeywordHit {
            fragment: result.keyword,
            fragment_end_seconds: result.timestamps.last().copied(),
        }))
    }

    fn reset(&mut self) {
        self.spotter.reset(&self.stream);
    }
}

/// Silero VAD.
pub struct SherpaVad {
    vad: VoiceActivityDetector,
}

impl std::fmt::Debug for SherpaVad {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("SherpaVad").finish_non_exhaustive()
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "contract durations are at most 600000 ms, exact in f32"
)]
fn seconds(ms: u32) -> f32 {
    ms as f32 / 1000.0
}

impl SherpaVad {
    /// Load the Silero model with the contract's settings.
    ///
    /// # Errors
    ///
    /// Fails if sherpa-onnx cannot load the model.
    pub fn load(paths: &ModelPaths, contract: &VoiceCascade) -> Result<Self, VoiceError> {
        let settings = &contract.vad;
        let mut config = VadModelConfig::default();
        config.silero_vad.model = path_string(&paths.vad);
        config.silero_vad.threshold = settings.threshold;
        config.silero_vad.min_silence_duration = seconds(settings.min_silence_ms);
        config.silero_vad.min_speech_duration = seconds(settings.min_speech_ms);
        config.silero_vad.window_size = settings.window_samples;
        config.silero_vad.max_speech_duration = seconds(settings.max_speech_ms);
        config.sample_rate = i32::try_from(SAMPLE_RATE_HZ).unwrap_or(SAMPLE_RATE);
        config.num_threads = 1;
        config.provider = Some("cpu".to_owned());
        let buffer = seconds(settings.buffer_seconds.saturating_mul(1000));
        let vad = VoiceActivityDetector::create(&config, buffer)
            .ok_or(VoiceError::RuntimeLoad { component: "VAD" })?;
        Ok(Self { vad })
    }
}

impl VoiceActivity for SherpaVad {
    fn accept(&mut self, samples: &[f32]) {
        self.vad.accept_waveform(samples);
    }

    fn speech_active(&self) -> bool {
        self.vad.detected()
    }

    fn completed_speech(&self) -> bool {
        !self.vad.is_empty()
    }

    fn reset(&mut self) {
        self.vad.reset();
        self.vad.clear();
    }
}
