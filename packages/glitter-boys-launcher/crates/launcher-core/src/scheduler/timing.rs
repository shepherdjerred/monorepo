//! Monotonic session clocks and bounded, phase-local throughput samples.
use crate::Progress;
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default)]
pub struct Timing {
    /// Time enabled in this launcher session, including task-slot waits, excluding pauses.
    pub elapsed: Option<Duration>,
    pub bytes_per_second: Option<f64>,
    /// Current stage only; later setup and extraction are not predicted.
    pub remaining: Option<Duration>,
}

#[derive(Default)]
pub(super) struct Clock {
    accumulated: Duration,
    since: Option<Instant>,
    used: bool,
}
impl Clock {
    pub fn set_running(&mut self, running: bool, now: Instant) {
        if running && self.since.is_none() {
            self.since = Some(now);
            self.used = true;
        } else if !running && let Some(since) = self.since.take() {
            self.accumulated += now.duration_since(since);
        }
    }
    pub fn elapsed(&self, now: Instant) -> Option<Duration> {
        self.used.then(|| {
            self.accumulated + self.since.map_or(Duration::ZERO, |s| now.duration_since(s))
        })
    }
}

#[derive(Default)]
pub(super) struct Meter {
    pub progress: Option<Progress>,
    samples: VecDeque<(Instant, u64)>,
    changed: Option<Instant>,
}
impl Meter {
    pub fn update(&mut self, progress: Progress, now: Instant) {
        let reset = self.progress.as_ref().is_none_or(|p| {
            p.phase != progress.phase
                || p.total != progress.total
                || progress.completed < p.completed
        });
        if reset {
            self.samples.clear();
            self.changed = None;
        }
        if !reset
            && self
                .progress
                .as_ref()
                .is_some_and(|p| progress.completed > p.completed)
        {
            self.changed = Some(now);
        }
        // At most 34 samples, regardless of download chunk / extraction callback frequency.
        while self
            .samples
            .front()
            .is_some_and(|(at, _)| now.duration_since(*at) > Duration::from_secs(8))
        {
            self.samples.pop_front();
        }
        if self
            .samples
            .back()
            .is_none_or(|(at, _)| now.duration_since(*at) >= Duration::from_millis(250))
        {
            self.samples.push_back((now, progress.completed));
        }
        self.progress = Some(progress);
    }
    pub fn rate(&self, now: Instant) -> Option<f64> {
        let p = self.progress.as_ref()?;
        let changed = self.changed?;
        if p.total == 0 || now.duration_since(changed) >= Duration::from_secs(5) {
            return None;
        }
        let (at, bytes) = self.samples.front()?;
        let elapsed = now.duration_since(*at).as_secs_f64();
        let delta = p.completed.saturating_sub(*bytes);
        (elapsed >= 1.0 && delta > 0).then(|| delta as f64 / elapsed)
    }
}

pub(super) fn eta(remaining: u64, rate: Option<f64>) -> Option<Duration> {
    let seconds = remaining as f64 / rate?;
    if remaining == 0 || !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    Duration::try_from_secs_f64(seconds.ceil()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn progress(phase: &'static str, completed: u64) -> Progress {
        Progress {
            phase,
            completed,
            total: 10_000,
        }
    }
    #[test]
    fn resumed_bytes_phase_changes_stalls_and_counter_restarts_do_not_inflate_speed() {
        let now = Instant::now();
        let mut meter = Meter::default();
        meter.update(progress("Downloading", 5_000), now);
        assert_eq!(meter.rate(now), None);
        meter.update(progress("Downloading", 5_200), now + Duration::from_secs(2));
        assert_eq!(meter.rate(now + Duration::from_secs(2)), Some(100.0));
        assert_eq!(
            eta(4_800, meter.rate(now + Duration::from_secs(2))),
            Some(Duration::from_secs(48))
        );
        assert_eq!(meter.rate(now + Duration::from_secs(7)), None);
        meter.update(
            progress("Checking download", 8_000),
            now + Duration::from_secs(8),
        );
        assert_eq!(meter.rate(now + Duration::from_secs(8)), None);
        meter.update(
            progress("Checking download", 8_200),
            now + Duration::from_secs(10),
        );
        assert_eq!(meter.rate(now + Duration::from_secs(10)), Some(100.0));
        meter.update(
            progress("Checking download", 100),
            now + Duration::from_secs(11),
        );
        assert_eq!(meter.rate(now + Duration::from_secs(11)), None);
    }
    #[test]
    fn elapsed_freezes_and_resumes_without_counting_paused_time() {
        let now = Instant::now();
        let mut clock = Clock::default();
        assert_eq!(clock.elapsed(now), None);
        clock.set_running(true, now);
        clock.set_running(true, now + Duration::from_secs(2));
        clock.set_running(false, now + Duration::from_secs(10));
        assert_eq!(
            clock.elapsed(now + Duration::from_secs(60)),
            Some(Duration::from_secs(10))
        );
        clock.set_running(true, now + Duration::from_secs(60));
        assert_eq!(
            clock.elapsed(now + Duration::from_secs(65)),
            Some(Duration::from_secs(15))
        );
    }
    #[test]
    fn samples_are_bounded_and_follow_recent_throughput() {
        let now = Instant::now();
        let mut meter = Meter::default();
        for i in 0..100_000 {
            meter.update(
                Progress {
                    phase: "Unpacking",
                    completed: i,
                    total: 1_000_000,
                },
                now + Duration::from_millis(i),
            );
        }
        assert!(meter.samples.len() <= 34);
        assert_eq!(
            meter.rate(now + Duration::from_millis(99_999)),
            Some(1000.0)
        );
    }
}
