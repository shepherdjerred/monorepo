//! Production variables and YAML expansion at parsed scalar boundaries.

use super::{Map, Result, Value, invalid, json};
use chrono::{Datelike, TimeZone};

/// Build the production variable set from one caller-owned instant.
/// No variable reads an ambient clock or random source.
///
/// # Errors
/// Rejects unknown timezones, invalid dates, or unavailable local midnight.
pub fn production_values(
    properties: &Map<String, Value>,
    body: &str,
    at: chrono::DateTime<chrono::Utc>,
    timezone: &str,
) -> Result<Map<String, Value>> {
    let mut values = super::values(properties, body, at, timezone)?;
    let title = properties
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("");
    values.extend(title_variants(title)?);
    for role in ["priority", "status"] {
        values.insert(
            format!("{role}Short"),
            json!(
                properties
                    .get(role)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .chars()
                    .take(1)
                    .collect::<String>()
                    .to_uppercase()
            ),
        );
    }
    let zone: chrono_tz::Tz = timezone.parse().map_err(|_| invalid("invalid_timezone"))?;
    let local = at.with_timezone(&zone);
    let midnight_naive = local
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| invalid("invalid_midnight"))?;
    // JS Date.setHours(0) advances a skipped midnight to the first real instant.
    // Search one civil day at exact-second resolution; no ambient zone/clock is used.
    let midnight = (0..=86_400)
        .find_map(|seconds| {
            zone.from_local_datetime(&(midnight_naive + chrono::Duration::seconds(seconds)))
                .earliest()
        })
        .ok_or_else(|| invalid("invalid_midnight"))?;
    let elapsed = local.signed_duration_since(midnight).num_seconds();
    let mut number = u64::try_from(elapsed).map_err(|_| invalid("invalid_midnight"))?;
    let mut digits = Vec::new();
    loop {
        let digit = u32::try_from(number % 36).map_err(|_| invalid("internal_radix_digit"))?;
        digits.push(char::from_digit(digit, 36).ok_or_else(|| invalid("internal_radix_digit"))?);
        number /= 36;
        if number == 0 {
            break;
        }
    }
    let seconds = digits.into_iter().rev().collect::<String>();
    values.insert(
        "zettel".into(),
        json!(format!("{}{seconds}", local.format("%y%m%d"))),
    );
    for (key, format) in [
        ("hourPadded", "%H"),
        ("hour12", "%I"),
        ("ampm", "%p"),
        ("milliseconds", "%3f"),
        ("ms", "%3f"),
        ("timezoneShort", "%z"),
        ("utcOffsetShort", "%z"),
    ] {
        values.insert(key.into(), json!(local.format(format).to_string()));
    }
    values.insert(
        "quarter".into(),
        json!((local.month0() / 3 + 1).to_string()),
    );
    values.insert("utcZ".into(), json!("Z"));
    // date-fns format(...,"ww") defaults to Sunday and the week containing Jan 1.
    let day = local.date_naive();
    let sunday = |date: chrono::NaiveDate| {
        date - chrono::Duration::days(i64::from(date.weekday().num_days_from_sunday()))
    };
    let current = sunday(
        chrono::NaiveDate::from_ymd_opt(day.year(), 1, 1).ok_or_else(|| invalid("invalid_week"))?,
    );
    let next = sunday(
        chrono::NaiveDate::from_ymd_opt(day.year() + 1, 1, 1)
            .ok_or_else(|| invalid("invalid_week"))?,
    );
    let first = if day >= next { next } else { current };
    values.insert(
        "week".into(),
        json!(format!("{:02}", (sunday(day) - first).num_days() / 7 + 1)),
    );
    // Keep generated identity deterministic. Random suffixes/UUIDs are explicit caller inputs.
    values.insert(
        "nano".into(),
        json!(format!(
            "{}{:05}",
            at.timestamp_millis(),
            at.timestamp_subsec_nanos() % 100_000
        )),
    );
    Ok(values)
}

pub(crate) fn title_variants(title: &str) -> Result<Map<String, Value>> {
    let mut values = Map::new();
    let whitespace = regex::Regex::new(
        r"[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+",
    )
    .map_err(|_| invalid("internal_template_pattern"))?;
    for (key, value) in [
        ("titleLower", title.to_lowercase()),
        ("titleUpper", title.to_uppercase()),
        (
            "titleKebab",
            whitespace
                .replace_all(&title.to_lowercase(), "-")
                .into_owned(),
        ),
        (
            "titleSnake",
            whitespace
                .replace_all(&title.to_lowercase(), "_")
                .into_owned(),
        ),
    ] {
        values.insert(key.into(), json!(value));
    }
    let boundaries = regex::Regex::new(r"(?-u:^\w|[A-Z]|\b\w)")
        .map_err(|_| invalid("internal_template_pattern"))?;
    for (key, camel) in [("titleCamel", true), ("titlePascal", false)] {
        let transformed = boundaries.replace_all(title, |captures: &regex::Captures<'_>| {
            captures
                .get(0)
                .map(|token| {
                    if camel && token.start() == 0 {
                        token.as_str().to_ascii_lowercase()
                    } else {
                        token.as_str().to_ascii_uppercase()
                    }
                })
                .unwrap_or_default()
        });
        values.insert(
            key.into(),
            json!(
                transformed
                    .chars()
                    .filter(|c| !js_whitespace(*c))
                    .collect::<String>()
            ),
        );
    }
    Ok(values)
}

pub(crate) fn js_whitespace(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}

/// Mask raw tokens before parsing YAML, then expand parsed strings once.
/// Inserted values cannot create a second YAML key, alias, flow collection or token.
///
/// # Errors
/// Rejects invalid YAML, duplicate keys, non-object roots, or unknown-token errors.
pub fn expand_frontmatter(
    raw: &str,
    values: &Map<String, Value>,
    policy: &str,
) -> Result<Map<String, Value>> {
    let tokens =
        regex::Regex::new(r"\{\{(\w+)\}\}").map_err(|_| invalid("internal_template_pattern"))?;
    let mut prefix = "FACET_TEMPLATE_SCALAR_".to_owned();
    while raw.contains(&prefix) {
        prefix.push('_');
    }
    let mut replacements = Map::new();
    let masked = tokens.replace_all(raw, |capture: &regex::Captures<'_>| {
        let marker = format!("{prefix}{}END", replacements.len());
        replacements.insert(
            marker.clone(),
            json!(capture.get(0).map_or("", |v| v.as_str())),
        );
        marker
    });
    let parsed: Map<String, Value> =
        serde_saphyr::from_str(&masked).map_err(|_| invalid("template_parse_failed"))?;
    let restore = regex::Regex::new(&format!("{}[0-9]+END", regex::escape(&prefix)))
        .map_err(|_| invalid("internal_template_pattern"))?;
    walk(
        Value::Object(parsed),
        &replacements,
        &restore,
        values,
        policy,
    )?
    .as_object()
    .cloned()
    .ok_or_else(|| invalid("template_parse_failed"))
}

fn walk(
    value: Value,
    replacements: &Map<String, Value>,
    restore: &regex::Regex,
    values: &Map<String, Value>,
    policy: &str,
) -> Result<Value> {
    match value {
        Value::String(text) => {
            let restored = restore.replace_all(&text, |capture: &regex::Captures<'_>| {
                replacements
                    .get(&capture[0])
                    .and_then(Value::as_str)
                    .unwrap_or(&capture[0])
                    .to_owned()
            });
            Ok(json!(super::expand(&restored, values, policy)?))
        }
        Value::Array(items) => Ok(Value::Array(
            items
                .into_iter()
                .map(|v| walk(v, replacements, restore, values, policy))
                .collect::<Result<_>>()?,
        )),
        Value::Object(items) => {
            let mut expanded = Map::new();
            for (key, value) in items {
                let key = walk(Value::String(key), replacements, restore, values, policy)?
                    .as_str()
                    .ok_or_else(|| invalid("template_parse_failed"))?
                    .to_owned();
                if expanded
                    .insert(key, walk(value, replacements, restore, values, policy)?)
                    .is_some()
                {
                    return Err(invalid("template_parse_failed"));
                }
            }
            Ok(Value::Object(expanded))
        }
        other => Ok(other),
    }
}

/// Split production templates at complete delimiter lines, preserving body spacing.
///
/// # Errors
/// Rejects leading frontmatter with no complete closing delimiter.
pub fn production_sections(template: &str) -> Result<(String, String)> {
    let normalized = template.replace("\r\n", "\n");
    let mut lines = normalized.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_matches(js_whitespace) != "---" {
        return Ok((String::new(), template.into()));
    }
    let start = first.len();
    let mut offset = start;
    for line in lines {
        if line.trim_matches(js_whitespace) == "---" {
            return Ok((
                normalized
                    .get(start..offset)
                    .ok_or_else(|| invalid("template_parse_failed"))?
                    .trim_end_matches('\n')
                    .to_owned(),
                normalized
                    .get(offset + line.len()..)
                    .ok_or_else(|| invalid("template_parse_failed"))?
                    .to_owned(),
            ));
        }
        offset += line.len();
    }
    Err(invalid("template_parse_failed"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn yaml_values_cannot_publish_keys_or_expand_inserted_tokens() -> Result<()> {
        let vars = json!({"title":"A: B\nadmin: true # \"quoted\" {{status}}","status":"open","parentNote":"[[Inbox]]"}).as_object().cloned().ok_or_else(|| invalid("test_object"))?;
        let result = expand_frontmatter(
            "title: {{title}}\nparent: '{{parentNote}}'\nlist: [{{title}}]\n",
            &vars,
            "preserve",
        )?;
        assert_eq!(result.len(), 3);
        assert_eq!(result.get("title"), vars.get("title"));
        assert_eq!(result.get("parent"), Some(&json!("[[Inbox]]")));
        assert_eq!(result.get("list"), Some(&json!([vars["title"]])));
        Ok(())
    }
    #[test]
    fn week_and_zettel_use_local_year_boundary_and_dst_elapsed_seconds() -> Result<()> {
        let at = crate::temporal::parse_instant("2025-12-28T12:00:00Z")?;
        let vars = production_values(&Map::new(), "", at, "UTC")?;
        assert_eq!(vars.get("week"), Some(&json!("01")));
        let at = crate::temporal::parse_instant("2026-03-08T10:30:00Z")?;
        let vars = production_values(&Map::new(), "", at, "America/Los_Angeles")?;
        assert_eq!(vars.get("zettel"), Some(&json!("2603086y0")));
        assert_eq!(vars.get("hour"), Some(&json!("03")));
        Ok(())
    }
    #[test]
    fn invalid_yaml_unknown_error_and_duplicate_keys_remain_errors() {
        assert!(expand_frontmatter("a: [", &Map::new(), "preserve").is_err());
        assert!(expand_frontmatter("a: {{unknown}}", &Map::new(), "error").is_err());
        assert!(expand_frontmatter("a: x\na: y", &Map::new(), "preserve").is_err());
    }
}
