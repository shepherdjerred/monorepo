//! Throughput of the parts that build everywhere: resampling and the tract
//! phrase verifier on the committed backend assets.
//!
//! `cargo bench -p scout-voice` prints real-time factors; the model-backed
//! latency numbers come from `examples/spike.rs`.

use std::hint::black_box;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use scout_voice::models::VerifierPaths;
use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
use scout_voice::{AudioFormat, MonoResampler, VoiceCascade, VoiceError, WakeVerifier};

fn backend_voice_assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../backend/assets/voice")
}

fn sine(rate: u32, channels: u16, seconds: u32) -> Vec<f32> {
    let frames = rate * seconds;
    (0..frames)
        .flat_map(|frame| {
            let phase = f64::from(frame) / f64::from(rate) * 440.0 * std::f64::consts::TAU;
            #[expect(clippy::cast_possible_truncation, reason = "a sine is in [-1, 1]")]
            let value = (phase.sin() * 0.5) as f32;
            std::iter::repeat_n(value, usize::from(channels))
        })
        .collect()
}

fn report(name: &str, audio: Duration, spent: Duration) {
    let factor = spent.as_secs_f64() / audio.as_secs_f64();
    println!(
        "{name}: {:.3} ms for {:.1} s of audio, real-time factor {factor:.5} ({:.2}% of one core)",
        spent.as_secs_f64() * 1000.0,
        audio.as_secs_f64(),
        factor * 100.0
    );
}

fn main() -> Result<(), VoiceError> {
    let seconds = 60;
    let input = sine(48_000, 2, seconds);
    let mut resampler = MonoResampler::new(AudioFormat {
        sample_rate_hz: 48_000,
        channels: 2,
    })?;
    let started = Instant::now();
    let mut produced = 0;
    for chunk in input.chunks(960) {
        produced += black_box(resampler.process(chunk)?).len();
    }
    report(
        "resample 48 kHz stereo to 16 kHz mono",
        Duration::from_secs(u64::from(seconds)),
        started.elapsed(),
    );
    println!(
        "  produced {produced} samples, delay {} frames",
        resampler.delay_frames()
    );

    let contract = VoiceCascade::shared()?;
    let paths = VerifierPaths::locate(&backend_voice_assets(), &contract)?;
    let loaded = Instant::now();
    let mut verifier = TractWakeVerifier::load(
        VerifierGraphs {
            melspectrogram: &paths.melspectrogram,
            embedding: &paths.embedding,
            classifier: &paths.classifier,
        },
        paths.threshold,
    )?;
    println!(
        "verifier load: {:.1} ms",
        loaded.elapsed().as_secs_f64() * 1000.0
    );
    let window = sine(16_000, 1, 2);
    let runs = 50;
    let started = Instant::now();
    for _ in 0..runs {
        black_box(verifier.verify(&window)?);
    }
    let per_call = started.elapsed() / runs;
    println!(
        "verifier: {:.2} ms per two-second window",
        per_call.as_secs_f64() * 1000.0
    );
    Ok(())
}
