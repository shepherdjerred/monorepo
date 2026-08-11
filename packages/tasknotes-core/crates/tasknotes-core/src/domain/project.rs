//! Project value equivalence.
//!
//! Upstream writes a project onto a task in one of two spellings — bare
//! (`Work`) or as an Obsidian wikilink (`[[Areas/Work]]`, `[[Areas/Work|Work]]`)
//! — and the two refer to the same project. Filtering therefore cannot compare
//! project strings for equality; it has to compare *keys*.
//!
//! Ported from `tasknotes-types/src/v2.ts`, which the TypeScript filter layer
//! imports. The regex there is hand-expanded here rather than pulling in a
//! regex engine for one pattern. The `matches_the_typescript_regex` test pins
//! the exact accept/reject set, including the awkward cases (an empty alias, a
//! nested `]`, a doubled pipe).

/// The canonical vault path inside a project value (`"[[A/B|C]]"` → `"A/B"`).
#[must_use]
pub fn project_path(value: &str) -> &str {
    let trimmed = value.trim();
    match parse_wikilink(trimmed) {
        Some((path, _)) => path.trim(),
        None => trimmed,
    }
}

/// What a human should see: `"[[A/B|C]]"` → `"C"`, `"[[A/B]]"` → `"B"`,
/// `"X"` → `"X"`.
#[must_use]
pub fn project_display_name(value: &str) -> &str {
    let trimmed = value.trim();
    let Some((path, alias)) = parse_wikilink(trimmed) else {
        return trimmed;
    };
    if let Some(alias) = alias {
        let alias = alias.trim();
        if !alias.is_empty() {
            return alias;
        }
    }
    basename(path.trim())
}

/// Whether two project values refer to the same project.
///
/// Tolerant of the wikilink/bare-name duality: full paths, basenames, and
/// aliases all count, case-insensitively.
#[must_use]
pub fn project_matches(left: &str, right: &str) -> bool {
    let left_keys = project_keys(left);
    project_keys(right)
        .iter()
        .any(|key| left_keys.iter().any(|candidate| candidate == key))
}

/// The four lowercase spellings a project value is allowed to be recognised by.
///
/// Returned as a fixed-size array rather than a set: it is always exactly four
/// entries, duplicates are harmless for a membership test, and an array keeps
/// the whole comparison allocation-bounded and order-independent (a `HashSet`
/// would be neither, and is banned workspace-wide for iteration).
fn project_keys(value: &str) -> [String; 4] {
    let path = project_path(value).to_lowercase();
    let base = basename(&path).to_owned();
    [
        value.trim().to_lowercase(),
        path,
        base,
        project_display_name(value).to_lowercase(),
    ]
}

/// The segment after the final `/`, or the whole value when there is none.
fn basename(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some((_, base)) => base,
        None => path,
    }
}

/// Split `[[path]]` or `[[path|alias]]` into its parts.
///
/// Mirrors `^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$`: the path may not contain `]`
/// or `|`, the alias may not contain `]`, and both must be non-empty. Anything
/// else is not a wikilink and is treated as a bare name.
fn parse_wikilink(trimmed: &str) -> Option<(&str, Option<&str>)> {
    let inner = trimmed.strip_prefix("[[")?.strip_suffix("]]")?;
    match inner.split_once('|') {
        Some((path, alias)) => {
            if path.is_empty() || path.contains(']') || alias.is_empty() || alias.contains(']') {
                None
            } else {
                Some((path, Some(alias)))
            }
        }
        None => {
            if inner.is_empty() || inner.contains(']') {
                None
            } else {
                Some((inner, None))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{project_display_name, project_matches, project_path};

    #[test]
    fn extracts_the_canonical_path() {
        assert_eq!(project_path("[[Areas/Work|Work]]"), "Areas/Work");
        assert_eq!(project_path("[[Areas/Work]]"), "Areas/Work");
        assert_eq!(project_path("  Work  "), "Work");
    }

    #[test]
    fn extracts_the_display_name() {
        assert_eq!(project_display_name("[[A/B|C]]"), "C");
        assert_eq!(project_display_name("[[A/B]]"), "B");
        assert_eq!(project_display_name("X"), "X");
        // A whitespace-only alias falls through to the path's basename, the
        // same way `match[2]?.trim()` does in TypeScript.
        assert_eq!(project_display_name("[[A/B|  ]]"), "B");
    }

    #[test]
    fn matches_across_spellings_case_insensitively() {
        assert!(project_matches("[[Areas/Work|Work]]", "work"));
        assert!(project_matches("[[Areas/Work]]", "Areas/Work"));
        assert!(project_matches("Work", "[[Areas/Work|Work]]"));
        assert!(!project_matches("Work", "Home"));
        assert!(!project_matches("[[Areas/Work]]", "[[Areas/Home]]"));
    }

    #[test]
    fn matches_the_typescript_regex() {
        // Accepted by `^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$` …
        assert_eq!(project_path("[[a|b]]"), "a");
        assert_eq!(project_display_name("[[a|b]]"), "b");
        // … the alias is `[^\]]+`, so a second pipe is part of the alias.
        assert_eq!(project_display_name("[[a||b]]"), "|b");

        // … and rejected, so each of these is a bare name that keeps its
        // brackets rather than being reinterpreted.
        for bare in ["[[]]", "[[|b]]", "[[a|]]", "[[a]]]", "[[a", "a]]"] {
            assert_eq!(project_path(bare), bare, "should not parse {bare:?}");
            assert_eq!(
                project_display_name(bare),
                bare,
                "should not parse {bare:?}"
            );
        }
    }
}
