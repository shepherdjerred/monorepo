//! Elapsed-time formatting for the running timer.
//!
//! `H:MM:SS` once an hour has passed, `MM:SS` before that — a timer that does
//! not change width every minute and does not pad an hours field that is
//! usually zero.
//!
//! Both of the TypeScript's opening guards (`Math.max(0, …)` and
//! `Math.floor(…)`) live in the types here: [`elapsed_format`] takes a `u64`, so
//! there is no negative duration to clamp and no fraction to floor, and the one
//! place a negative genuinely arises — a `startTime` ahead of `now`, which is
//! clock skew — is clamped inside [`elapsed_seconds_since`] where it happens.

use chrono::{DateTime, Utc};
use tasknotes_core::elapsed;

use crate::error::CoreError;

/// Format a duration as `H:MM:SS`, or `MM:SS` under an hour.
///
/// Minutes and seconds are always two digits; hours are not padded, so ten
/// hours reads `10:00:00` and one reads `1:00:00`.
#[uniffi::export]
#[must_use]
pub fn elapsed_format(seconds: u64) -> String {
    elapsed::format_elapsed(seconds)
}

/// Whole seconds between a stored `startTime` and `now`.
///
/// Both are RFC 3339 timestamps — the form the server writes, since every
/// `startTime` it emits comes from `Date.prototype.toISOString`. A zoneless
/// value is rejected rather than guessed at: without an offset there is no way
/// to place it on the timeline, and picking one would make a running timer's
/// reading depend on where the user happens to be sitting.
///
/// A `start` after `now` yields `0` — clock skew between the host and whatever
/// wrote the entry, and a timer sitting at `00:00` until it catches up is the
/// correct rendering of "no time has elapsed yet".
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either argument is not a parseable
/// RFC 3339 timestamp. **This diverges from the TypeScript**, which returns `0`
/// for an unparseable value: a timer frozen at `00:00` is indistinguishable
/// from a session that just began, so a corrupt `timeEntries` row would be
/// invisible.
#[uniffi::export]
pub fn elapsed_seconds_since(start: &str, now: &str) -> Result<u64, CoreError> {
    let now: DateTime<Utc> = DateTime::parse_from_rfc3339(now)
        .map_err(|error| CoreError::Validation {
            message: format!("now {now:?} is not an RFC 3339 timestamp: {error}"),
        })?
        .to_utc();
    elapsed::elapsed_seconds_since(start, now).map_err(CoreError::from)
}

#[cfg(test)]
mod tests {
    use super::{elapsed_format, elapsed_seconds_since};
    use crate::error::CoreError;

    #[test]
    fn the_hours_field_appears_only_once_it_is_needed() {
        assert_eq!(elapsed_format(0), "00:00");
        assert_eq!(elapsed_format(59), "00:59");
        assert_eq!(elapsed_format(3599), "59:59");
        assert_eq!(elapsed_format(3600), "1:00:00");
        assert_eq!(elapsed_format(36_000), "10:00:00");
    }

    #[test]
    fn a_running_session_counts_forward_and_clock_skew_reads_zero() {
        assert_eq!(
            elapsed_seconds_since("2026-08-08T10:00:00Z", "2026-08-08T10:01:30Z").unwrap(),
            90
        );
        assert_eq!(
            elapsed_seconds_since("2026-08-08T10:01:30Z", "2026-08-08T10:00:00Z").unwrap(),
            0,
            "a start ahead of now is clock skew, not a negative duration"
        );
    }

    #[test]
    fn a_zoneless_timestamp_is_rejected_on_either_side() {
        for (start, now) in [
            ("2026-08-08T10:00:00", "2026-08-08T10:01:00Z"),
            ("2026-08-08T10:00:00Z", "2026-08-08T10:01:00"),
        ] {
            let error = elapsed_seconds_since(start, now).unwrap_err();
            assert!(
                matches!(error, CoreError::Validation { ref message } if message.contains("RFC 3339")),
                "unexpected error: {error:?}"
            );
        }
    }
}
