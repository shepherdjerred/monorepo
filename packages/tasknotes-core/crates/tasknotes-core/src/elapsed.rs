//! Elapsed-time formatting for time tracking.
//!
//! `H:MM:SS` once an hour has passed, `MM:SS` before that — a running timer
//! that does not change width every minute, and does not pad an hours field
//! that is usually zero.
//!
//! ## Durations are unsigned here
//!
//! The TypeScript takes a `number` and opens with `Math.max(0,
//! Math.floor(seconds))`, because JavaScript has one numeric type and the value
//! could be anything. Both guards move into the type: [`format_elapsed`] takes
//! a `u64`, so there is no negative duration to clamp and no fraction to floor,
//! and the one place a negative *could* arise — a `startTime` ahead of `now`,
//! which is clock skew rather than a negative duration — is clamped where it
//! actually happens, in [`elapsed_seconds_since`].

use chrono::{DateTime, Utc};

use crate::{Error, Result};

/// Format a duration as `H:MM:SS`, or `MM:SS` under an hour.
///
/// Minutes and seconds are always two digits; hours are not padded, so ten
/// hours reads `10:00:00` and one reads `1:00:00`.
#[must_use]
pub fn format_elapsed(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let remainder = seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{remainder:02}")
    } else {
        format!("{minutes:02}:{remainder:02}")
    }
}

/// Whole seconds between a stored `startTime` and `now`.
///
/// `start` is an RFC 3339 timestamp — the form the server writes, since every
/// `startTime` it emits comes from `Date.prototype.toISOString`. A zoneless
/// value is rejected rather than guessed at: without an offset there is no way
/// to place it on the timeline, and picking one would make a running timer's
/// reading depend on where the user happens to be sitting.
///
/// A `start` after `now` yields `0`. That is not a swallowed error — it is
/// clock skew between the host and whatever wrote the entry, and a timer that
/// sits at `00:00` until it catches up is the correct rendering of "no time has
/// elapsed yet".
///
/// # Errors
///
/// Returns [`Error::Validation`] when `start` is not a parseable RFC 3339
/// timestamp. **This diverges from the TypeScript**, which returns `0` for an
/// unparseable value; a timer frozen at `00:00` is indistinguishable from a
/// session that just began, so a corrupt `timeEntries` row would be invisible.
/// The typed failure hands the shell the choice the silent zero took away.
pub fn elapsed_seconds_since(start: &str, now: DateTime<Utc>) -> Result<u64> {
    let started = DateTime::parse_from_rfc3339(start).map_err(|error| {
        Error::validation(format!(
            "startTime {start:?} is not an RFC 3339 timestamp: {error}"
        ))
    })?;
    let seconds = now.signed_duration_since(started).num_seconds();
    // The only way this conversion fails is a negative duration, which is
    // exactly the clock-skew case documented above.
    Ok(u64::try_from(seconds).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};

    use super::{elapsed_seconds_since, format_elapsed};

    fn instant(raw: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(raw).unwrap().to_utc()
    }

    #[test]
    fn under_a_minute_renders_as_zero_minutes() {
        assert_eq!(format_elapsed(0), "00:00");
        assert_eq!(format_elapsed(7), "00:07");
        assert_eq!(format_elapsed(45), "00:45");
    }

    #[test]
    fn under_an_hour_renders_as_minutes_and_seconds() {
        assert_eq!(format_elapsed(60), "01:00");
        assert_eq!(format_elapsed(605), "10:05");
        assert_eq!(format_elapsed(3599), "59:59");
    }

    #[test]
    fn an_hour_or_more_gains_an_unpadded_hours_field() {
        assert_eq!(format_elapsed(3600), "1:00:00");
        assert_eq!(format_elapsed(3725), "1:02:05");
        assert_eq!(format_elapsed(36_000), "10:00:00");
    }

    /// The TypeScript "clamps negative input to zero" and "floors fractional
    /// seconds" tests both assert something `u64` makes unrepresentable. What
    /// is left to check is that the boundary they guarded still holds.
    #[test]
    fn the_hour_boundary_is_exact() {
        assert_eq!(format_elapsed(3599), "59:59");
        assert_eq!(format_elapsed(3600), "1:00:00");
    }

    #[test]
    fn computes_elapsed_seconds_against_a_fixed_now() {
        let elapsed = elapsed_seconds_since(
            "2026-05-10T12:00:00.000Z",
            instant("2026-05-10T12:00:30.500Z"),
        )
        .unwrap();
        assert_eq!(elapsed, 30);
    }

    #[test]
    fn an_offset_start_is_placed_on_the_timeline_by_its_own_offset() {
        let elapsed =
            elapsed_seconds_since("2026-05-10T21:00:00+09:00", instant("2026-05-10T12:00:30Z"))
                .unwrap();
        assert_eq!(elapsed, 30);
    }

    #[test]
    fn a_start_after_now_clamps_to_zero() {
        let elapsed = elapsed_seconds_since(
            "2026-05-10T12:00:30.000Z",
            instant("2026-05-10T12:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(elapsed, 0);
    }

    #[test]
    fn an_unparseable_start_fails_loudly() {
        let error =
            elapsed_seconds_since("not a date", instant("2026-05-10T12:00:00Z")).unwrap_err();
        assert!(
            error.to_string().contains("not an RFC 3339 timestamp"),
            "unexpected error: {error}"
        );
        assert!(
            elapsed_seconds_since("2026-05-10T12:00:00", instant("2026-05-10T12:00:00Z")).is_err()
        );
    }
}
