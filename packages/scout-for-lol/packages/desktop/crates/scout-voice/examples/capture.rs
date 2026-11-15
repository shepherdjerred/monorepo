//! Live microphone capture through cpal and rubato (Windows and macOS).
//!
//! ```text
//! cargo run --release -p scout-voice --example capture -- <seconds> [model-dir]
//! ```
//!
//! Reports the device format, callback sizes, chunks dropped because the
//! reader fell behind, and whether the 16 kHz sample count kept pace with
//! the wall clock. With a model directory it also runs the armed cascade on
//! the live input, for measuring idle-listening CPU with `/usr/bin/time -l`.
//! Nothing is written to disk.

#[cfg(any(windows, target_os = "macos"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use std::path::Path;
    use std::time::{Duration, Instant};

    use scout_client_core::live::gameflow::GameflowPhase;
    use scout_voice::capture::CpalInput;
    use scout_voice::models::ModelPaths;
    use scout_voice::sherpa::{SherpaKeywordSpotter, SherpaVad};
    use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
    use scout_voice::{AudioInput, MonoResampler, VoiceCascade, VoicePipeline};

    let mut args = std::env::args().skip(1);
    let seconds: u64 = args
        .next()
        .ok_or("usage: capture <seconds> [model-dir]")?
        .parse()?;
    let mut pipeline = match args.next() {
        Some(dir) => {
            let contract = VoiceCascade::shared()?;
            let paths = ModelPaths::locate(Path::new(&dir), &contract)?;
            let mut pipeline = VoicePipeline::new(
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
            pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
            Some(pipeline)
        }
        None => None,
    };

    let mut input = CpalInput::open_default()?;
    let format = input.format();
    println!("device format: {format:?}");
    let mut resampler = MonoResampler::new(format)?;
    let started = Instant::now();
    let (mut smallest, mut largest, mut produced) = (usize::MAX, 0, 0_usize);
    let mut peak = 0.0_f32;
    let mut utterances = 0;
    while started.elapsed() < Duration::from_secs(seconds) {
        let Some(chunk) = input.next_chunk()? else {
            break;
        };
        let frames = chunk.len() / usize::from(format.channels);
        smallest = smallest.min(frames);
        largest = largest.max(frames);
        peak = chunk
            .iter()
            .fold(peak, |peak, sample| peak.max(sample.abs()));
        let mono = resampler.process(&chunk)?;
        produced += mono.len();
        if let Some(pipeline) = pipeline.as_mut()
            && let Some(mut utterance) = pipeline.accept(&mono)?
        {
            utterances += 1;
            println!(
                "utterance {:?} {:?} {} ms, wake score {:?}",
                utterance.trigger,
                utterance.reason,
                utterance.duration_ms(),
                utterance.wake_score
            );
            utterance.erase();
            pipeline.finish_turn();
        }
    }
    let elapsed = started.elapsed().as_secs_f64();
    #[expect(clippy::cast_precision_loss, reason = "sample counts are small")]
    let produced_seconds = produced as f64 / 16_000.0;
    println!(
        "{} callbacks of {smallest}..={largest} frames; {} chunks dropped",
        input.callbacks(),
        input.dropped_chunks()
    );
    println!(
        "16 kHz output {produced_seconds:.3} s over {elapsed:.3} s wall ({:+.1} ms behind, resampler delay {} frames); peak level {peak:.4}",
        (elapsed - produced_seconds) * 1000.0,
        resampler.delay_frames()
    );
    if pipeline.is_some() {
        println!("{utterances} utterances");
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("microphone capture builds only on Windows and macOS".into())
}
