//! Production write canonicalization; the compatibility recurrence parser is unchanged.

use super::{Map, Result, RuntimeError, TaskNotesConfiguration, Value};
use chrono::NaiveDateTime;
use tasknotes_vault::temporal;

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
