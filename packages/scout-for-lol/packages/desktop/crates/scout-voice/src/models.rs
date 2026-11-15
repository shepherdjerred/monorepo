//! Locating and checking the model files.
//!
//! Models are never downloaded at runtime and never committed under
//! `desktop/`. `scripts/fetch-voice-models.ts` assembles a model directory
//! from the pinned downloads in the contract plus the trained verifier that
//! is already committed in `backend/assets/voice`, checking every SHA-256.
//! At runtime [`ModelPaths::locate`] checks the same checksums again and
//! fails loudly on anything missing or altered.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::contract::{ModelFile, VoiceCascade};
use crate::error::VoiceError;

/// The verifier manifest that ships with the trained classifier.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WakeVerifierManifest {
    version: u32,
    threshold: f32,
    assets: WakeVerifierChecksums,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WakeVerifierChecksums {
    melspectrogram: String,
    embedding: String,
    classifier: String,
    smoke_positive: String,
}

/// The checked verifier files.
#[derive(Debug, Clone, PartialEq)]
pub struct VerifierPaths {
    /// Mel spectrogram graph.
    pub melspectrogram: PathBuf,
    /// Speech embedding graph.
    pub embedding: PathBuf,
    /// The "hey scout" classifier.
    pub classifier: PathBuf,
    /// A positive fixture the verifier must accept.
    pub smoke_positive: PathBuf,
    /// The trained acceptance threshold.
    pub threshold: f32,
}

/// Every checked model file.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelPaths {
    /// Transducer encoder.
    pub encoder: PathBuf,
    /// Transducer decoder.
    pub decoder: PathBuf,
    /// Transducer joiner.
    pub joiner: PathBuf,
    /// Token table.
    pub tokens: PathBuf,
    /// BPE vocabulary.
    pub bpe: PathBuf,
    /// The "hey scout" keywords file.
    pub keywords: PathBuf,
    /// Silero VAD.
    pub vad: PathBuf,
    /// The phrase verifier.
    pub verifier: VerifierPaths,
}

impl ModelPaths {
    /// Check every file in `dir` against the contract and the verifier manifest.
    ///
    /// # Errors
    ///
    /// Fails on a missing file or a checksum mismatch.
    pub fn locate(dir: &Path, contract: &VoiceCascade) -> Result<Self, VoiceError> {
        let kws = &contract.models.keyword_spotter;
        let pinned = |file: &ModelFile| checked(dir, &file.name, &file.sha256);
        Ok(Self {
            encoder: pinned(&kws.encoder)?,
            decoder: pinned(&kws.decoder)?,
            joiner: pinned(&kws.joiner)?,
            tokens: pinned(&kws.tokens)?,
            bpe: pinned(&kws.bpe)?,
            keywords: pinned(&kws.keywords)?,
            vad: checked(dir, &contract.models.vad.name, &contract.models.vad.sha256)?,
            verifier: VerifierPaths::locate(dir, contract)?,
        })
    }
}

impl VerifierPaths {
    /// Check the verifier files in `dir` against `wake-verifier.json`.
    ///
    /// # Errors
    ///
    /// Fails on a missing file, a malformed manifest or a checksum mismatch.
    pub fn locate(dir: &Path, contract: &VoiceCascade) -> Result<Self, VoiceError> {
        let names = &contract.models.verifier;
        let manifest_path = dir.join(&names.manifest);
        let body =
            std::fs::read(&manifest_path).map_err(|source| read_error(&manifest_path, source))?;
        let manifest: WakeVerifierManifest = serde_json::from_slice(&body).map_err(|error| {
            VoiceError::Contract(format!("{}: {error}", manifest_path.display()))
        })?;
        if manifest.version != 1 || !(manifest.threshold > 0.0 && manifest.threshold < 1.0) {
            return Err(VoiceError::Contract(format!(
                "{} has an unsupported version or threshold",
                manifest_path.display()
            )));
        }
        let assets = &manifest.assets;
        Ok(Self {
            melspectrogram: checked(dir, &names.melspectrogram, &assets.melspectrogram)?,
            embedding: checked(dir, &names.embedding, &assets.embedding)?,
            classifier: checked(dir, &names.classifier, &assets.classifier)?,
            smoke_positive: checked(dir, &names.smoke_positive, &assets.smoke_positive)?,
            threshold: manifest.threshold,
        })
    }
}

fn read_error(path: &Path, source: std::io::Error) -> VoiceError {
    if source.kind() == std::io::ErrorKind::NotFound {
        VoiceError::MissingModel(path.to_path_buf())
    } else {
        VoiceError::Io {
            path: path.to_path_buf(),
            source,
        }
    }
}

/// The path to `name` in `dir`, after checking its SHA-256.
fn checked(dir: &Path, name: &str, expected: &str) -> Result<PathBuf, VoiceError> {
    let path = dir.join(name);
    let bytes = std::fs::read(&path).map_err(|source| read_error(&path, source))?;
    let actual = hex::encode(Sha256::digest(&bytes));
    if actual == expected {
        Ok(path)
    } else {
        Err(VoiceError::ModelChecksum {
            path,
            expected: expected.to_owned(),
            actual,
        })
    }
}
