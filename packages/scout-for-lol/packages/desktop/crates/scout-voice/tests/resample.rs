//! Device-format audio through the file-backed source and the resampler,
//! checked for the glitches a live capture path can introduce: dropped or
//! repeated chunks, discontinuities, and drift in the sample count.

use scout_voice::{AudioFormat, AudioInput, FileInput, MonoResampler};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const TONE_HZ: f64 = 1_000.0;
const AMPLITUDE: f64 = 0.5;

fn tone(rate: u32, channels: u16, seconds: u32) -> Vec<f32> {
    (0..rate * seconds)
        .flat_map(|frame| {
            let phase = f64::from(frame) / f64::from(rate) * TONE_HZ * std::f64::consts::TAU;
            #[expect(
                clippy::cast_possible_truncation,
                reason = "a scaled sine is in [-1, 1]"
            )]
            let value = (phase.sin() * AMPLITUDE) as f32;
            std::iter::repeat_n(value, usize::from(channels))
        })
        .collect()
}

fn resample_in_chunks(
    format: AudioFormat,
    samples: Vec<f32>,
    pattern: &[usize],
) -> Result<(Vec<f32>, usize), Box<dyn std::error::Error>> {
    let mut input = FileInput::from_samples(format, samples).with_chunk_frames(pattern);
    let mut resampler = MonoResampler::new(format)?;
    let mut output = Vec::new();
    while let Some(chunk) = input.next_chunk()? {
        output.extend(resampler.process(&chunk)?);
    }
    output.extend(resampler.flush()?);
    Ok((output, resampler.delay_frames()))
}

/// The largest step between neighbouring samples. A clean 1 kHz tone at
/// 16 kHz steps at most `2 A sin(pi f / fs)`; a dropped or repeated chunk
/// jumps the phase and steps much further.
fn largest_step(samples: &[f32]) -> f64 {
    samples
        .windows(2)
        .map(|pair| f64::from((pair[1] - pair[0]).abs()))
        .fold(0.0, f64::max)
}

fn clean_step_limit() -> f64 {
    2.0 * AMPLITUDE * (std::f64::consts::PI * TONE_HZ / 16_000.0).sin() * 1.05
}

#[test]
fn irregular_device_chunks_give_the_same_output_as_one_buffer() -> TestResult {
    for rate in [48_000, 44_100] {
        let format = AudioFormat {
            sample_rate_hz: rate,
            channels: 2,
        };
        let samples = tone(rate, 2, 3);
        let (chunked, _) =
            resample_in_chunks(format, samples.clone(), &[441, 512, 480, 1_024, 37, 1])?;
        let (whole, _) = resample_in_chunks(format, samples, &[usize::MAX / 4])?;
        assert_eq!(chunked.len(), whole.len(), "{rate} Hz");
        let largest_difference = chunked
            .iter()
            .zip(&whole)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            largest_difference < 1e-6,
            "{rate} Hz differed by {largest_difference}"
        );
    }
    Ok(())
}

#[test]
fn a_resampled_tone_has_no_discontinuities_or_drift() -> TestResult {
    for rate in [48_000, 44_100] {
        let format = AudioFormat {
            sample_rate_hz: rate,
            channels: 2,
        };
        let seconds = 5;
        let (output, delay) = resample_in_chunks(format, tone(rate, 2, seconds), &[441, 480, 512])?;
        let expected = usize::try_from(16_000 * seconds)?;
        // Flushing pads the final partial chunk, so the count is exact to
        // within one resampler chunk plus its delay.
        assert!(
            output.len() >= expected && output.len() <= expected + delay + 1_024,
            "{rate} Hz gave {} samples for {expected}",
            output.len()
        );
        // Skip the resampler's start-up delay and the padded end.
        let steady = &output[delay + 64..expected - 64];
        let step = largest_step(steady);
        assert!(step <= clean_step_limit(), "{rate} Hz stepped {step}");
        let peak = steady
            .iter()
            .map(|sample| f64::from(sample.abs()))
            .fold(0.0, f64::max);
        assert!(
            (peak - AMPLITUDE).abs() < 0.02,
            "{rate} Hz peaked at {peak}"
        );
    }
    Ok(())
}

#[test]
fn a_dropped_chunk_is_detectable() -> TestResult {
    // The glitch check itself must catch the failure it guards against.
    let format = AudioFormat {
        sample_rate_hz: 48_000,
        channels: 2,
    };
    let mut samples = tone(48_000, 2, 2);
    samples.drain(48_000..48_000 + 2 * 437);
    let (output, delay) = resample_in_chunks(format, samples, &[480])?;
    let step = largest_step(&output[delay + 64..output.len() - 2_048]);
    assert!(
        step > clean_step_limit(),
        "a dropped chunk stepped only {step}"
    );
    Ok(())
}

#[test]
fn sixteen_kilohertz_mono_passes_through_unchanged() -> TestResult {
    let format = AudioFormat {
        sample_rate_hz: 16_000,
        channels: 1,
    };
    let samples = tone(16_000, 1, 1);
    let (output, delay) = resample_in_chunks(format, samples.clone(), &[320, 7])?;
    assert_eq!(delay, 0);
    assert_eq!(output, samples);
    Ok(())
}

#[test]
fn a_partial_frame_is_rejected() -> TestResult {
    let mut resampler = MonoResampler::new(AudioFormat {
        sample_rate_hz: 48_000,
        channels: 2,
    })?;
    assert!(resampler.process(&[0.0; 3]).is_err());
    Ok(())
}
