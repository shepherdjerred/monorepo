//! `ModelPaths::locate_installed` on fixture layouts shaped like the Windows
//! install, the macOS app bundle and a development checkout. The pinned model
//! files are not committed, so the fixture contract pins stand-in bytes; the
//! verifier files are the real committed ones.

use std::fs;
use std::path::{Path, PathBuf};

use scout_voice::models::{MODEL_DIRECTORY_NAME, ModelPaths, model_directories};
use scout_voice::{VoiceCascade, VoiceError};
use sha2::{Digest, Sha256};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn backend_assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../backend/assets/voice")
}

fn scratch(name: &str) -> Result<PathBuf, std::io::Error> {
    let dir = std::env::temp_dir().join(format!("scout-voice-{name}-{}", std::process::id()));
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// A contract whose downloaded-model pins match the stand-in bytes below.
fn fixture_contract() -> Result<VoiceCascade, Box<dyn std::error::Error>> {
    let mut contract = VoiceCascade::shared()?;
    let kws = &mut contract.models.keyword_spotter;
    for file in [
        &mut kws.encoder,
        &mut kws.decoder,
        &mut kws.joiner,
        &mut kws.tokens,
        &mut kws.bpe,
        &mut kws.keywords,
    ] {
        file.sha256 = hex::encode(Sha256::digest(stand_in(&file.name)));
    }
    contract.models.vad.sha256 = hex::encode(Sha256::digest(stand_in(&contract.models.vad.name)));
    Ok(contract)
}

fn stand_in(name: &str) -> Vec<u8> {
    format!("stand-in for {name}").into_bytes()
}

/// Write every model the contract names into `dir`.
fn populate(dir: &Path, contract: &VoiceCascade) -> TestResult {
    fs::create_dir_all(dir)?;
    let kws = &contract.models.keyword_spotter;
    for name in [
        &kws.encoder.name,
        &kws.decoder.name,
        &kws.joiner.name,
        &kws.tokens.name,
        &kws.bpe.name,
        &kws.keywords.name,
        &contract.models.vad.name,
    ] {
        fs::write(dir.join(name), stand_in(name))?;
    }
    let verifier = &contract.models.verifier;
    for name in [
        &verifier.manifest,
        &verifier.melspectrogram,
        &verifier.embedding,
        &verifier.classifier,
        &verifier.smoke_positive,
    ] {
        fs::copy(backend_assets().join(name), dir.join(name))?;
    }
    Ok(())
}

#[test]
fn finds_the_directory_beside_the_executable() -> TestResult {
    let contract = fixture_contract()?;
    let install = scratch("windows")?;
    populate(&install.join(MODEL_DIRECTORY_NAME), &contract)?;
    let found = ModelPaths::locate_installed(&install.join("scout-client.exe"), None, &contract)?;
    assert_eq!(
        found.encoder.parent(),
        Some(install.join("voice-models").as_path())
    );
    Ok(())
}

#[test]
fn finds_the_directory_in_the_macos_bundle_resources() -> TestResult {
    let contract = fixture_contract()?;
    let app = scratch("macos")?.join("Scout Desktop.app/Contents");
    fs::create_dir_all(app.join("MacOS"))?;
    populate(&app.join("Resources").join(MODEL_DIRECTORY_NAME), &contract)?;
    let found = ModelPaths::locate_installed(&app.join("MacOS/scout-client"), None, &contract)?;
    assert!(found.vad.is_file());
    Ok(())
}

#[test]
fn finds_the_development_directory_beside_the_profile_directory() -> TestResult {
    let contract = fixture_contract()?;
    let target = scratch("dev")?;
    fs::create_dir_all(target.join("debug"))?;
    populate(&target.join(MODEL_DIRECTORY_NAME), &contract)?;
    let found = ModelPaths::locate_installed(&target.join("debug/scout-client"), None, &contract)?;
    assert!(found.keywords.is_file());
    Ok(())
}

#[test]
fn finds_the_per_user_data_directory_last() -> TestResult {
    let contract = fixture_contract()?;
    let root = scratch("data")?;
    let data = root.join("data");
    populate(&data.join(MODEL_DIRECTORY_NAME), &contract)?;
    let executable = root.join("app/scout-client");
    let candidates = model_directories(&executable, Some(&data));
    assert_eq!(candidates.last(), Some(&data.join(MODEL_DIRECTORY_NAME)));
    assert!(ModelPaths::locate_installed(&executable, Some(&data), &contract).is_ok());
    Ok(())
}

#[test]
fn a_missing_directory_names_the_first_candidate() -> TestResult {
    let contract = fixture_contract()?;
    let install = scratch("missing")?;
    let error = ModelPaths::locate_installed(&install.join("scout-client"), None, &contract)
        .err()
        .ok_or("expected an error")?;
    assert!(
        matches!(&error, VoiceError::MissingModel(path) if path == &install.join("voice-models"))
    );
    Ok(())
}

#[test]
fn an_incomplete_directory_fails_instead_of_falling_through() -> TestResult {
    let contract = fixture_contract()?;
    let root = scratch("incomplete")?;
    let data = root.join("data");
    populate(&data.join(MODEL_DIRECTORY_NAME), &contract)?;
    let beside = root.join("app").join(MODEL_DIRECTORY_NAME);
    populate(&beside, &contract)?;
    fs::remove_file(beside.join(&contract.models.vad.name))?;
    let error =
        ModelPaths::locate_installed(&root.join("app/scout-client"), Some(&data), &contract)
            .err()
            .ok_or("expected an error")?;
    assert!(matches!(error, VoiceError::MissingModel(_)));
    Ok(())
}

#[test]
fn an_altered_model_fails_its_checksum() -> TestResult {
    let contract = fixture_contract()?;
    let install = scratch("altered")?;
    let dir = install.join(MODEL_DIRECTORY_NAME);
    populate(&dir, &contract)?;
    fs::write(
        dir.join(&contract.models.keyword_spotter.encoder.name),
        b"tampered",
    )?;
    let error = ModelPaths::locate_installed(&install.join("scout-client"), None, &contract)
        .err()
        .ok_or("expected an error")?;
    assert!(matches!(error, VoiceError::ModelChecksum { .. }));
    Ok(())
}
