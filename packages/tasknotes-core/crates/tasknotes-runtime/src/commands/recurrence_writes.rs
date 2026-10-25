//! Production write canonicalization; the compatibility recurrence parser is unchanged.

use super::{Map, Result, RuntimeError, TaskNotesConfiguration, Value};
use chrono::NaiveDateTime;
use tasknotes_vault::temporal;

pub(super) fn validate_mapped_strict(
    config: &TaskNotesConfiguration,
    document: &super::TaskDocument,
) -> Result<()> {
    for role in ["recurrence", "recurrenceAnchor"] {
        let field = config.mapping.field(role);
        if field != role
            && let (Some(physical), Some(canonical)) = (
                document.frontmatter().get(field),
                document.frontmatter().get(role),
            )
            && physical != canonical
        {
            return Err(invalid("ambiguous_recurrence_source"));
        }
    }
    validate_strict(&config.mapping.normalize(document.frontmatter()))
}

/// Strict write validation is separate from the deliberately permissive legacy
/// recurrence reader. It never repairs or rewrites foreign historical bytes.
pub(super) fn validate_strict(properties: &Map<String, Value>) -> Result<()> {
    if let Some(anchor) = properties
        .get("recurrenceAnchor")
        .filter(|value| !value.is_null())
        && !matches!(anchor.as_str(), Some("scheduled" | "completion"))
    {
        return Err(invalid("invalid_recurrence_anchor"));
    }
    let Some(value) = properties
        .get("recurrence")
        .filter(|value| !value.is_null())
    else {
        return Ok(());
    };
    let rule = value
        .as_str()
        .ok_or_else(|| invalid("invalid_recurrence_rule"))?;
    if rule.is_empty() {
        return Ok(());
    }
    if rule.trim() != rule || rule.contains(['\r', '\n']) {
        return Err(invalid("invalid_recurrence_rule"));
    }
    let rule = rule.strip_prefix("RRULE:").unwrap_or(rule);
    let mut parameters = std::collections::BTreeMap::new();
    let mut start = None;
    for (index, part) in rule.split(';').enumerate() {
        if let Some(value) = part.strip_prefix("DTSTART:") {
            if index != 0 || start.is_some() {
                return Err(invalid("invalid_recurrence_rule"));
            }
            validate_start(value)?;
            start = Some(value);
        } else {
            let (key, value) = part
                .split_once('=')
                .ok_or_else(|| invalid("invalid_recurrence_rule"))?;
            if value.is_empty() || parameters.insert(key, value).is_some() {
                return Err(invalid("invalid_recurrence_rule"));
            }
        }
    }
    let frequency = parameters
        .get("FREQ")
        .copied()
        .ok_or_else(|| invalid("invalid_recurrence_rule"))?;
    if !matches!(
        frequency,
        "YEARLY" | "MONTHLY" | "WEEKLY" | "DAILY" | "HOURLY" | "MINUTELY" | "SECONDLY"
    ) {
        return Err(invalid("invalid_recurrence_rule"));
    }
    if parameters.contains_key("COUNT") && parameters.contains_key("UNTIL") {
        return Err(invalid("invalid_recurrence_rule"));
    }
    for (key, value) in &parameters {
        if !valid_parameter(key, value, frequency, &parameters) {
            return Err(invalid("invalid_recurrence_rule"));
        }
    }
    // Validate the selected seed as well, without silently skipping an invalid source.
    seeded_rule(properties)?.ok_or_else(|| invalid("invalid_recurrence_rule"))?;
    Ok(())
}

fn valid_parameter(
    key: &str,
    value: &str,
    frequency: &str,
    parameters: &std::collections::BTreeMap<&str, &str>,
) -> bool {
    match key {
        "FREQ" => true,
        "COUNT" | "INTERVAL" => value.parse::<u32>().is_ok_and(|value| value > 0),
        "UNTIL" => validate_start(value).is_ok(),
        "WKST" => weekday(value),
        "BYSECOND" => integer_list(value, 0, 60, true),
        "BYMINUTE" => integer_list(value, 0, 59, true),
        "BYHOUR" => integer_list(value, 0, 23, true),
        "BYMONTH" => integer_list(value, 1, 12, false),
        "BYMONTHDAY" => frequency != "WEEKLY" && integer_list(value, -31, 31, false),
        "BYYEARDAY" => {
            !matches!(frequency, "DAILY" | "WEEKLY" | "MONTHLY")
                && integer_list(value, -366, 366, false)
        }
        "BYWEEKNO" => frequency == "YEARLY" && integer_list(value, -53, 53, false),
        "BYSETPOS" => {
            parameters
                .keys()
                .any(|key| key.starts_with("BY") && *key != "BYSETPOS")
                && integer_list(value, -366, 366, false)
        }
        "BYDAY" => value.split(',').all(|day| {
            if weekday(day) {
                return true;
            }
            let Some(offset) = day.len().checked_sub(2) else {
                return false;
            };
            let Some((ordinal, day)) = day.get(..offset).zip(day.get(offset..)) else {
                return false;
            };
            matches!(frequency, "MONTHLY" | "YEARLY")
                && weekday(day)
                && ordinal
                    .parse::<i16>()
                    .is_ok_and(|n| n != 0 && (-53..=53).contains(&n))
                && !(frequency == "YEARLY" && parameters.contains_key("BYWEEKNO"))
        }),
        _ => false,
    }
}

fn weekday(value: &str) -> bool {
    matches!(value, "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")
}
fn integer_list(value: &str, min: i16, max: i16, zero: bool) -> bool {
    value.split(',').all(|value| {
        value
            .parse::<i16>()
            .is_ok_and(|value| (min..=max).contains(&value) && (zero || value != 0))
    })
}

pub(super) fn canonicalize(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    let normalized = config.mapping.normalize(properties);
    if let Some(rule) = seeded_rule(&normalized)? {
        let key = if properties.contains_key("recurrence") {
            "recurrence"
        } else {
            config.mapping.field("recurrence")
        };
        properties.insert(key.to_owned(), Value::String(rule));
    }
    Ok(())
}

pub(super) fn seeded_rule(properties: &Map<String, Value>) -> Result<Option<String>> {
    let Some(value) = properties
        .get("recurrence")
        .filter(|value| !value.is_null())
    else {
        return Ok(None);
    };
    let rule = value
        .as_str()
        .ok_or_else(|| invalid("invalid_recurrence_rule"))?;
    if rule.trim().is_empty() {
        return Ok(None);
    }
    let mut starts = rule
        .trim()
        .strip_prefix("RRULE:")
        .unwrap_or(rule.trim())
        .split([';', '\n'])
        .filter_map(|part| part.strip_prefix("DTSTART:"));
    if let Some(start) = starts.next() {
        validate_start(start)?;
        if starts.next().is_some() {
            return Err(invalid("invalid_recurrence_start"));
        }
        return Ok(Some(rule.to_owned()));
    }
    // A present invalid preferred seed must never fall through to a lower one.
    let seed = properties
        .get("scheduled")
        .or_else(|| properties.get("dateCreated"))
        .ok_or_else(|| invalid("missing_recurrence_seed"))?;
    let seed = seed
        .as_str()
        .ok_or_else(|| invalid("missing_recurrence_seed"))?;
    let start = if seed.len() == 10 {
        temporal::parse_day(seed)
            .map_err(|_| invalid("missing_recurrence_seed"))?
            .format("%Y%m%d")
            .to_string()
    } else {
        temporal::parse_instant(seed)
            .map_err(|_| invalid("missing_recurrence_seed"))?
            .format("%Y%m%dT%H%M%SZ")
            .to_string()
    };
    let parameters = rule.trim().strip_prefix("RRULE:").unwrap_or(rule.trim());
    Ok(Some(format!("DTSTART:{start};{parameters}")))
}

fn validate_start(start: &str) -> Result<()> {
    if start.len() == 8 && start.bytes().all(|byte| byte.is_ascii_digit()) {
        let day = format!(
            "{}-{}-{}",
            part(start, 0, 4)?,
            part(start, 4, 6)?,
            part(start, 6, 8)?
        );
        temporal::parse_day(&day).map_err(|_| invalid("invalid_recurrence_start"))?;
        return Ok(());
    }
    if start.len() == 16
        && start.as_bytes().get(8) == Some(&b'T')
        && start.as_bytes().get(15) == Some(&b'Z')
        && start
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 15) || byte.is_ascii_digit())
    {
        let parsed = NaiveDateTime::parse_from_str(start, "%Y%m%dT%H%M%SZ")
            .map_err(|_| invalid("invalid_recurrence_start"))?;
        temporal::parse_instant(&parsed.and_utc().to_rfc3339())
            .map_err(|_| invalid("invalid_recurrence_start"))?;
        return Ok(());
    }
    Err(invalid("invalid_recurrence_start"))
}

fn part(value: &str, start: usize, end: usize) -> Result<&str> {
    value
        .get(start..end)
        .ok_or_else(|| invalid("invalid_recurrence_start"))
}

fn invalid(code: &str) -> RuntimeError {
    RuntimeError::Validation(code.to_owned())
}
