//! Link parsing and normative collection-relative resolution (§11).

use crate::{Result, VaultError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Retarget one link during a rename, preserving its presentation and anchor.
///
/// Simple wikilinks are resolved against the complete candidate set, so a
/// filename collision is never silently retargeted. Markdown links retain
/// their relative or collection-root spelling.
///
/// # Errors
/// Rejects unsafe paths or ambiguous links that could refer to the source.
pub fn rewrite(
    raw: &str,
    source: &str,
    old_path: &str,
    new_path: &str,
    candidates: &[String],
) -> Result<Option<String>> {
    let link = parse(raw)?;
    let old_path = normalize(old_path)?;
    let new_path = normalize(new_path)?;
    let resolved = resolve(&json!({"raw":raw,"sourcePath":source,"candidates":candidates}));
    let target = match resolved {
        Ok(target) => target,
        Err(error) => {
            let stem = old_path
                .rsplit('/')
                .next()
                .unwrap_or(&old_path)
                .strip_suffix(".md")
                .unwrap_or(&old_path);
            if link.target == stem {
                return Err(error);
            }
            return Ok(None);
        }
    };
    if target != old_path {
        return Ok(None);
    }
    let target = if link.format == "wikilink" && !link.target.contains('/') {
        new_path
            .rsplit('/')
            .next()
            .unwrap_or(&new_path)
            .strip_suffix(".md")
            .unwrap_or(&new_path)
            .to_owned()
    } else if link.target.starts_with('/') {
        format!("/{new_path}")
    } else if link.format == "wikilink" && !link.is_relative {
        if std::path::Path::new(&link.target)
            .extension()
            .is_some_and(|extension| extension == "md")
        {
            new_path.clone()
        } else {
            new_path.strip_suffix(".md").unwrap_or(&new_path).to_owned()
        }
    } else {
        relative_target(source, &new_path)
    };
    let anchor = link
        .anchor
        .as_ref()
        .map_or_else(String::new, |v| format!("#{v}"));
    let result = match link.format.as_str() {
        "wikilink" => format!(
            "[[{target}{anchor}{}]]",
            link.alias
                .as_ref()
                .map_or_else(String::new, |v| format!("|{v}"))
        ),
        "markdown" => format!(
            "[{}]({target}{anchor})",
            link.alias.as_deref().unwrap_or_default()
        ),
        _ => format!("{target}{anchor}"),
    };
    Ok(Some(result))
}

fn relative_target(source: &str, target: &str) -> String {
    let directory = source.rsplit_once('/').map_or("", |(d, _)| d);
    let from = directory
        .split('/')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    let to = target.split('/').collect::<Vec<_>>();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    std::iter::repeat_n("..", from.len() - common)
        .chain(to.iter().skip(common).copied())
        .collect::<Vec<_>>()
        .join("/")
}

/// Rewrite supported links in a document while retaining all surrounding bytes.
///
/// # Errors
/// Rejects unsafe rename paths and ambiguous references.
pub fn rewrite_document(
    text: &str,
    source: &str,
    old_path: &str,
    new_path: &str,
    candidates: &[String],
) -> Result<String> {
    let pattern = regex::Regex::new(r"\[\[[^\[\]\r\n]+\]\]|\[[^\]\r\n]*\]\([^\)\r\n]+\)")
        .map_err(|_| invalid("invalid_link_pattern"))?;
    let mut result = String::with_capacity(text.len());
    let mut end = 0;
    for found in pattern.find_iter(text) {
        result.push_str(
            text.get(end..found.start())
                .ok_or_else(|| invalid("invalid_link_offset"))?,
        );
        match rewrite(found.as_str(), source, old_path, new_path, candidates)? {
            Some(replacement) => result.push_str(&replacement),
            None => result.push_str(found.as_str()),
        }
        end = found.end();
    }
    result.push_str(
        text.get(end..)
            .ok_or_else(|| invalid("invalid_link_offset"))?,
    );
    Ok(result)
}

/// Parsed link components with original spelling retained.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    /// Original input, including surrounding whitespace.
    pub raw: String,
    /// File identifier or path without alias/anchor.
    pub target: String,
    /// Optional display text.
    pub alias: Option<String>,
    /// Optional heading or block anchor.
    pub anchor: Option<String>,
    /// Syntax: wikilink, markdown, or path.
    pub format: String,
    /// Whether the target is explicitly relative.
    pub is_relative: bool,
}

/// Parse a supported link without resolving it against storage.
///
/// # Errors
/// Rejects blank or malformed link syntax.
pub fn parse(raw: &str) -> Result<Link> {
    let value = raw.trim();
    let (target, alias, anchor, format) =
        if let Some(inner) = value.strip_prefix("[[").and_then(|v| v.strip_suffix("]]")) {
            if inner.contains(['[', ']']) {
                return Err(invalid("invalid_link_format"));
            }
            let (target, alias) = inner
                .split_once('|')
                .map_or((inner, None), |(t, a)| (t, nonblank(a)));
            let (target, anchor) = split_anchor(target);
            (target.trim().to_owned(), alias, anchor, "wikilink")
        } else if let Some(value) = value.strip_prefix('[').and_then(|v| v.strip_suffix(')')) {
            let (label, target) = value
                .split_once("](")
                .ok_or_else(|| invalid("invalid_link_format"))?;
            if label.contains(']') || target.contains(')') {
                return Err(invalid("invalid_link_format"));
            }
            let (target, anchor) = split_anchor(target);
            (
                target.trim().to_owned(),
                nonblank(label),
                anchor,
                "markdown",
            )
        } else if value.starts_with(['.', '/'])
            || value.split_once('/').is_some_and(|(head, tail)| {
                !head.is_empty()
                    && !tail.is_empty()
                    && head
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            })
        {
            (value.to_owned(), None, None, "path")
        } else {
            return Err(invalid("invalid_link_format"));
        };
    if target.is_empty() || target.chars().any(char::is_control) {
        return Err(invalid("invalid_link_format"));
    }
    Ok(Link {
        raw: raw.to_owned(),
        is_relative: target.starts_with("./") || target.starts_with("../"),
        target,
        alias,
        anchor,
        format: format.into(),
    })
}

/// Resolve with explicit scoped candidates and IDs; no platform metadata shortcuts.
///
/// # Errors
/// Rejects traversal, ambiguity, and unresolved simple names.
pub fn resolve(input: &Value) -> Result<String> {
    let link = parse(text(input, "raw"))?;
    let source = text(input, "sourcePath");
    let directory = source.rsplit_once('/').map_or("", |(d, _)| d);
    if link.format != "wikilink" || link.is_relative || link.target.contains('/') {
        let target =
            if link.target.starts_with('/') || link.format == "wikilink" && !link.is_relative {
                link.target.clone()
            } else {
                format!("{directory}/{}", link.target)
            };
        let mut path = normalize(&target)?;
        if link.format == "wikilink" && std::path::Path::new(&path).extension().is_none() {
            path.push_str(".md");
        }
        return Ok(path);
    }
    let candidates = input
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(normalize)
        .collect::<Result<BTreeSet<_>>>()?;
    let id_index = input.get("idIndex");
    let ids = candidates
        .iter()
        .filter(|path| {
            id_index
                .and_then(|i| i.get(path.as_str()))
                .and_then(Value::as_str)
                == Some(&link.target)
        })
        .cloned()
        .collect::<Vec<_>>();
    if ids.len() == 1 {
        return ids
            .first()
            .cloned()
            .ok_or_else(|| invalid("unresolved_link_target"));
    }
    if ids.len() > 1 {
        return Err(invalid("ambiguous_link"));
    }
    let extensions = input
        .get("extensions")
        .and_then(Value::as_array)
        .map_or_else(
            || vec![".md"],
            |a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .filter(|s| s.starts_with('.'))
                    .collect::<Vec<_>>()
            },
        );
    for extension in extensions {
        let wanted = format!("{}{extension}", link.target);
        let matches = candidates
            .iter()
            .filter(|p| p.rsplit('/').next() == Some(wanted.as_str()))
            .collect::<Vec<_>>();
        if matches.len() > 1 {
            return Err(invalid("ambiguous_link"));
        }
        if let Some(path) = matches.first() {
            return Ok((*path).clone());
        }
    }
    Err(invalid("unresolved_link_target"))
}

/// Normalize link paths while rejecting paths that escape the collection.
///
/// # Errors
/// Rejects above-root traversal, controls, and empty paths.
pub fn normalize(path: &str) -> Result<String> {
    let path = path.replace('\\', "/");
    let mut result = Vec::new();
    for part in path.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if result.pop().is_none() {
                    return Err(invalid("path_traversal"));
                }
            }
            _ => {
                if part.chars().any(char::is_control) {
                    return Err(invalid("invalid_link_format"));
                }
                result.push(part);
            }
        }
    }
    if result.is_empty() {
        return Err(invalid("unresolved_link_target"));
    }
    Ok(result.join("/"))
}

/// Evaluate parsed and resolved link requests using normative algorithms.
///
/// # Errors
/// Rejects invalid request syntax or resolution failures.
pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "link.parse" => serde_json::to_value(parse(text(input, "raw"))?)
            .map_err(|_| invalid("invalid_link_format")),
        "link.resolve" => Ok(json!({"path":resolve(input)?})),
        "link.update_references_on_rename" => {
            let old_path = text(input, "oldPath");
            let new_path = text(input, "newPath");
            let references = input
                .get("references")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("references_required"))?;
            let candidates = vec![old_path.to_owned()];
            let updated = references
                .iter()
                .map(|reference| {
                    let raw = reference
                        .as_str()
                        .ok_or_else(|| invalid("invalid_link_format"))?;
                    rewrite(raw, "", old_path, new_path, &candidates)
                        .map(|replacement| replacement.unwrap_or_else(|| raw.to_owned()))
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(json!({"updated":updated}))
        }
        _ => Err(invalid("unsupported_operation")),
    }
}
fn split_anchor(value: &str) -> (&str, Option<String>) {
    value
        .split_once('#')
        .map_or((value, None), |(t, a)| (t, nonblank(a)))
}
fn nonblank(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn invalid(value: &str) -> VaultError {
    VaultError::Document(value.into())
}
