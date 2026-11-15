//! The whole cascade from a WAV file to an utterance, deterministic and
//! model-free so it runs in Linux CI.
//!
//! The fixture is a 48 kHz stereo WAV, so every run also goes through the
//! device-format path: irregular chunks, downmix, and rubato. Energy-based
//! fakes stand in for the models: a tone burst plays "hey scout", a second
//! burst plays the question, and silence ends it.

use std::io::Cursor;

use scout_client_core::live::gameflow::GameflowPhase;
use scout_voice::{
    AudioInput, EndReason, FileInput, KeywordHit, KeywordSpotter, MonoResampler, PipelineEventKind,
    Trigger, Utterance, Verification, VoiceActivity, VoiceCascade, VoiceError, VoicePipeline,
    VoiceState, WakeVerifier,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const RATE: u32 = 48_000;
const LOUD: f32 = 0.01;

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let len = f32::from(u16::try_from(samples.len()).unwrap_or(u16::MAX));
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / len).sqrt()
}

/// Fires on the first quiet frame after at least 400 ms of sound, reporting
/// where the sound ended, as sherpa reports a fragment's last token.
#[derive(Default)]
struct BurstSpotter {
    fragment: &'static str,
    loud_samples: usize,
    stream_samples: usize,
    last_loud_end: usize,
}

impl KeywordSpotter for BurstSpotter {
    fn accept(&mut self, samples: &[f32]) -> Result<Option<KeywordHit>, VoiceError> {
        self.stream_samples += samples.len();
        if rms(samples) > LOUD {
            self.loud_samples += samples.len();
            self.last_loud_end = self.stream_samples;
            return Ok(None);
        }
        if self.loud_samples < 6_400 {
            self.loud_samples = 0;
            return Ok(None);
        }
        let end = self.last_loud_end;
        self.reset();
        Ok(Some(KeywordHit {
            fragment: self.fragment.to_owned(),
            fragment_end_seconds: Some(
                f32::from(u16::try_from(end / 16).unwrap_or(u16::MAX)) / 1000.0,
            ),
        }))
    }

    fn reset(&mut self) {
        self.loud_samples = 0;
        self.stream_samples = 0;
        self.last_loud_end = 0;
    }
}

/// Speech is sound; a segment completes after 650 ms of quiet.
#[derive(Default)]
struct EnergyVad {
    active: bool,
    heard: bool,
    quiet_samples: usize,
}

impl VoiceActivity for EnergyVad {
    fn accept(&mut self, samples: &[f32]) {
        self.active = rms(samples) > LOUD;
        if self.active {
            self.heard = true;
            self.quiet_samples = 0;
        } else {
            self.quiet_samples += samples.len();
        }
    }

    fn speech_active(&self) -> bool {
        self.active
    }

    fn completed_speech(&self) -> bool {
        self.heard && self.quiet_samples >= 10_400
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}

/// Accepts when the window holds sound, and records the windows it scored.
struct ScriptedVerifier {
    accept: bool,
    calls: usize,
    window_lengths: Vec<usize>,
}

impl WakeVerifier for ScriptedVerifier {
    fn verify(&mut self, samples: &[f32]) -> Result<Verification, VoiceError> {
        self.calls += 1;
        self.window_lengths.push(samples.len());
        let heard = rms(&samples[samples.len().saturating_sub(32_000)..]) > LOUD / 4.0;
        Ok(Verification {
            accepted: self.accept && heard,
            score: if self.accept && heard { 0.9 } else { 0.01 },
        })
    }
}

type Pipeline = VoicePipeline<BurstSpotter, EnergyVad, ScriptedVerifier>;

fn pipeline(fragment: &'static str, accept: bool) -> Result<Pipeline, VoiceError> {
    Ok(VoicePipeline::new(
        VoiceCascade::shared()?,
        BurstSpotter {
            fragment,
            ..BurstSpotter::default()
        },
        EnergyVad::default(),
        ScriptedVerifier {
            accept,
            calls: 0,
            window_lengths: Vec::new(),
        },
    ))
}

/// Silence and tone segments as a 48 kHz stereo 16-bit WAV.
fn fixture(segments: &[(f64, f64)]) -> Result<Vec<u8>, hound::Error> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut bytes = Cursor::new(Vec::new());
    let mut writer = hound::WavWriter::new(&mut bytes, spec)?;
    let mut frame = 0_u32;
    for (seconds, hertz) in segments {
        for _ in 0..frames(*seconds) {
            let phase = f64::from(frame) / f64::from(RATE) * hertz * std::f64::consts::TAU;
            let value = if *hertz > 0.0 {
                phase.sin() * 8_000.0
            } else {
                0.0
            };
            #[expect(
                clippy::cast_possible_truncation,
                reason = "a scaled sine is within i16"
            )]
            let sample = value as i16;
            writer.write_sample(sample)?;
            writer.write_sample(sample)?;
            frame += 1;
        }
    }
    writer.finalize()?;
    Ok(bytes.into_inner())
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "fixture durations are a few positive seconds"
)]
fn frames(seconds: f64) -> u32 {
    (seconds * f64::from(RATE)) as u32
}

/// "hey scout", a pause, the question, then silence.
fn wake_then_question() -> Result<Vec<u8>, hound::Error> {
    fixture(&[
        (1.0, 0.0),
        (0.6, 1_000.0),
        (0.25, 0.0),
        (1.2, 300.0),
        (1.5, 0.0),
    ])
}

/// Play a file through irregular device-sized chunks into the pipeline.
fn play(pipeline: &mut Pipeline, wav: &[u8]) -> Result<Vec<Utterance>, VoiceError> {
    let mut input = FileInput::from_wav_bytes(wav)?.with_chunk_frames(&[441, 512, 480, 1_024, 37]);
    let mut resampler = MonoResampler::new(input.format())?;
    let mut utterances = Vec::new();
    while let Some(chunk) = input.next_chunk()? {
        let mono = resampler.process(&chunk)?;
        if let Some(utterance) = pipeline.accept(&mono)? {
            utterances.push(utterance);
        }
    }
    if let Some(utterance) = pipeline.accept(&resampler.flush()?)? {
        utterances.push(utterance);
    }
    Ok(utterances)
}

#[test]
fn a_wake_word_and_question_become_one_utterance() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    assert_eq!(pipeline.state(), VoiceState::Armed);
    let utterances = play(&mut pipeline, &wake_then_question()?)?;
    let [utterance] = utterances.as_slice() else {
        return Err(format!("expected one utterance, got {}", utterances.len()).into());
    };
    assert_eq!(utterance.trigger, Trigger::Wake);
    assert_eq!(utterance.reason, EndReason::EndOfSpeech);
    assert_eq!(utterance.wake_score, Some(0.9));
    // The pre-roll (capped at 2 s) plus the wake tail, the question and
    // the 650 ms end-of-speech silence.
    let duration = utterance.duration_ms();
    assert!(
        (3_600..=4_200).contains(&duration),
        "utterance was {duration} ms"
    );
    assert!(
        matches!(
            pipeline.state(),
            VoiceState::Ended {
                trigger: Trigger::Wake,
                reason: EndReason::EndOfSpeech
            }
        ),
        "{:?}",
        pipeline.state()
    );
    let kinds: Vec<PipelineEventKind> = pipeline
        .drain_events()
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        [
            PipelineEventKind::Candidate {
                fragment: "HEY_SCOUT".to_owned()
            },
            PipelineEventKind::Verified { score: 0.9 },
            PipelineEventKind::Ended,
        ]
    );
    pipeline.finish_turn();
    assert_eq!(pipeline.state(), VoiceState::Armed);
    Ok(())
}

#[test]
fn the_utterance_is_a_sixteen_kilohertz_mono_wav() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    let utterances = play(&mut pipeline, &wake_then_question()?)?;
    let utterance = utterances.first().ok_or("no utterance")?;
    let wav = utterance.to_wav()?;
    let reader = hound::WavReader::new(Cursor::new(&wav))?;
    let spec = reader.spec();
    assert_eq!(
        (spec.sample_rate, spec.channels, spec.bits_per_sample),
        (16_000, 1, 16)
    );
    assert_eq!(usize::try_from(reader.duration())?, utterance.samples.len());
    Ok(())
}

#[test]
fn the_verifier_waits_for_the_fragment_tail() -> TestResult {
    // HEY has 500 ms of the phrase still to come; the verifier must see it.
    let mut pipeline = pipeline("HEY", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    play(&mut pipeline, &wake_then_question()?)?;
    let events = pipeline.drain_events();
    let candidate = events.first().ok_or("no candidate")?.at_sample;
    let verified = events
        .iter()
        .find(|event| matches!(event.kind, PipelineEventKind::Verified { .. }))
        .ok_or("not verified")?
        .at_sample;
    // 500 ms tail + 150 ms margin, less what the spotter already consumed
    // past the fragment end (one quiet 20 ms frame).
    let waited_ms = (verified - candidate) / 16;
    assert!((600..=660).contains(&waited_ms), "waited {waited_ms} ms");
    Ok(())
}

#[test]
fn a_rejected_candidate_produces_nothing_and_keeps_listening() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", false)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    let utterances = play(&mut pipeline, &wake_then_question()?)?;
    assert_eq!(utterances.len(), 0);
    assert_eq!(pipeline.state(), VoiceState::Armed);
    assert!(
        pipeline
            .drain_events()
            .iter()
            .any(|event| matches!(event.kind, PipelineEventKind::Rejected { .. }))
    );
    Ok(())
}

#[test]
fn outside_a_game_the_microphone_is_closed_and_audio_is_dropped() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    for phase in ["ChampSelect", "GameStart"] {
        pipeline.set_gameflow_phase(&GameflowPhase::from_label(phase));
        assert!(!pipeline.wants_microphone());
        assert_eq!(play(&mut pipeline, &wake_then_question()?)?.len(), 0);
    }
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    assert!(pipeline.wants_microphone());
    pipeline.set_gameflow_phase(&GameflowPhase::EndOfGame);
    assert!(!pipeline.wants_microphone());
    assert_eq!(play(&mut pipeline, &wake_then_question()?)?.len(), 0);
    assert_eq!(pipeline.drain_events().len(), 0);
    Ok(())
}

#[test]
fn the_game_ending_mid_capture_discards_it() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    // Stop inside the question, before end of speech.
    let partial = fixture(&[(1.0, 0.0), (0.6, 1_000.0), (0.25, 0.0), (0.6, 300.0)])?;
    assert_eq!(play(&mut pipeline, &partial)?.len(), 0);
    assert!(matches!(pipeline.state(), VoiceState::Capturing { .. }));
    pipeline.set_gameflow_phase(&GameflowPhase::WaitingForStats);
    assert_eq!(pipeline.state(), VoiceState::Idle);
    assert_eq!(play(&mut pipeline, &fixture(&[(1.5, 0.0)])?)?.len(), 0);
    Ok(())
}

#[test]
fn push_to_talk_captures_while_held_even_out_of_game() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    assert!(pipeline.push_to_talk(true).is_none());
    assert!(pipeline.wants_microphone());
    // End of speech does not end a held capture.
    let held = play(&mut pipeline, &fixture(&[(0.8, 300.0), (1.0, 0.0)])?)?;
    assert_eq!(held.len(), 0);
    let utterance = pipeline
        .push_to_talk(false)
        .ok_or("no utterance on release")?;
    assert_eq!(utterance.trigger, Trigger::PushToTalk);
    assert_eq!(utterance.reason, EndReason::PushToTalkReleased);
    assert_eq!(utterance.wake_score, None);
    let duration = utterance.duration_ms();
    assert!(
        (1_700..=1_900).contains(&duration),
        "utterance was {duration} ms"
    );
    assert!(pipeline.push_to_talk(false).is_none(), "delivered twice");
    // The key does nothing until the turn is finished.
    assert!(pipeline.push_to_talk(true).is_none());
    assert!(
        pipeline.push_to_talk(false).is_none(),
        "an ended turn restarted"
    );
    pipeline.finish_turn();
    assert_eq!(pipeline.state(), VoiceState::Idle);
    Ok(())
}

#[test]
fn a_capture_ends_at_the_contract_limit() -> TestResult {
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    pipeline.push_to_talk(true);
    let utterances = play(&mut pipeline, &fixture(&[(16.0, 300.0)])?)?;
    let [utterance] = utterances.as_slice() else {
        return Err(format!("expected one utterance, got {}", utterances.len()).into());
    };
    assert_eq!(utterance.reason, EndReason::MaxDuration);
    assert_eq!(utterance.duration_ms(), 15_000);
    Ok(())
}

#[test]
fn a_short_request_spoken_straight_after_the_wake_phrase_ends_at_end_of_speech() -> TestResult {
    // "hey scout what's my CS" in one breath: the spotter only fires once the
    // whole burst is over, so every frame of speech is in the pre-roll and
    // none arrives after the candidate. The VAD must be primed with all of
    // it, or it never hears speech and the capture runs to the 15 s cap.
    let mut pipeline = pipeline("HEY_SCOUT", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    let wav = fixture(&[(1.0, 0.0), (0.6, 1_000.0), (1.0, 300.0), (16.0, 0.0)])?;
    let utterances = play(&mut pipeline, &wav)?;
    let [utterance] = utterances.as_slice() else {
        return Err(format!("expected one utterance, got {}", utterances.len()).into());
    };
    assert_eq!(utterance.trigger, Trigger::Wake);
    assert_eq!(utterance.reason, EndReason::EndOfSpeech);
    // The 2 s pre-roll plus the 650 ms end-of-speech silence and the 300 ms
    // post-verification hold, nowhere near the cap.
    let duration = utterance.duration_ms();
    assert!(
        (2_500..=3_500).contains(&duration),
        "utterance was {duration} ms"
    );
    Ok(())
}

#[test]
fn a_fragment_missing_from_the_tail_table_fails_loudly() -> TestResult {
    let mut pipeline = pipeline("SCOUT_PLEASE", true)?;
    pipeline.set_gameflow_phase(&GameflowPhase::InProgress);
    let result = play(&mut pipeline, &wake_then_question()?);
    assert!(
        matches!(result, Err(VoiceError::UnknownFragment(fragment)) if fragment == "SCOUT_PLEASE")
    );
    Ok(())
}
