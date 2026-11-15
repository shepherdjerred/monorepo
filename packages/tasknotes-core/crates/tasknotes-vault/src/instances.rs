//! Typed day-level instance lists; corrupt values never become an empty set.

use crate::{Result, VaultError, mapping::FieldMapping, temporal};
use serde_json::{Map, Value, json};
use std::collections::HashSet;

/// Valid, unique and disjoint stored recurring-instance outcomes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceLists {
    /// Completed days, retaining their stored order.
    pub completed: Vec<String>,
    /// Skipped days, retaining their stored order.
    pub skipped: Vec<String>,
}

#[derive(Clone, Copy)]
enum Problem {
    Type,
    Date,
    Duplicate,
    Overlap,
    AliasConflict,
}

impl Problem {
    fn code(self) -> &'static str {
        match self {
            Self::Type => "invalid_type",
            Self::Date => "invalid_date_value",
            Self::Duplicate => "duplicate_instance_date",
            Self::Overlap => "instance_state_overlap",
            Self::AliasConflict => "instance_alias_conflict",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Type => "instance state must be a list of date strings",
            Self::Date => "instance state contains an invalid day",
            Self::Duplicate => "instance state contains a duplicate day",
            Self::Overlap => "a day occurs in both complete and skipped instance lists",
            Self::AliasConflict => "recognized physical fields disagree about instance state",
        }
    }
}

fn dates(properties: &Map<String, Value>, role: &str) -> std::result::Result<Vec<String>, Problem> {
    let Some(value) = properties.get(role) else {
        return Ok(Vec::new());
    };
    date_values(value)
}

fn date_values(value: &Value) -> std::result::Result<Vec<String>, Problem> {
    let values = value.as_array().ok_or(Problem::Type)?;
    let mut result = Vec::with_capacity(values.len());
    let mut seen = HashSet::with_capacity(values.len());
    for value in values {
        let day = value.as_str().ok_or(Problem::Type)?;
        temporal::parse_day(day).map_err(|_| Problem::Date)?;
        if !seen.insert(day) {
            return Err(Problem::Duplicate);
        }
        result.push(day.to_owned());
    }
    Ok(result)
}

impl InstanceLists {
    /// Decode actual mapped role values with deterministic duplicate rejection.
    /// Missing optional lists are empty; present malformed/null values fail.
    ///
    /// # Errors
    /// Returns typed invalid-type, invalid-day, duplicate and overlap problems.
    pub fn parse(properties: &Map<String, Value>) -> Result<Self> {
        let convert = |problem: Problem| VaultError::Document(problem.code().to_owned());
        let completed = dates(properties, "completeInstances").map_err(convert)?;
        let skipped = dates(properties, "skippedInstances").map_err(convert)?;
        if overlap(&completed, &skipped) {
            return Err(convert(Problem::Overlap));
        }
        Ok(Self { completed, skipped })
    }

    /// Read every recognized physical source before selecting instance state.
    /// Configured physical mappings and canonical role keys are recognized.
    /// An otherwise unknown snake-case key remains unknown here; explicit
    /// normalization has a separate legacy-alias policy.
    ///
    /// # Errors
    /// Rejects corrupt sources and differing recognized sources for one role.
    pub fn parse_mapped(frontmatter: &Map<String, Value>, mapping: &FieldMapping) -> Result<Self> {
        let mut properties = Map::new();
        for (key, value) in frontmatter {
            if let Some(role) = recognized_role(mapping, key) {
                date_values(value)
                    .map_err(|problem| VaultError::Document(problem.code().into()))?;
                if let Some(old) = properties.insert(role.to_owned(), value.clone())
                    && old != *value
                {
                    return Err(VaultError::Document(Problem::AliasConflict.code().into()));
                }
            }
        }
        Self::parse(&properties)
    }
}

fn recognized_role<'a>(mapping: &'a FieldMapping, key: &'a str) -> Option<&'a str> {
    let role = mapping.field_to_role.get(key).map_or(key, String::as_str);
    matches!(role, "completeInstances" | "skippedInstances").then_some(role)
}

/// Check every actual recognized source without changing configured precedence.
/// Ambiguous valid sources are blocked by the skip/completion read contract;
/// ordinary validation retains its existing projection precedence.
#[must_use]
pub fn issues_mapped(frontmatter: &Map<String, Value>, mapping: &FieldMapping) -> Vec<Value> {
    let mut result = Vec::new();
    for (key, value) in frontmatter {
        if recognized_role(mapping, key).is_some()
            && let Err(problem) = date_values(value)
        {
            result.push(json!({"code":problem.code(),"severity":"error","field":key,"message":problem.message()}));
        }
    }
    result.extend(
        issues(&mapping.normalize(frontmatter), mapping)
            .into_iter()
            .filter(|issue| issue.get("code") == Some(&json!(Problem::Overlap.code()))),
    );
    result
}

/// Validate the actual mapped instance lists without requiring RRULE membership.
#[must_use]
pub fn issues(properties: &Map<String, Value>, mapping: &FieldMapping) -> Vec<Value> {
    let completed = dates(properties, "completeInstances");
    let skipped = dates(properties, "skippedInstances");
    let mut result = Vec::new();
    for (role, values) in [
        ("completeInstances", &completed),
        ("skippedInstances", &skipped),
    ] {
        if let Err(problem) = values {
            result.push(issue(*problem, role, mapping));
        }
    }
    if let (Ok(completed), Ok(skipped)) = (&completed, &skipped)
        && overlap(completed, skipped)
    {
        result.push(issue(Problem::Overlap, "completeInstances", mapping));
    }
    result
}

fn issue(problem: Problem, role: &str, mapping: &FieldMapping) -> Value {
    json!({"code":problem.code(),"severity":"error","field":mapping.field(role),"message":problem.message()})
}

fn overlap(completed: &[String], skipped: &[String]) -> bool {
    let skipped: HashSet<&str> = skipped.iter().map(String::as_str).collect();
    completed.iter().any(|day| skipped.contains(day.as_str()))
}
