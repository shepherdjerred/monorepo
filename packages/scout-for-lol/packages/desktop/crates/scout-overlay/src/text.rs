//! Fitting Scout's answer text into a card's bounds.
//!
//! Answers arrive as Markdown sized for the main window. A card holds a short
//! title and at most [`LINES_MAX`] lines of [`LINE_MAX`] characters, so this
//! drops Markdown markers, keeps the first lines that say something, and cuts
//! a long line with an ellipsis rather than letting the contract refuse it.

use crate::card::{LINE_MAX, LINES_MAX, TITLE_MAX};

const ELLIPSIS: char = '\u{2026}';

/// `text` cut to at most `max` characters, ending in an ellipsis when cut.
/// Whitespace runs collapse to one space.
#[must_use]
pub fn fit(text: &str, max: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    let mut cut = collapsed
        .chars()
        .take(max.saturating_sub(1))
        .collect::<String>();
    cut.truncate(cut.trim_end().len());
    cut.push(ELLIPSIS);
    cut
}

/// A card title from `text`, or none when it is blank.
#[must_use]
pub fn fit_title(text: &str) -> Option<String> {
    let title = fit(&plain(text), TITLE_MAX);
    (!title.is_empty()).then_some(title)
}

/// Card lines from Markdown `text`: each non-blank line without its heading,
/// list or quote marker and emphasis, cut to [`LINE_MAX`], at most
/// [`LINES_MAX`] of them. Empty when the text has nothing to show.
#[must_use]
pub fn fit_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(plain)
        .map(|line| fit(&line, LINE_MAX))
        .filter(|line| !line.is_empty())
        .take(LINES_MAX)
        .collect()
}

/// One line without the Markdown a card cannot draw.
fn plain(line: &str) -> String {
    let mut rest = line.trim().trim_start_matches('#').trim_start();
    for marker in ['-', '*', '+', '>'] {
        if let Some(stripped) = rest.strip_prefix(marker)
            && (stripped.is_empty() || stripped.starts_with(char::is_whitespace))
        {
            rest = stripped.trim_start();
            break;
        }
    }
    if let Some((number, stripped)) = rest.split_once(". ")
        && !number.is_empty()
        && number.bytes().all(|byte| byte.is_ascii_digit())
    {
        rest = stripped.trim_start();
    }
    rest.replace("**", "").replace("__", "").replace('`', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_markers_and_blank_lines_are_dropped() {
        let text = "## Plan\n\n- **Farm** bot side\n2. Ward `river` at 3:00\n> stay safe\n";
        assert_eq!(
            fit_lines(text),
            ["Plan", "Farm bot side", "Ward river at 3:00", "stay safe"]
        );
    }

    #[test]
    fn at_most_five_lines_are_kept() {
        let text = (1..=9)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let lines = fit_lines(&text);
        assert_eq!(lines.len(), LINES_MAX);
        assert_eq!(lines[4], "line 5");
    }

    #[test]
    fn a_long_line_is_cut_with_an_ellipsis_inside_the_bound() {
        let long = "word ".repeat(80);
        let lines = fit_lines(&long);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].chars().count(), LINE_MAX);
        assert!(lines[0].ends_with(ELLIPSIS));
        assert!(!lines[0].contains(" \u{2026}"));
    }

    #[test]
    fn multibyte_text_is_cut_by_character() {
        let title = fit_title(&"é".repeat(200)).unwrap_or_default();
        assert_eq!(title.chars().count(), TITLE_MAX);
    }

    #[test]
    fn blank_text_has_no_lines_and_no_title() {
        assert_eq!(fit_lines("  \n\n - \n"), Vec::<String>::new());
        assert_eq!(fit_title("  "), None);
    }
}
