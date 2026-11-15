//! The spike's latency measurements on real models (Windows and macOS).
//!
//! ```text
//! cargo run --release -p scout-voice --example spike -- <model-dir> latency <wake.wav> <question.wav>
//! cargo run --release -p scout-voice --example spike -- <model-dir> idle <seconds> [realtime]
//! cargo run --release -p scout-voice --example spike -- <model-dir> verify <clip.wav>...
//! ```
//!
//! `latency` plays one second of silence, the wake clip, 250 ms of silence,
//! the question and two seconds of silence through the full cascade, and
//! reports when each stage fired relative to where the speech actually ends.
//! `idle` keeps the cascade armed over silence and reports the detectors'
//! compute per second of audio; with `realtime` it paces input like a
//! microphone, for measuring the process with `/usr/bin/time -l`.
//! `verify` scores each clip as recorded, the same arrays the ONNX Runtime
//! verifier in `packages/voice-assistant` is compared on.

#[cfg(any(windows, target_os = "macos"))]
mod spike {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use scout_client_core::live::gameflow::GameflowPhase;
    use scout_voice::audio::read_wav;
    use scout_voice::models::ModelPaths;
    use scout_voice::sherpa::{SherpaKeywordSpotter, SherpaVad};
    use scout_voice::verifier::{TractWakeVerifier, VerifierGraphs};
    use scout_voice::{
        KeywordHit, KeywordSpotter, MonoResampler, PipelineEventKind, Verification, VoiceActivity,
        VoiceCascade, VoiceError, VoicePipeline, WakeVerifier,
    };

    type Error = Box<dyn std::error::Error>;

    /// A detector with its compute time recorded.
    struct Timed<T> {
        inner: T,
        spent: Duration,
        calls: u32,
    }

    impl<T> Timed<T> {
        fn new(inner: T) -> Self {
            Self {
                inner,
                spent: Duration::ZERO,
                calls: 0,
            }
        }

        fn time<R>(&mut self, run: impl FnOnce(&mut T) -> R) -> R {
            let started = Instant::now();
            let result = run(&mut self.inner);
            self.spent += started.elapsed();
            self.calls += 1;
            result
        }
    }

    impl<T: KeywordSpotter> KeywordSpotter for Timed<T> {
        fn accept(&mut self, samples: &[f32]) -> Result<Option<KeywordHit>, VoiceError> {
            self.time(|inner| inner.accept(samples))
        }

        fn reset(&mut self) {
            self.inner.reset();
        }
    }

    impl<T: VoiceActivity> VoiceActivity for Timed<T> {
        fn accept(&mut self, samples: &[f32]) {
            self.time(|inner| inner.accept(samples));
        }

        fn speech_active(&self) -> bool {
            self.inner.speech_active()
        }

        fn completed_speech(&self) -> bool {
            self.inner.completed_speech()
        }

        fn reset(&mut self) {
            self.inner.reset();
        }
    }

    impl<T: WakeVerifier> WakeVerifier for Timed<T> {
        fn verify(&mut self, samples: &[f32]) -> Result<Verification, VoiceError> {
            self.time(|inner| inner.verify(samples))
        }
    }

    type Pipeline =
        VoicePipeline<Timed<SherpaKeywordSpotter>, Timed<SherpaVad>, Timed<TractWakeVerifier>>;

    fn pipeline(dir: &Path) -> Result<Pipeline, Error> {
        let contract = VoiceCascade::shared()?;
        let loading = Instant::now();
        let paths = ModelPaths::locate(dir, &contract)?;
        let spotter = SherpaKeywordSpotter::load(&paths, &contract)?;
        let vad = SherpaVad::load(&paths, &contract)?;
        let verifier = TractWakeVerifier::load(
            VerifierGraphs {
                melspectrogram: &paths.verifier.melspectrogram,
                embedding: &paths.verifier.embedding,
                classifier: &paths.verifier.classifier,
            },
            paths.verifier.threshold,
        )?;
        println!(
            "models checked and loaded in {:.0} ms",
            loading.elapsed().as_secs_f64() * 1000.0
        );
        let mut pipeline = VoicePipeline::new(
            contract,
            Timed::new(spotter),
            Timed::new(vad),
            Timed::new(verifier),
        );
        pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
        Ok(pipeline)
    }

    /// A clip at 16 kHz mono, and the sample index its speech ends at.
    fn clip(path: &Path) -> Result<(Vec<f32>, usize), Error> {
        let (format, samples) = read_wav(&std::fs::read(path)?)?;
        let mut resampler = MonoResampler::new(format)?;
        let mut mono = resampler.process(&samples)?;
        mono.extend(resampler.flush()?);
        let speech_end = mono
            .iter()
            .rposition(|sample| sample.abs() > 0.02)
            .map_or(0, |index| index + 1);
        Ok((mono, speech_end))
    }

    fn ms(samples: u64) -> f64 {
        #[expect(clippy::cast_precision_loss, reason = "sample counts are small")]
        let samples = samples as f64;
        samples / 16.0
    }

    fn latency(dir: &Path, wake: &Path, question: &Path) -> Result<(), Error> {
        let mut pipeline = pipeline(dir)?;
        let (wake, wake_end) = clip(wake)?;
        let (question, question_end) = clip(question)?;
        let silence = |seconds: usize| vec![0.0_f32; seconds * 16];
        let mut audio = silence(1_000);
        let wake_end = u64::try_from(audio.len() + wake_end)?;
        audio.extend(&wake);
        audio.extend(silence(250));
        let question_end = u64::try_from(audio.len() + question_end)?;
        audio.extend(&question);
        audio.extend(silence(2_000));
        let started = Instant::now();
        let mut slowest_frame = Duration::ZERO;
        let mut utterance = None;
        for frame in audio.chunks(320) {
            let frame_started = Instant::now();
            if let Some(ended) = pipeline.accept(frame)? {
                utterance = Some(ended);
            }
            slowest_frame = slowest_frame.max(frame_started.elapsed());
        }
        let wall = started.elapsed();
        for event in pipeline.drain_events() {
            let (anchor, name) = match event.kind {
                PipelineEventKind::Candidate { .. } | PipelineEventKind::Verified { .. } => {
                    (wake_end, "after the wake phrase ends")
                }
                PipelineEventKind::Rejected { .. } | PipelineEventKind::Ended => {
                    (question_end, "after the question ends")
                }
            };
            let delta = ms(event.at_sample) - ms(anchor);
            println!("{:?}: {delta:+.0} ms {name}", event.kind);
        }
        println!(
            "spotter {:.2} ms/call over {} calls; VAD {:.2} ms/call over {}; verifier {:.1} ms/call over {}",
            per_call(pipeline_spotter(&pipeline)),
            pipeline_spotter(&pipeline).1,
            per_call(pipeline_vad(&pipeline)),
            pipeline_vad(&pipeline).1,
            per_call(pipeline_verifier(&pipeline)),
            pipeline_verifier(&pipeline).1,
        );
        println!(
            "processed {:.1} s of audio in {:.0} ms; slowest 20 ms frame {:.1} ms",
            ms(u64::try_from(audio.len())?) / 1000.0,
            wall.as_secs_f64() * 1000.0,
            slowest_frame.as_secs_f64() * 1000.0
        );
        match utterance {
            Some(utterance) => println!(
                "utterance: {:?} {:?}, {} ms, wake score {:?}, {} WAV bytes",
                utterance.trigger,
                utterance.reason,
                utterance.duration_ms(),
                utterance.wake_score,
                utterance.to_wav()?.len()
            ),
            None => println!("no utterance"),
        }
        Ok(())
    }

    fn per_call((spent, calls): (Duration, u32)) -> f64 {
        if calls == 0 {
            0.0
        } else {
            spent.as_secs_f64() * 1000.0 / f64::from(calls)
        }
    }

    fn pipeline_spotter(pipeline: &Pipeline) -> (Duration, u32) {
        let timed = pipeline.spotter();
        (timed.spent, timed.calls)
    }

    fn pipeline_vad(pipeline: &Pipeline) -> (Duration, u32) {
        let timed = pipeline.vad();
        (timed.spent, timed.calls)
    }

    fn pipeline_verifier(pipeline: &Pipeline) -> (Duration, u32) {
        let timed = pipeline.verifier();
        (timed.spent, timed.calls)
    }

    fn idle(dir: &Path, seconds: u64, realtime: bool) -> Result<(), Error> {
        let mut pipeline = pipeline(dir)?;
        let frame = vec![0.0_f32; 320];
        let frames = seconds * 50;
        let started = Instant::now();
        for index in 0..frames {
            pipeline.accept(&frame)?;
            if realtime {
                let due = Duration::from_millis((index + 1) * 20);
                if let Some(wait) = due.checked_sub(started.elapsed()) {
                    std::thread::sleep(wait);
                }
            }
        }
        let (spent, calls) = pipeline_spotter(&pipeline);
        #[expect(clippy::cast_precision_loss, reason = "seconds are small")]
        let audio_seconds = seconds as f64;
        println!(
            "armed over {seconds} s of silence: spotter {:.0} ms total, {:.3} ms per 20 ms frame ({calls} calls), {:.2}% of one core",
            spent.as_secs_f64() * 1000.0,
            per_call((spent, calls)),
            spent.as_secs_f64() / audio_seconds * 100.0
        );
        println!("wall {:.1} s", started.elapsed().as_secs_f64());
        Ok(())
    }

    fn verify(dir: &Path, clips: &[String]) -> Result<(), Error> {
        let contract = VoiceCascade::shared()?;
        let paths = ModelPaths::locate(dir, &contract)?;
        let mut verifier = TractWakeVerifier::load(
            VerifierGraphs {
                melspectrogram: &paths.verifier.melspectrogram,
                embedding: &paths.verifier.embedding,
                classifier: &paths.verifier.classifier,
            },
            paths.verifier.threshold,
        )?;
        for clip in clips {
            let (_, samples) = read_wav(&std::fs::read(clip)?)?;
            println!("{clip}: {:?}", verifier.verify(&samples)?);
        }
        println!("silence: {:?}", verifier.verify(&vec![0.0; 32_000])?);
        Ok(())
    }

    pub fn main() -> Result<(), Error> {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let usage = "usage: spike <model-dir> latency <wake.wav> <question.wav> | idle <seconds> [realtime] | verify <clip.wav>...";
        let dir = PathBuf::from(args.first().ok_or(usage)?);
        match args.get(1).map(String::as_str) {
            Some("latency") => latency(
                &dir,
                Path::new(args.get(2).ok_or(usage)?),
                Path::new(args.get(3).ok_or(usage)?),
            ),
            Some("idle") => idle(
                &dir,
                args.get(2).ok_or(usage)?.parse()?,
                args.get(3).is_some_and(|flag| flag == "realtime"),
            ),
            Some("verify") => verify(&dir, args.get(2..).unwrap_or_default()),
            _ => Err(usage.into()),
        }
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    spike::main()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("the spike needs sherpa-onnx, which builds only on Windows and macOS".into())
}
