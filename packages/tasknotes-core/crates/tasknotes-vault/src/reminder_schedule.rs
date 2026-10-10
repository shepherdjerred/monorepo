//! Clock-free reminder trigger and recurring-instance eligibility semantics.
//!
//! Calendar year/month durations follow the pinned plugin's fixed 365/30 day
//! conversion. A local DST fold chooses the earlier instant; a missing local
//! anchor is an explicit error, never a guessed delivery time.

use chrono::{DateTime, Duration, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::{Map, Value};

use crate::{Result, VaultError, relationships, temporal};

/// One eligible firing before collection windowing and host notification IDs.
#[derive(Debug)]
pub struct Fire {
    /// Reminder identity unique within its task.
    pub id: String,
    /// Exact UTC firing instant.
    pub at: DateTime<Utc>,
    /// Civil occurrence whose completion controls this reminder.
    pub occurrence_date: Option<String>,
    /// Optional caller-authored notification description.
    pub description: Option<String>,
}

/// Validate an explicit delivery timezone independently of task presence.
///
/// # Errors
/// Rejects unknown IANA timezone names.
pub fn timezone(value: &str) -> Result<Tz> {
    value.parse().map_err(|_| invalid("invalid_timezone"))
}

/// Resolve one reminder using role-normalized properties and effective policy.
///
/// # Errors
/// Rejects malformed reminders, missing bases, invalid rules/instances, and
/// impossible local times; unrelated notes and reminder bytes are unchanged.
pub fn project(
    entry: &Value,
    properties: &Map<String, Value>,
    policy: &Value,
    zone: Tz,
    completed: bool,
) -> Result<Option<Fire>> {
    relationships::validate_reminder(entry)?;
    let kind = text(entry, "type")?;
    if (kind == "absolute"
        && ["relatedTo", "offset"]
            .iter()
            .any(|key| entry.get(key).is_some()))
        || (kind == "relative" && entry.get("absoluteTime").is_some())
    {
        return Err(invalid("mixed_reminder_fields"));
    }
    let (at, occurrence) = if kind == "absolute" {
        let at = temporal::parse_instant(text(entry, "absoluteTime")?)
            .map_err(|_| invalid("invalid_reminder_absolute_time"))?;
        (at, at.with_timezone(&zone).date_naive())
    } else {
        let raw = properties
            .get(text(entry, "relatedTo")?)
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("unresolved_reminder_base"))?;
        let base = anchor(raw, policy, zone)?;
        let at = base
            .checked_add_signed(offset(text(entry, "offset")?)?)
            .ok_or_else(|| invalid("reminder_time_overflow"))?;
        (at, base.with_timezone(&zone).date_naive())
    };
    let rule = match properties.get("recurrence") {
        None | Some(Value::Null) => "",
        Some(Value::String(value)) => value.as_str(),
        Some(_) => return Err(invalid("invalid_recurrence_rule")),
    };
    let recurring = !rule.trim().is_empty();
    if recurring
        && tasknotes_core::recurrence::Recurrence::parse(
            rule,
            properties.get("scheduled").and_then(Value::as_str),
            properties.get("dateCreated").and_then(Value::as_str),
        )
        .frequency()
        .is_none()
    {
        return Err(invalid("invalid_recurrence_rule"));
    }
    if properties.get("archiveTag") == Some(&Value::Bool(true))
        || (!recurring && completed)
        || (recurring
            && (contains_day(properties, "completeInstances", occurrence)?
                || contains_day(properties, "skippedInstances", occurrence)?))
    {
        return Ok(None);
    }
    let description = entry
        .get("description")
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid("invalid_reminder_description"))
        })
        .transpose()?;
    Ok(Some(Fire {
        id: text(entry, "id")?.to_owned(),
        at,
        occurrence_date: recurring.then(|| occurrence.to_string()),
        description,
    }))
}

fn contains_day(
    properties: &Map<String, Value>,
    key: &str,
    day: chrono::NaiveDate,
) -> Result<bool> {
    let Some(value) = properties.get(key).filter(|value| !value.is_null()) else {
        return Ok(false);
    };
    let values = value
        .as_array()
        .ok_or_else(|| invalid("invalid_instance_list"))?;
    let mut found = false;
    for value in values {
        let value = temporal::parse_day(
            value
                .as_str()
                .ok_or_else(|| invalid("invalid_instance_list"))?,
        )
        .map_err(|_| invalid("invalid_instance_list"))?;
        found |= value == day;
    }
    Ok(found)
}

fn anchor(raw: &str, policy: &Value, zone: Tz) -> Result<DateTime<Utc>> {
    if raw.len() != 10 {
        return temporal::parse_instant(raw).map_err(|_| invalid("invalid_reminder_base"));
    }
    let day = temporal::parse_day(raw).map_err(|_| invalid("invalid_reminder_base"))?;
    if !policy.is_null() && !policy.is_object() {
        return Err(invalid("invalid_reminder_policy"));
    }
    let clock = match policy.get("date_only_anchor_time") {
        None => "00:00",
        Some(value) => value
            .as_str()
            .ok_or_else(|| invalid("invalid_reminder_anchor_time"))?,
    };
    let time = NaiveTime::parse_from_str(clock, "%H:%M")
        .map_err(|_| invalid("invalid_reminder_anchor_time"))?;
    zone.from_local_datetime(&day.and_time(time))
        .earliest()
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| invalid("nonexistent_reminder_local_time"))
}

/// Convert accepted signed ISO duration to exact nanoseconds without float rounding.
///
/// # Errors
/// Rejects malformed duration, sub-nanosecond precision, or arithmetic overflow.
pub fn offset(raw: &str) -> Result<Duration> {
    if !relationships::valid_duration(raw) {
        return Err(invalid("invalid_reminder_offset"));
    }
    let negative = raw.starts_with('-');
    let raw = raw
        .trim_start_matches('-')
        .strip_prefix('P')
        .ok_or_else(|| invalid("invalid_reminder_offset"))?;
    let mut time = false;
    let mut digits = String::new();
    let mut nanos = 0_i128;
    for value in raw.chars() {
        if value == 'T' {
            time = true;
            continue;
        }
        if value.is_ascii_digit() || value == '.' {
            digits.push(value);
            continue;
        }
        let seconds = match (time, value) {
            (false, 'Y') => 365 * 86400,
            (false, 'M') => 30 * 86400,
            (false, 'W') => 7 * 86400,
            (false, 'D') => 86400,
            (true, 'H') => 3600,
            (true, 'M') => 60,
            (true, 'S') => 1,
            _ => return Err(invalid("invalid_reminder_offset")),
        };
        nanos = nanos
            .checked_add(
                decimal_nanos(&digits)?
                    .checked_mul(seconds)
                    .ok_or_else(|| invalid("reminder_offset_overflow"))?,
            )
            .ok_or_else(|| invalid("reminder_offset_overflow"))?;
        digits.clear();
    }
    if negative {
        nanos = -nanos;
    }
    let seconds =
        i64::try_from(nanos / 1_000_000_000).map_err(|_| invalid("reminder_offset_overflow"))?;
    let fraction =
        i64::try_from(nanos % 1_000_000_000).map_err(|_| invalid("reminder_offset_overflow"))?;
    Duration::try_seconds(seconds)
        .and_then(|duration| duration.checked_add(&Duration::nanoseconds(fraction)))
        .ok_or_else(|| invalid("reminder_offset_overflow"))
}

fn decimal_nanos(raw: &str) -> Result<i128> {
    let (whole, fraction) = raw.split_once('.').unwrap_or((raw, ""));
    let whole = whole
        .parse::<i128>()
        .map_err(|_| invalid("reminder_offset_overflow"))?;
    if fraction.len() > 9
        || (!fraction.is_empty() && !fraction.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(invalid("reminder_offset_precision"));
    }
    let fraction = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .map_err(|_| invalid("invalid_reminder_offset"))?
    };
    let scale = 9_u32
        .checked_sub(
            u32::try_from(raw.split_once('.').map_or(0, |(_, value)| value.len()))
                .map_err(|_| invalid("reminder_offset_precision"))?,
        )
        .ok_or_else(|| invalid("reminder_offset_precision"))?;
    whole
        .checked_mul(1_000_000_000)
        .and_then(|whole| whole.checked_add(fraction * 10_i128.pow(scale)))
        .ok_or_else(|| invalid("reminder_offset_overflow"))
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("invalid_reminder_entry"))
}
fn invalid(code: &str) -> VaultError {
    VaultError::Document(code.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn offsets_are_exact_bounded_and_match_pinned_plugin_calendar_units() -> Result<()> {
        assert_eq!(offset("P1Y")?, Duration::days(365));
        assert_eq!(offset("P1M")?, Duration::days(30));
        assert_eq!(
            offset("P1W2DT3H4M5S")?,
            Duration::days(9) + Duration::hours(3) + Duration::minutes(4) + Duration::seconds(5)
        );
        assert_eq!(offset("-PT0.000000001S")?, Duration::nanoseconds(-1));
        assert_eq!(offset("PT0.000000249S")?, Duration::nanoseconds(249));
        for raw in [
            "PT0.0000000001S",
            "P999999999999999999999999999999999999999D",
            "PTbad",
            "PT1Hjunk",
        ] {
            assert!(offset(raw).is_err(), "{raw}");
        }
        Ok(())
    }

    #[test]
    fn local_fold_is_earlier_instant_and_offset_datetime_keeps_exact_fraction() -> Result<()> {
        let zone = timezone("America/Los_Angeles")?;
        let policy = json!({"date_only_anchor_time":"01:30"});
        assert_eq!(
            anchor("2026-11-01", &policy, zone)?,
            temporal::parse_instant("2026-11-01T08:30:00Z")?
        );
        let values = json!({"due":"2026-11-01T09:30:00.750+02:00"});
        let properties = values
            .as_object()
            .ok_or_else(|| invalid("test_properties"))?;
        let entry =
            json!({"id":"fraction","type":"relative","relatedTo":"due","offset":"-PT0.001S"});
        let fire = project(&entry, properties, &policy, zone, false)?
            .ok_or_else(|| invalid("test_fire"))?;
        assert_eq!(
            fire.at,
            temporal::parse_instant("2026-11-01T07:30:00.749Z")?
        );
        assert_eq!(fire.occurrence_date, None);
        for policy in [
            json!({"date_only_anchor_time":null}),
            json!({"date_only_anchor_time":false}),
            json!({"date_only_anchor_time":0}),
            json!(false),
        ] {
            assert!(anchor("2026-11-01", &policy, zone).is_err());
        }
        Ok(())
    }
}
