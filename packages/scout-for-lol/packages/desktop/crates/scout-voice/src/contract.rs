//! The shared voice cascade contract,
//! `data/src/scout-client/voice-cascade.contract.json`.
//!
//! The backend's Zod schema (`voice-cascade.schema.ts`) validates the same
//! file, and both run `voice-cascade.fixtures.json`.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::error::VoiceError;

/// The contract as committed.
pub const CONTRACT_JSON: &str =
    include_str!("../../../../data/src/scout-client/voice-cascade.contract.json");

/// The only sample rate the models accept.
pub const SAMPLE_RATE_HZ: u32 = 16_000;

/// Samples per millisecond at [`SAMPLE_RATE_HZ`].
const SAMPLES_PER_MS: usize = 16;

/// The longest duration any timing field may name.
const MAX_MS: u32 = 600_000;

/// Samples in `ms` milliseconds of 16 kHz audio.
#[must_use]
pub fn ms_to_samples(ms: u32) -> usize {
    usize::try_from(ms).map_or(usize::MAX, |ms| ms.saturating_mul(SAMPLES_PER_MS))
}

/// The whole contract.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceCascade {
    /// Always 1.
    pub contract_version: u32,
    /// The capture format the cascade runs on.
    pub audio: AudioContract,
    /// Wake word settings.
    pub wake: WakeContract,
    /// End-of-speech settings.
    pub vad: VadContract,
    /// Utterance bounds.
    pub utterance: UtteranceContract,
    /// Pinned model files.
    pub models: ModelsContract,
}

/// The capture format.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioContract {
    /// Always 16000.
    pub sample_rate_hz: u32,
    /// Always 1.
    pub channels: u16,
    /// The frame size the pipeline feeds the detectors.
    pub frame_ms: u32,
}

/// Wake word settings.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WakeContract {
    /// The phrases a user says.
    pub phrases: Vec<String>,
    /// Transcript prefixes the server accepts as the wake phrase.
    pub transcript_prefixes: Vec<String>,
    /// sherpa-onnx keyword spotter settings.
    pub keyword_spotter: KeywordSpotterContract,
    /// Audio still to come after each matched keyword fragment ends.
    pub fragment_tail_ms: BTreeMap<String, u32>,
    /// Added to every fragment tail.
    pub fragment_tail_margin_ms: u32,
    /// Used when the spotter reports no timestamp.
    pub verification_delay_ms: u32,
    /// The audio the phrase verifier scores.
    pub verifier_window_ms: u32,
}

/// sherpa-onnx keyword spotter settings.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeywordSpotterContract {
    /// Always 80 mel bins.
    pub feature_dim: i32,
    /// Beam width.
    pub max_active_paths: i32,
    /// Trailing blanks before a keyword is emitted.
    pub num_trailing_blanks: i32,
    /// Boost applied to keyword tokens.
    pub keywords_score: f32,
    /// Global trigger threshold; per-keyword overrides live in the keywords file.
    pub keywords_threshold: f32,
    /// Inference threads.
    pub num_threads: i32,
}

/// Silero VAD settings.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VadContract {
    /// Speech probability threshold.
    pub threshold: f32,
    /// Silence that ends a speech segment.
    pub min_silence_ms: u32,
    /// Shortest speech segment.
    pub min_speech_ms: u32,
    /// Always 512 samples at 16 kHz.
    pub window_samples: i32,
    /// Longest speech segment.
    pub max_speech_ms: u32,
    /// The VAD's internal buffer.
    pub buffer_seconds: u32,
}

/// Utterance bounds.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtteranceContract {
    /// Audio kept from before the wake word.
    pub pre_roll_ms: u32,
    /// A capture ends after this long whatever the VAD says.
    pub max_utterance_ms: u32,
    /// Audio kept after the verifier accepts, before end of speech can end a capture.
    pub post_verification_ms: u32,
}

/// Pinned model files.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelsContract {
    /// The sherpa-onnx keyword spotting archive and the files used from it.
    pub keyword_spotter: KeywordSpotterModels,
    /// The Silero VAD model.
    pub vad: DownloadedModel,
    /// The trained phrase verifier, shipped from `backend/assets/voice`.
    pub verifier: VerifierModels,
}

/// One pinned file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelFile {
    /// File name inside the model directory.
    pub name: String,
    /// Lowercase hex SHA-256.
    pub sha256: String,
}

/// The keyword spotting archive.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeywordSpotterModels {
    /// Where the archive is downloaded from.
    pub archive_url: String,
    /// The archive's SHA-256.
    pub archive_sha256: String,
    /// Transducer encoder.
    pub encoder: ModelFile,
    /// Transducer decoder.
    pub decoder: ModelFile,
    /// Transducer joiner.
    pub joiner: ModelFile,
    /// Token table.
    pub tokens: ModelFile,
    /// BPE vocabulary.
    pub bpe: ModelFile,
    /// The tokenized "hey scout" keywords file.
    pub keywords: ModelFile,
}

/// A file downloaded on its own.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadedModel {
    /// Where it is downloaded from.
    pub url: String,
    /// File name inside the model directory.
    pub name: String,
    /// Lowercase hex SHA-256.
    pub sha256: String,
}

/// The trained phrase verifier's files. Their checksums and threshold are in
/// the `manifest` file that ships with them.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifierModels {
    /// `wake-verifier.json`.
    pub manifest: String,
    /// Mel spectrogram graph.
    pub melspectrogram: String,
    /// Speech embedding graph.
    pub embedding: String,
    /// The "hey scout" classifier.
    pub classifier: String,
    /// A positive fixture the verifier must accept.
    pub smoke_positive: String,
}

impl VoiceCascade {
    /// The committed contract.
    ///
    /// # Errors
    ///
    /// Fails if the committed file is invalid, which the fixtures test rules out.
    pub fn shared() -> Result<Self, VoiceError> {
        Self::from_json(CONTRACT_JSON)
    }

    /// Parse and validate a contract body.
    ///
    /// # Errors
    ///
    /// Returns [`VoiceError::Contract`] on a shape or range violation.
    pub fn from_json(body: &str) -> Result<Self, VoiceError> {
        let contract: Self =
            serde_json::from_str(body).map_err(|error| VoiceError::Contract(error.to_string()))?;
        contract.validate()?;
        Ok(contract)
    }

    /// The same checks as the Zod schema.
    fn validate(&self) -> Result<(), VoiceError> {
        let fail = |message: &str| Err(VoiceError::Contract(message.to_owned()));
        if self.contract_version != 1 {
            return fail("contractVersion must be 1");
        }
        if self.audio.sample_rate_hz != SAMPLE_RATE_HZ || self.audio.channels != 1 {
            return fail("audio must be 16 kHz mono");
        }
        if !(10..=100).contains(&self.audio.frame_ms) {
            return fail("frameMs must be 10 to 100");
        }
        let short_text = |text: &String| (1..=64).contains(&text.chars().count());
        if self.wake.phrases.is_empty() || !self.wake.phrases.iter().all(short_text) {
            return fail("wake phrases must be 1 to 64 characters, at least one");
        }
        if self.wake.transcript_prefixes.is_empty()
            || !self.wake.transcript_prefixes.iter().all(short_text)
        {
            return fail("transcript prefixes must be 1 to 64 characters, at least one");
        }
        let kws = &self.wake.keyword_spotter;
        let spotter_ok = kws.feature_dim == 80
            && (1..=64).contains(&kws.max_active_paths)
            && (0..=16).contains(&kws.num_trailing_blanks)
            && kws.keywords_score > 0.0
            && kws.keywords_score <= 10.0
            && unit_interval(kws.keywords_threshold)
            && (1..=8).contains(&kws.num_threads);
        if !spotter_ok {
            return fail("keyword spotter settings are out of range");
        }
        let fragment_name = |name: &String| {
            let mut bytes = name.bytes();
            bytes.next().is_some_and(|first| first.is_ascii_uppercase())
                && bytes.all(|byte| byte.is_ascii_uppercase() || byte == b'_')
        };
        if !self.wake.fragment_tail_ms.keys().all(fragment_name)
            || !self.wake.fragment_tail_ms.values().all(|ms| *ms <= MAX_MS)
            || self.wake.fragment_tail_margin_ms > MAX_MS
            || !positive_ms(self.wake.verification_delay_ms)
            || !positive_ms(self.wake.verifier_window_ms)
        {
            return fail("wake timings are out of range");
        }
        if !unit_interval(self.vad.threshold)
            || !positive_ms(self.vad.min_silence_ms)
            || !positive_ms(self.vad.min_speech_ms)
            || self.vad.window_samples != 512
            || !positive_ms(self.vad.max_speech_ms)
            || !(1..=120).contains(&self.vad.buffer_seconds)
        {
            return fail("VAD settings are out of range");
        }
        if !positive_ms(self.utterance.pre_roll_ms)
            || !positive_ms(self.utterance.max_utterance_ms)
            || self.utterance.post_verification_ms > MAX_MS
        {
            return fail("utterance timings are out of range");
        }
        if self.utterance.pre_roll_ms < self.wake.verifier_window_ms {
            return fail("the pre-roll must cover the verifier window");
        }
        self.models.validate()
    }
}

impl ModelsContract {
    fn validate(&self) -> Result<(), VoiceError> {
        let kws = &self.keyword_spotter;
        let files = [
            &kws.encoder,
            &kws.decoder,
            &kws.joiner,
            &kws.tokens,
            &kws.bpe,
            &kws.keywords,
        ];
        let urls_ok = https_url(&kws.archive_url) && https_url(&self.vad.url);
        let checksums_ok = sha256(&kws.archive_sha256)
            && sha256(&self.vad.sha256)
            && files.iter().all(|file| sha256(&file.sha256));
        let verifier = &self.verifier;
        let names_ok = files.iter().all(|file| file_name(&file.name))
            && file_name(&self.vad.name)
            && [
                &verifier.manifest,
                &verifier.melspectrogram,
                &verifier.embedding,
                &verifier.classifier,
                &verifier.smoke_positive,
            ]
            .into_iter()
            .all(|name| file_name(name));
        if urls_ok && checksums_ok && names_ok {
            Ok(())
        } else {
            Err(VoiceError::Contract(
                "model URLs, names or checksums are malformed".to_owned(),
            ))
        }
    }
}

fn unit_interval(value: f32) -> bool {
    value > 0.0 && value < 1.0
}

fn positive_ms(ms: u32) -> bool {
    (1..=MAX_MS).contains(&ms)
}

fn sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn https_url(text: &str) -> bool {
    text.len() <= 512
        && text
            .strip_prefix("https://")
            .is_some_and(|rest| !rest.is_empty() && !rest.chars().any(char::is_whitespace))
}

fn file_name(text: &str) -> bool {
    let mut bytes = text.bytes();
    text.len() <= 128
        && bytes
            .next()
            .is_some_and(|first| first.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{CONTRACT_JSON, VoiceCascade, ms_to_samples};

    const FIXTURES: &str =
        include_str!("../../../../data/src/scout-client/voice-cascade.fixtures.json");

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// The contract with one value replaced, as the Zod test builds it.
    fn with_override(fixture: &Value) -> Result<String, Box<dyn std::error::Error>> {
        let mut body: Value = serde_json::from_str(CONTRACT_JSON)?;
        let path = fixture["path"].as_array().ok_or("fixture path")?;
        if let Some((key, parents)) = path.split_last() {
            let mut parent = &mut body;
            for segment in parents {
                parent = parent
                    .get_mut(segment.as_str().ok_or("path segment")?)
                    .ok_or("missing parent")?;
            }
            let object = parent.as_object_mut().ok_or("parent is not an object")?;
            object.insert(
                key.as_str().ok_or("path key")?.to_owned(),
                fixture["value"].clone(),
            );
        }
        Ok(serde_json::to_string(&body)?)
    }

    fn fixtures(kind: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
        let fixtures: Value = serde_json::from_str(FIXTURES)?;
        Ok(fixtures[kind].as_array().ok_or("fixture list")?.clone())
    }

    #[test]
    fn the_committed_contract_parses() -> TestResult {
        let contract = VoiceCascade::shared()?;
        assert_eq!(contract.audio.sample_rate_hz, 16_000);
        assert_eq!(contract.wake.phrases, ["hey scout"]);
        assert_eq!(contract.wake.fragment_tail_ms.get("HEY"), Some(&500));
        Ok(())
    }

    #[test]
    fn every_valid_fixture_is_accepted() -> TestResult {
        let valid = fixtures("valid")?;
        assert_ne!(valid.len(), 0);
        for fixture in &valid {
            let body = with_override(fixture)?;
            assert!(
                VoiceCascade::from_json(&body).is_ok(),
                "rejected valid fixture: {}",
                fixture["reason"]
            );
        }
        Ok(())
    }

    #[test]
    fn every_invalid_fixture_is_rejected() -> TestResult {
        let invalid = fixtures("invalid")?;
        assert_ne!(invalid.len(), 0);
        for fixture in &invalid {
            let body = with_override(fixture)?;
            assert!(
                VoiceCascade::from_json(&body).is_err(),
                "accepted invalid fixture: {}",
                fixture["reason"]
            );
        }
        Ok(())
    }

    #[test]
    fn milliseconds_convert_at_sixteen_kilohertz() {
        assert_eq!(ms_to_samples(0), 0);
        assert_eq!(ms_to_samples(20), 320);
        assert_eq!(ms_to_samples(2000), 32_000);
    }
}
