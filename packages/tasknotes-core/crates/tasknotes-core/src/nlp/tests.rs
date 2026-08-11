//! The TypeScript `nlp.test.ts` suite, ported test for test.
//!
//! The original writes its date assertions against the ambient clock
//! (`new Date()`, `daysFromNow(1)`). Here every case pins `today` to a fixed
//! Wednesday, 2026-07-22 — the same date the original already uses for the
//! cases where it cared. That is the same assertion with one fewer thing that
//! can change between runs, and it is what lets these tests run identically on
//! a developer's machine and on a CI box in another zone.

use chrono::NaiveDate;

use super::parse_task_input;
use crate::domain::Priority;

/// The fixed "user's today" every case below is written against: a Wednesday.
fn today() -> NaiveDate {
    ymd(2026, 7, 22)
}

fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

fn days_from_today(offset: i64) -> String {
    crate::dates::to_iso_date(today() + chrono::Duration::days(offset))
}

// ── basic title extraction ─────────────────────────────────────────────────

#[test]
fn returns_the_full_input_as_the_title_when_nothing_is_special() {
    assert_eq!(
        parse_task_input("Buy groceries", today()).title,
        "Buy groceries"
    );
}

#[test]
fn handles_empty_input() {
    let result = parse_task_input("", today());
    assert_eq!(result.title, "");
    assert_eq!(result, crate::domain::NlpParseResult::default());
}

#[test]
fn handles_whitespace_only_input() {
    assert_eq!(parse_task_input("   ", today()).title, "");
    assert_eq!(parse_task_input("\t\n ", today()).title, "");
}

#[test]
fn preserves_title_words_around_special_tokens() {
    let result = parse_task_input("Call dentist @phone tomorrow", today());
    assert_eq!(result.title, "Call dentist");
}

// ── priority parsing ───────────────────────────────────────────────────────

#[test]
fn parses_highest() {
    let result = parse_task_input("Fix bug !highest", today());
    assert_eq!(result.priority, Some(Priority::Highest));
    assert_eq!(result.title, "Fix bug");
}

#[test]
fn parses_high() {
    let result = parse_task_input("!high Review PR", today());
    assert_eq!(result.priority, Some(Priority::High));
    assert_eq!(result.title, "Review PR");
}

#[test]
fn parses_medium() {
    assert_eq!(
        parse_task_input("Clean desk !medium", today()).priority,
        Some(Priority::Medium)
    );
}

#[test]
fn parses_low() {
    assert_eq!(
        parse_task_input("Organize files !low", today()).priority,
        Some(Priority::Low)
    );
}

#[test]
fn parses_none() {
    assert_eq!(
        parse_task_input("Someday task !none", today()).priority,
        Some(Priority::None)
    );
}

#[test]
fn parses_numeric_priority_one_as_highest() {
    assert_eq!(
        parse_task_input("Urgent thing !1", today()).priority,
        Some(Priority::Highest)
    );
}

#[test]
fn parses_numeric_priority_two_as_high() {
    assert_eq!(
        parse_task_input("Important thing !2", today()).priority,
        Some(Priority::High)
    );
}

#[test]
fn parses_numeric_priority_three_as_medium() {
    assert_eq!(
        parse_task_input("Normal thing !3", today()).priority,
        Some(Priority::Medium)
    );
}

#[test]
fn parses_numeric_priority_four_as_low() {
    assert_eq!(
        parse_task_input("Low thing !4", today()).priority,
        Some(Priority::Low)
    );
}

#[test]
fn priority_tokens_are_case_insensitive() {
    assert_eq!(
        parse_task_input("Task !HIGH", today()).priority,
        Some(Priority::High)
    );
}

#[test]
fn leaves_priority_unset_when_none_is_given() {
    assert_eq!(parse_task_input("Just a task", today()).priority, None);
}

// ── project parsing ────────────────────────────────────────────────────────

#[test]
fn parses_a_project() {
    let result = parse_task_input("Do thing p:MyProject", today());
    assert_eq!(result.projects, Some(vec!["MyProject".to_owned()]));
    assert_eq!(result.title, "Do thing");
}

#[test]
fn parses_multiple_projects() {
    assert_eq!(
        parse_task_input("Task p:Alpha p:Beta", today()).projects,
        Some(vec!["Alpha".to_owned(), "Beta".to_owned()])
    );
}

#[test]
fn ignores_a_bare_project_sigil() {
    let result = parse_task_input("Task p:", today());
    assert_eq!(result.projects, None);
    assert_eq!(result.title, "Task p:");
}

// ── context parsing ────────────────────────────────────────────────────────

#[test]
fn parses_a_context() {
    let result = parse_task_input("Call dentist @phone", today());
    assert_eq!(result.contexts, Some(vec!["phone".to_owned()]));
    assert_eq!(result.title, "Call dentist");
}

#[test]
fn parses_multiple_contexts() {
    assert_eq!(
        parse_task_input("Task @home @evening", today()).contexts,
        Some(vec!["home".to_owned(), "evening".to_owned()])
    );
}

#[test]
fn ignores_a_bare_context_sigil() {
    let result = parse_task_input("Send @", today());
    assert_eq!(result.contexts, None);
    // A bare sigil is not dropped: it stays visible in the title.
    assert_eq!(result.title, "Send @");
}

// ── tag parsing ────────────────────────────────────────────────────────────

#[test]
fn parses_a_tag() {
    let result = parse_task_input("Review code #urgent", today());
    assert_eq!(result.tags, Some(vec!["urgent".to_owned()]));
    assert_eq!(result.title, "Review code");
}

#[test]
fn parses_multiple_tags() {
    assert_eq!(
        parse_task_input("Task #work #review", today()).tags,
        Some(vec!["work".to_owned(), "review".to_owned()])
    );
}

#[test]
fn ignores_a_bare_tag_sigil() {
    let result = parse_task_input("Task #", today());
    assert_eq!(result.tags, None);
    assert_eq!(result.title, "Task #");
}

// ── date parsing ───────────────────────────────────────────────────────────

#[test]
fn parses_today() {
    let result = parse_task_input("Buy milk today", today());
    assert_eq!(result.due.as_deref(), Some("2026-07-22"));
    assert_eq!(result.title, "Buy milk");
}

#[test]
fn parses_tomorrow() {
    let result = parse_task_input("Submit report tomorrow", today());
    assert_eq!(result.due, Some(days_from_today(1)));
    assert_eq!(result.title, "Submit report");
}

#[test]
fn parses_next_week_as_next_monday() {
    // 2026-07-22 is a Wednesday → Monday 2026-07-27.
    let result = parse_task_input("Plan meeting next week", today());
    assert_eq!(result.due.as_deref(), Some("2026-07-27"));
    assert_eq!(result.title, "Plan meeting");
}

#[test]
fn parses_this_weekend_as_the_upcoming_saturday() {
    let result = parse_task_input("Mow lawn this weekend", today());
    assert_eq!(result.due.as_deref(), Some("2026-07-25"));
    assert_eq!(result.title, "Mow lawn");
}

#[test]
fn parses_next_month_clamped_to_the_month_length() {
    let result = parse_task_input("Review budget next month", ymd(2026, 1, 31));
    assert_eq!(result.due.as_deref(), Some("2026-02-28"));
    assert_eq!(result.title, "Review budget");
}

#[test]
fn parses_end_of_month() {
    let result = parse_task_input("Invoice end of month", today());
    assert_eq!(result.due.as_deref(), Some("2026-07-31"));
    assert_eq!(result.title, "Invoice");
}

#[test]
fn parses_in_n_days_and_in_n_weeks() {
    assert_eq!(
        parse_task_input("Follow up in 3 days", today())
            .due
            .as_deref(),
        Some("2026-07-25")
    );
    assert_eq!(
        parse_task_input("Renew pass in 2 weeks", today())
            .due
            .as_deref(),
        Some("2026-08-05")
    );
    assert_eq!(
        parse_task_input("Follow up in 3 days", today()).title,
        "Follow up"
    );
}

#[test]
fn parses_a_month_day_pair_in_either_order_as_the_next_occurrence() {
    assert_eq!(
        parse_task_input("Renew domain jan 27", today())
            .due
            .as_deref(),
        Some("2027-01-27")
    );
    assert_eq!(
        parse_task_input("Renew domain 27 jan", today())
            .due
            .as_deref(),
        Some("2027-01-27")
    );
    assert_eq!(
        parse_task_input("Book trip aug 3", today()).due.as_deref(),
        Some("2026-08-03")
    );
    assert_eq!(
        parse_task_input("Book trip 3rd august", today())
            .due
            .as_deref(),
        Some("2026-08-03")
    );
}

#[test]
fn rejects_impossible_month_days() {
    let result = parse_task_input("Note feb 30 idea", today());
    assert_eq!(result.due, None);
    assert_eq!(result.title, "Note feb 30 idea");
}

#[test]
fn only_the_first_date_phrase_is_consumed() {
    let result = parse_task_input("Prep today for tomorrow", today());
    assert_eq!(result.due.as_deref(), Some("2026-07-22"));
    assert_eq!(result.title, "Prep for tomorrow");
}

#[test]
fn parses_day_names_as_the_next_such_weekday() {
    let result = parse_task_input("Call Bob monday", today());
    // 2026-07-27 is the Monday after Wednesday 2026-07-22.
    let due = ymd(2026, 7, 27);
    assert_eq!(chrono::Datelike::weekday(&due), chrono::Weekday::Mon);
    assert!(due > today());
    assert_eq!(result.due, Some(crate::dates::to_iso_date(due)));
    assert_eq!(result.title, "Call Bob");
}

#[test]
fn date_words_are_case_insensitive() {
    assert_eq!(
        parse_task_input("Task TODAY", today()).due.as_deref(),
        Some("2026-07-22")
    );
    assert_eq!(
        parse_task_input("Task Next Week", today()).due.as_deref(),
        Some("2026-07-27")
    );
}

#[test]
fn leaves_due_unset_when_no_date_is_given() {
    assert_eq!(parse_task_input("Just a task", today()).due, None);
}

// ── combined parsing ───────────────────────────────────────────────────────

#[test]
fn parses_every_field_at_once() {
    let result = parse_task_input(
        "Fix login bug !high p:Auth @work #backend tomorrow",
        today(),
    );
    assert_eq!(result.title, "Fix login bug");
    assert_eq!(result.priority, Some(Priority::High));
    assert_eq!(result.projects, Some(vec!["Auth".to_owned()]));
    assert_eq!(result.contexts, Some(vec!["work".to_owned()]));
    assert_eq!(result.tags, Some(vec!["backend".to_owned()]));
    assert_eq!(result.due, Some(days_from_today(1)));
}

#[test]
fn tokens_may_appear_in_any_order() {
    let result = parse_task_input("!1 @home #chores Buy groceries today", today());
    assert_eq!(result.priority, Some(Priority::Highest));
    assert_eq!(result.contexts, Some(vec!["home".to_owned()]));
    assert_eq!(result.tags, Some(vec!["chores".to_owned()]));
    assert_eq!(result.title, "Buy groceries");
    assert_eq!(result.due.as_deref(), Some("2026-07-22"));
}

/// The original asserts `Object.keys(result)` is exactly `["title"]`. The
/// serialized form is where that claim still means something: every optional
/// field is `skip_serializing_if`, so an unmatched input produces the same one
/// key on the wire.
#[test]
fn only_matched_fields_reach_the_serialized_result() {
    let result = parse_task_input("Simple task", today());
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::json!({ "title": "Simple task" })
    );
}

// ── beyond the TypeScript suite ────────────────────────────────────────────

/// The scanner walks bytes it did not choose — bare sigils, half-typed
/// phrases, non-ASCII, and a non-breaking space. None of these may panic, and
/// each one must leave every unclaimed word in the title, in order.
#[test]
fn never_rejects_and_never_panics_on_awkward_input() {
    for input in [
        "",
        " ",
        "!",
        "!!",
        "@",
        "#",
        "p:",
        "p::",
        "@@@",
        "in",
        "in 3",
        "in 0 days",
        "in -1 days",
        "in 3 fortnights",
        "end",
        "end of",
        "next",
        "this",
        "31st",
        "0 jan",
        "32 jan",
        "jan",
        "jan 0",
        "日本語 タスク",
        "🎉 party tomorrow",
        "café @naïve #résumé",
        "a\u{a0}b",
    ] {
        let result = parse_task_input(input, today());
        assert_words_are_a_subsequence(input, &result.title);
    }

    // The one case where knowing the answer is worth stating it: a
    // non-breaking space separates words in Rust, as `\s` does in JavaScript.
    assert_eq!(parse_task_input("a\u{a0}b", today()).title, "a b");
    // A bare sigil is never silently swallowed.
    assert_eq!(parse_task_input("p:: @@@ !!", today()).title, "!!");
    assert_eq!(
        parse_task_input("p:: @@@ !!", today()).projects,
        Some(vec![":".to_owned()])
    );
    assert_eq!(
        parse_task_input("p:: @@@ !!", today()).contexts,
        Some(vec!["@@".to_owned()])
    );
}

/// Every word of `title` appears in `input`, in the same order. This is the
/// "every word ends up somewhere, and nothing is invented" property: the
/// scanner may drop a word it claimed, but it may never reorder or fabricate.
fn assert_words_are_a_subsequence(input: &str, title: &str) {
    let mut source = input.split_whitespace();
    for title_word in title.split_whitespace() {
        assert!(
            source.any(|word| word == title_word),
            "{title_word:?} is not a remaining word of {input:?}"
        );
    }
}

/// Rules that fire before the date scanner keep firing.
#[test]
fn sigils_win_over_date_words() {
    let result = parse_task_input("#3 @monday p:today", today());
    assert_eq!(result.due, None);
    assert_eq!(result.tags, Some(vec!["3".to_owned()]));
    assert_eq!(result.contexts, Some(vec!["monday".to_owned()]));
    assert_eq!(result.projects, Some(vec!["today".to_owned()]));
    assert_eq!(result.title, "");
}

#[test]
fn the_last_priority_token_wins() {
    assert_eq!(
        parse_task_input("Task !low !highest", today()).priority,
        Some(Priority::Highest)
    );
}

/// Documented divergence: the original routes the count through `Number()`.
#[test]
fn only_decimal_counts_are_accepted_after_in() {
    for input in ["Task in 0x10 days", "Task in 1e2 days", "Task in 3.0 days"] {
        let result = parse_task_input(input, today());
        assert_eq!(result.due, None, "{input}");
    }
    assert_eq!(
        parse_task_input("Task in +3 days", today()).due.as_deref(),
        Some("2026-07-25")
    );
}

/// A phrase that starts to match and then does not must leave every one of its
/// words in the title — the scanner may not consume on a partial match.
#[test]
fn a_partial_phrase_leaves_all_its_words_in_the_title() {
    assert_eq!(
        parse_task_input("Ship end of quarter", today()).title,
        "Ship end of quarter"
    );
    assert_eq!(parse_task_input("Ship end of quarter", today()).due, None);
    assert_eq!(
        parse_task_input("Ship in three days", today()).title,
        "Ship in three days"
    );
}

/// A weekday name is never today, so a weekday phrase always dates forward.
#[test]
fn a_weekday_name_is_always_strictly_in_the_future() {
    // 2026-07-22 is a Wednesday.
    assert_eq!(
        parse_task_input("Standup wednesday", today())
            .due
            .as_deref(),
        Some("2026-07-29")
    );
    assert_eq!(
        parse_task_input("Standup thursday", today()).due.as_deref(),
        Some("2026-07-23")
    );
    assert_eq!(
        parse_task_input("Standup tuesday", today()).due.as_deref(),
        Some("2026-07-28")
    );
}

/// The parser drives a live preview, so every prefix of a real input has to be
/// answerable — and the title of any prefix has to be a subsequence of that
/// prefix's own words. That is the "every word ends up somewhere, and nothing
/// is invented" property, checked on 50 inputs including every half-typed
/// sigil along the way.
#[test]
fn every_prefix_of_an_input_keeps_its_words_in_order() {
    let input = "Fix login bug !high p:Auth @work #backend tomorrow";
    for length in 0..=input.chars().count() {
        let prefix: String = input.chars().take(length).collect();
        let result = parse_task_input(&prefix, today());
        assert_words_are_a_subsequence(&prefix, &result.title);
    }

    // The complete input is the only prefix that matches everything.
    let full = parse_task_input(input, today());
    assert_eq!(full.due, Some(days_from_today(1)));
    assert_eq!(full.title, "Fix login bug");
}

/// Found by a differential run against the TypeScript, not by reading it: the
/// this-year existence check runs *before* the has-it-passed check, so a
/// month-day that does not exist this year is abandoned outright rather than
/// rolled into next year. `feb 29` in 2027 therefore finds nothing even though
/// 2028 has one.
#[test]
fn a_month_day_missing_from_this_year_is_abandoned_rather_than_rolled_forward() {
    assert_eq!(parse_task_input("Renew feb 29", ymd(2027, 5, 15)).due, None);
    assert_eq!(
        parse_task_input("Renew feb 29", ymd(2027, 5, 15)).title,
        "Renew feb 29"
    );

    // In a leap year the same phrase resolves, before the day has passed…
    assert_eq!(
        parse_task_input("Renew feb 29", ymd(2028, 1, 1))
            .due
            .as_deref(),
        Some("2028-02-29")
    );
    // …and finds nothing after it, because 2029 has no 29 February either.
    assert_eq!(parse_task_input("Renew feb 29", ymd(2028, 3, 1)).due, None);
}
