//! The tract phrase verifier against the trained assets committed in
//! `backend/assets/voice`, which need no download, so this runs in Linux CI.
//!
//! The expected scores are the production verifier's
//! (`packages/voice-assistant/src/phrase-verifier.ts`, ONNX Runtime 1.30 via
//! onnxruntime-node) on the same sample arrays.

use std::path::PathBuf;

use scout_voice::audio::read_wav;
use scout_voice::models::VerifierPaths;
use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
use scout_voice::{AudioFormat, MonoResampler, VoiceCascade, WakeVerifier};

type TestResult = Result<(), Box<dyn std::error::Error>>;

/// Largest score difference accepted between tract and ONNX Runtime.
const PARITY: f32 = 1e-4;

fn assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../backend/assets/voice")
}

fn verifier() -> Result<(TractWakeVerifier, VerifierPaths), Box<dyn std::error::Error>> {
    let paths = VerifierPaths::locate(&assets(), &VoiceCascade::shared()?)?;
    let verifier = TractWakeVerifier::load(
        VerifierGraphs {
            melspectrogram: &paths.melspectrogram,
            embedding: &paths.embedding,
            classifier: &paths.classifier,
        },
        paths.threshold,
    )?;
    Ok((verifier, paths))
}

fn wav(name: &str) -> Result<(AudioFormat, Vec<f32>), Box<dyn std::error::Error>> {
    Ok(read_wav(&std::fs::read(assets().join(name))?)?)
}

#[test]
fn the_threshold_comes_from_the_shipped_manifest() -> TestResult {
    let (verifier, paths) = verifier()?;
    assert!((verifier.threshold() - 0.35).abs() < f32::EPSILON);
    assert!((paths.threshold - 0.35).abs() < f32::EPSILON);
    Ok(())
}

#[test]
fn the_smoke_positive_is_accepted_with_the_production_score() -> TestResult {
    let (mut verifier, paths) = verifier()?;
    let (format, samples) = read_wav(&std::fs::read(&paths.smoke_positive)?)?;
    assert_eq!(format.sample_rate_hz, 16_000);
    let verification = verifier.verify(&samples)?;
    assert!(verification.accepted);
    assert!(
        (verification.score - 0.944_376_8).abs() < PARITY,
        "tract scored {}",
        verification.score
    );
    Ok(())
}

#[test]
fn silence_is_rejected_with_the_production_score() -> TestResult {
    let (mut verifier, _) = verifier()?;
    let verification = verifier.verify(&vec![0.0; 32_000])?;
    assert!(!verification.accepted);
    assert!(
        (verification.score - 0.002_231_33).abs() < PARITY,
        "tract scored {}",
        verification.score
    );
    Ok(())
}

#[test]
fn scouts_own_feedback_clips_are_rejected() -> TestResult {
    let (mut verifier, _) = verifier()?;
    for (name, production_score) in [
        ("feedback-prompt.wav", 0.002_423_82),
        ("feedback-retry.wav", 0.002_171_46),
    ] {
        let (format, samples) = wav(name)?;
        // The same raw array the production verifier was scored on.
        let raw = verifier.verify(&samples)?;
        assert!(!raw.accepted, "{name} accepted");
        assert!(
            (raw.score - production_score).abs() < PARITY,
            "{name}: tract scored {}",
            raw.score
        );
        // And the clip as the pipeline would see it, at 16 kHz.
        let mut resampler = MonoResampler::new(format)?;
        let mut at_16k = resampler.process(&samples)?;
        at_16k.extend(resampler.flush()?);
        assert!(
            !verifier.verify(&at_16k)?.accepted,
            "{name} accepted at 16 kHz"
        );
    }
    Ok(())
}

#[test]
fn a_short_input_is_padded_with_leading_silence() -> TestResult {
    let (mut verifier, paths) = verifier()?;
    let (_, samples) = read_wav(&std::fs::read(&paths.smoke_positive)?)?;
    let mut padded = vec![0.0; 32_000 - samples.len().min(32_000)];
    padded.extend_from_slice(&samples);
    let short = verifier.verify(&samples)?;
    let full = verifier.verify(&padded)?;
    assert!((short.score - full.score).abs() < f32::EPSILON);
    Ok(())
}

#[test]
fn an_altered_asset_fails_its_checksum() -> TestResult {
    let dir = std::env::temp_dir().join(format!("scout-voice-checksum-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    for name in [
        "wake-verifier.json",
        "melspectrogram.onnx",
        "embedding_model.onnx",
        "hey-scout-smoke.wav",
    ] {
        std::fs::copy(assets().join(name), dir.join(name))?;
    }
    std::fs::write(dir.join("hey_scout.onnx"), b"not the trained classifier")?;
    let result = VerifierPaths::locate(&dir, &VoiceCascade::shared()?);
    std::fs::remove_dir_all(&dir)?;
    assert!(matches!(
        result,
        Err(scout_voice::VoiceError::ModelChecksum { .. })
    ));
    Ok(())
}
