//! Quick-add parsing.
//!
//! `Fix login bug !high p:Auth @work #backend tomorrow` becomes a title, a
//! priority, a project, a context, a tag, and a due date. The parser runs on
//! every keystroke to drive a live preview, so **partial results are the normal
//! case** and there is nothing to reject: every word ends up somewhere, and an
//! unrecognised token joins the title verbatim rather than vanishing.
//!
//! The only way the exported form can fail is a malformed `today`, which is a
//! caller bug rather than user input — the user's today comes from the host's
//! clock, not from the text field.

use tasknotes_core::{domain::NlpParseResult, nlp};

use crate::{dates::parse_iso_date, error::CoreError};

/// Parse a quick-add line into the fields it describes.
///
/// `today` is **the user's today** as `YYYY-MM-DD` — the civil date their wall
/// clock shows, which only the host can compute. It is a parameter rather than
/// a clock read so that the timezone decision is written down at the call site;
/// collapsing the two is the exact bug that made every recurring task a day
/// late east of Greenwich in the app this replaces.
///
/// An empty list comes back as `None` rather than an empty array, mirroring the
/// TypeScript's conditional spread — which is what makes the serialized result
/// byte-identical to the one the server's `/nlp` endpoint answers with.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `today` is not a `YYYY-MM-DD` date.
/// The `input` itself can never fail: a parse error on a half-typed word would
/// be an error message the user has to dismiss to keep typing.
#[uniffi::export]
pub fn parse_task_input(input: &str, today: &str) -> Result<NlpParseResult, CoreError> {
    Ok(nlp::parse_task_input(input, parse_iso_date(today)?))
}

#[cfg(test)]
mod tests {
    use tasknotes_core::domain::Priority;

    use super::parse_task_input;
    use crate::error::CoreError;

    #[test]
    fn every_sigil_lands_in_its_own_field() {
        let parsed = parse_task_input(
            "Fix login bug !high p:Auth @work #backend tomorrow",
            "2026-08-08",
        )
        .unwrap();
        assert_eq!(parsed.title, "Fix login bug");
        assert_eq!(parsed.priority, Some(Priority::High));
        assert_eq!(
            parsed.projects.as_deref(),
            Some(["Auth".to_owned()].as_slice())
        );
        assert_eq!(
            parsed.contexts.as_deref(),
            Some(["work".to_owned()].as_slice())
        );
        assert_eq!(
            parsed.tags.as_deref(),
            Some(["backend".to_owned()].as_slice())
        );
        assert_eq!(parsed.due.as_deref(), Some("2026-08-09"));
    }

    #[test]
    fn an_empty_line_parses_rather_than_failing() {
        let parsed = parse_task_input("", "2026-08-08").unwrap();
        assert_eq!(parsed.title, "");
        assert_eq!(parsed.due, None);
        assert_eq!(parsed.projects, None, "an empty list is absent, not empty");
    }

    #[test]
    fn a_malformed_today_is_a_caller_bug_and_says_so() {
        let error = parse_task_input("Anything", "08/08/2026").unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
            "unexpected error: {error:?}"
        );
    }
}
