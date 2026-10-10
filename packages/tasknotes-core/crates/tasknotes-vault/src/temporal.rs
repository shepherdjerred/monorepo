//! Strict calendar dates, instant normalization, and caller-provided timezone context.

use chrono::{DateTime, NaiveDate, SecondsFormat, Timelike, Utc};
use chrono_tz::Tz;

use crate::{Result, VaultError};

/// Parse the canonical date grammar and reject impossible calendar dates.
///
/// # Errors
/// Rejects noncanonical values and invalid Gregorian dates.
pub fn parse_day(value: &str) -> Result<NaiveDate> {
    let canonical = value.len() == 10
        && value.bytes().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        });
    if !canonical {
        return Err(invalid_date());
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid_date())
}

/// Parse an offset-qualified instant without admitting leap-second rollover.
///
/// # Errors
/// Rejects malformed, offset-less, space-separated, and invalid datetime values.
pub fn parse_instant(value: &str) -> Result<DateTime<Utc>> {
    if value.as_bytes().get(10) != Some(&b'T') {
        return Err(invalid_date());
    }
    let datetime = DateTime::parse_from_rfc3339(value).map_err(|_| invalid_date())?;
    if datetime.nanosecond() >= 1_000_000_000 {
        return Err(invalid_date());
    }
    Ok(datetime.with_timezone(&Utc))
}

/// Normalize an instant to whole seconds in UTC; fractional precision truncates.
///
/// # Errors
/// Rejects invalid or ambiguous input.
pub fn canonical_instant(value: &str) -> Result<String> {
    Ok(parse_instant(value)?.to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// Extract the written calendar day without shifting an offset-qualified value.
///
/// # Errors
/// Rejects values without a valid canonical date prefix.
pub fn date_part(value: &str) -> Result<NaiveDate> {
    let trimmed = value.trim();
    let part = trimmed.split(['T', ' ']).next().ok_or_else(invalid_date)?;
    parse_day(part)
}

/// Check the upstream display hint, which is lexical rather than validation.
#[must_use]
pub fn has_time(value: &str) -> bool {
    value.as_bytes().windows(6).any(|bytes| {
        bytes.first() == Some(&b'T')
            && bytes.get(1).is_some_and(u8::is_ascii_digit)
            && bytes.get(2).is_some_and(u8::is_ascii_digit)
            && bytes.get(3) == Some(&b':')
            && bytes.get(4).is_some_and(u8::is_ascii_digit)
            && bytes.get(5).is_some_and(u8::is_ascii_digit)
    })
}

/// Convert an instant to a day in one explicitly resolved IANA timezone.
///
/// # Errors
/// Rejects an invalid instant or unknown timezone.
pub fn day_in_timezone(instant: &str, timezone: &str) -> Result<NaiveDate> {
    let zone: Tz = timezone
        .trim()
        .parse()
        .map_err(|_| VaultError::Document("Invalid timezone".to_owned()))?;
    Ok(parse_instant(instant)?.with_timezone(&zone).date_naive())
}

/// UTC anchor for date values, actual instant for offset-qualified datetimes.
///
/// # Errors
/// Rejects invalid or ambiguous input.
pub fn parse_utc_day(value: &str) -> Result<NaiveDate> {
    if value.len() == 10 {
        parse_day(value)
    } else {
        Ok(parse_instant(value)?.date_naive())
    }
}

/// Preserve literal date values and evaluate datetime inputs in caller context.
///
/// # Errors
/// Rejects invalid values or timezone context.
pub fn parse_local_day(value: &str, timezone: &str) -> Result<NaiveDate> {
    if value.len() == 10 {
        parse_day(value)
    } else {
        day_in_timezone(value, timezone)
    }
}

/// Resolve an explicit operation day, scheduled day, due day, then caller today.
///
/// # Errors
/// An explicitly supplied invalid day fails; absent/invalid implicit hints do not.
pub fn operation_day(
    explicit: Option<&str>,
    scheduled: Option<&str>,
    due: Option<&str>,
    today: NaiveDate,
) -> Result<NaiveDate> {
    if let Some(day) = explicit.map(str::trim).filter(|day| !day.is_empty()) {
        return parse_day(day);
    }
    Ok(scheduled
        .and_then(|day| date_part(day).ok())
        .or_else(|| due.and_then(|day| date_part(day).ok()))
        .unwrap_or(today))
}

fn invalid_date() -> VaultError {
    VaultError::Document("Invalid date or datetime value".to_owned())
}
