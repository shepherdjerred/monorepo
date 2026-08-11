//! Natural-language task entry: date phrases, priority tokens, tags, contexts,
//! and projects parsed out of a single input line.
//!
//! `Fix login bug !high p:Auth @work #backend tomorrow` becomes a title, a
//! priority, a project, a context, a tag, and a due date. The grammar is
//! whitespace-split with sigil dispatch, and the parser is a hand-rolled token
//! scanner because that is what the grammar is — a combinator library would add
//! a dependency and an opaque type surface without touching the parts that are
//! actually hard here.
//!
//! ## Three properties that matter more than the grammar
//!
//! **It never fails.** [`parse_task_input`] returns a result for every input,
//! including the empty string. There is nothing to reject: the user is typing
//! into a text field, and a parse error would be an error message on a
//! half-typed word.
//!
//! **Every word ends up somewhere.** A token that matches no rule joins the
//! title verbatim, so `p:` with no name and a bare `@` stay visible rather than
//! vanishing. Anything a user typed and cannot see is worse than anything they
//! typed and can.
//!
//! **Partial results are the normal case.** The parser runs on every keystroke
//! to drive a live preview, so `Fix bug !hi` has to mean "no priority yet", not
//! "invalid".
//!
//! ## Sigils
//!
//! | token | meaning |
//! |---|---|
//! | `!highest` `!high` `!medium` `!low` `!none`, `!1`–`!4` | priority; last one wins |
//! | `p:Name` | project; repeatable |
//! | `@name` | context; repeatable |
//! | `#name` | tag; repeatable |
//!
//! Sigil matching runs **before** date matching, so `#3` is a tag and never a
//! day of the month. The sigils are case-insensitive for priorities only; `p:`
//! is lowercase-only, matching the original.
//!
//! ## Dates
//!
//! Only the **first** recognised date phrase is consumed; later ones stay in
//! the title, so `Prep today for tomorrow` is a task called "Prep for tomorrow"
//! due today. Longer phrases are tried first, so `end of month` cannot be read
//! as a bare `month`.
//!
//! Recognised: `today`, `tomorrow`, a weekday name (always strictly in the
//! future), `end of month`, `this weekend`, `next week`, `next month`,
//! `in N days`, `in N weeks`, and a month-day pair in either order
//! (`jan 27`, `27 jan`, `3rd august`) resolved to its next occurrence.
//!
//! `next week` is next **Monday** and `this weekend` is the coming
//! **Saturday** — Todoist's readings, not `+7 days`. See [`crate::dates`].
//!
//! ## The clock is a parameter
//!
//! [`parse_task_input`] takes `today` rather than reading a clock, exactly as
//! the TypeScript takes `now`. `today` means **the user's today** — the civil
//! date their wall clock shows — which only the host can compute. See the
//! [`crate::dates`] module docs for why that distinction is load-bearing.
//!
//! ## Known divergences from the TypeScript
//!
//! * **`in N …` accepts only decimal digits.** The original routes the count
//!   through `Number()`, which also accepts `0x10`, `1e2`, and `3.0`. In a
//!   quick-add box every one of those is a typo, and reading `in 0x10 days` as
//!   sixteen days out is the surprising answer rather than the safe one.
//! * **Word splitting uses Unicode `White_Space`.** JavaScript's `\s`
//!   additionally includes `U+FEFF`, so a stray byte-order mark would separate
//!   words there and join them here. It is a difference worth knowing about and
//!   not worth a special case.

use chrono::{Datelike, Days, Months, NaiveDate, Weekday};

use crate::dates::{next_monday, next_saturday, next_weekday, to_iso_date};
use crate::domain::{NlpParseResult, Priority};

/// Parse a quick-add line into the fields it describes.
///
/// `today` is the user's today; see the module docs. The returned
/// [`NlpParseResult`] is the same type the server's `/nlp` endpoint answers
/// with, so an on-device parse and a server parse are interchangeable at every
/// call site.
///
/// An empty list is `None` rather than an empty `Vec`, mirroring the
/// TypeScript's conditional spread. That is not cosmetic: every optional field
/// is `skip_serializing_if`, so it is what makes the serialized result
/// byte-identical to the one the TypeScript produces.
#[must_use]
pub fn parse_task_input(input: &str, today: NaiveDate) -> NlpParseResult {
    let words: Vec<&str> = input.split_whitespace().collect();

    let mut title_parts: Vec<&str> = Vec::new();
    let mut due: Option<NaiveDate> = None;
    let mut priority: Option<Priority> = None;
    let mut projects: Vec<String> = Vec::new();
    let mut contexts: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();

    let mut cursor = 0;
    while let Some(word) = words.get(cursor).copied() {
        let start = cursor;
        cursor += 1;

        if let Some(parsed) = parse_priority(word) {
            priority = Some(parsed);
            continue;
        }
        if let Some(name) = named_after(word, "p:") {
            projects.push(name.to_owned());
            continue;
        }
        if let Some(name) = named_after(word, "@") {
            contexts.push(name.to_owned());
            continue;
        }
        if let Some(name) = named_after(word, "#") {
            tags.push(name.to_owned());
            continue;
        }

        if due.is_none()
            && let Some(phrase) = match_date_phrase(&words, start, today)
        {
            due = Some(phrase.due);
            cursor = start + phrase.consumed;
            continue;
        }

        title_parts.push(word);
    }

    NlpParseResult {
        title: title_parts.join(" "),
        due: due.map(to_iso_date),
        priority,
        projects: some_if_populated(projects),
        contexts: some_if_populated(contexts),
        tags: some_if_populated(tags),
        // This parser recognises no recurrence phrases. The field exists
        // because the server's parser does, and both fill the same type.
        recurrence: None,
    }
}

/// `None` for an empty list, mirroring the TypeScript conditional spread.
fn some_if_populated(values: Vec<String>) -> Option<Vec<String>> {
    (!values.is_empty()).then_some(values)
}

/// The name a sigil introduces, or `None` when the sigil stands alone.
///
/// A bare `@` or `p:` is not an empty-named context — it is a user who has not
/// finished typing, so it falls through to the title and stays on screen.
fn named_after<'word>(word: &'word str, sigil: &str) -> Option<&'word str> {
    word.strip_prefix(sigil).filter(|name| !name.is_empty())
}

/// A priority token.
///
/// [`Priority::Normal`] has no spelling here, matching the original: `normal`
/// is the value a task has when nobody set one, so there is nothing to say.
fn parse_priority(word: &str) -> Option<Priority> {
    match word.to_lowercase().as_str() {
        "!highest" | "!1" => Some(Priority::Highest),
        "!high" | "!2" => Some(Priority::High),
        "!medium" | "!3" => Some(Priority::Medium),
        "!low" | "!4" => Some(Priority::Low),
        "!none" => Some(Priority::None),
        _ => None,
    }
}

/// A date phrase and how many words it used up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PhraseMatch {
    due: NaiveDate,
    consumed: usize,
}

impl PhraseMatch {
    const fn new(due: NaiveDate, consumed: usize) -> Self {
        Self { due, consumed }
    }
}

/// The lowercased words at a phrase position.
///
/// Three wide because that is the longest phrase in the grammar (`end of
/// month`, `in 3 days`). Reading past the end yields `""`, which is the
/// TypeScript `words[i + offset]?.toLowerCase() ?? ""` — an empty string
/// matches no keyword, so running off the end of the input needs no separate
/// branch anywhere below.
struct Window {
    words: [String; 3],
}

impl Window {
    fn at(words: &[&str], start: usize) -> Self {
        Self {
            words: core::array::from_fn(|offset| {
                start
                    .checked_add(offset)
                    .and_then(|index| words.get(index))
                    .map_or_else(String::new, |word| word.to_lowercase())
            }),
        }
    }

    fn word(&self, offset: usize) -> &str {
        self.words.get(offset).map_or("", String::as_str)
    }
}

/// Match a date phrase starting at `start`.
///
/// Order is the grammar: multi-word keyword phrases, then `in N …`, then a
/// month-day pair, then a single word. Longest-first is what stops `end of
/// month` from being read as three unrelated title words.
fn match_date_phrase(words: &[&str], start: usize, today: NaiveDate) -> Option<PhraseMatch> {
    let window = Window::at(words, start);
    match_keyword_phrase(&window, today)
        .or_else(|| match_in_phrase(&window, today))
        .or_else(|| match_month_day_phrase(&window, today))
        .or_else(|| {
            let single = words.get(start)?;
            resolve_single_word(single, today).map(|due| PhraseMatch::new(due, 1))
        })
}

/// `end of month` · `this weekend` · `next week` · `next month`
fn match_keyword_phrase(window: &Window, today: NaiveDate) -> Option<PhraseMatch> {
    match (window.word(0), window.word(1), window.word(2)) {
        ("end", "of", "month") => last_day_of_month(today).map(|due| PhraseMatch::new(due, 3)),
        ("this", "weekend", _) => next_saturday(today).map(|due| PhraseMatch::new(due, 2)),
        ("next", "week", _) => next_monday(today).map(|due| PhraseMatch::new(due, 2)),
        // The same day one month on, clamped to the target month's length, so
        // "next month" on 31 January is 28 February rather than 3 March.
        ("next", "month", _) => today
            .checked_add_months(Months::new(1))
            .map(|due| PhraseMatch::new(due, 2)),
        _ => None,
    }
}

/// `in N days` · `in N weeks`
fn match_in_phrase(window: &Window, today: NaiveDate) -> Option<PhraseMatch> {
    if window.word(0) != "in" {
        return None;
    }
    let count: u32 = window.word(1).parse().ok()?;
    if count == 0 {
        return None;
    }
    let days_per_unit: u64 = match window.word(2) {
        "day" | "days" => 1,
        "week" | "weeks" => 7,
        _ => return None,
    };
    let offset = u64::from(count).checked_mul(days_per_unit)?;
    today
        .checked_add_days(Days::new(offset))
        .map(|due| PhraseMatch::new(due, 3))
}

/// `jan 27` · `27 jan` · `3rd august` → the next occurrence of that month-day.
fn match_month_day_phrase(window: &Window, today: NaiveDate) -> Option<PhraseMatch> {
    if let Some(month) = parse_month_name(window.word(0))
        && let Some(day) = parse_day_number(window.word(1))
        && let Some(due) = resolve_month_day(month, day, today)
    {
        return Some(PhraseMatch::new(due, 2));
    }
    let day = parse_day_number(window.word(0))?;
    let month = parse_month_name(window.word(1))?;
    resolve_month_day(month, day, today).map(|due| PhraseMatch::new(due, 2))
}

/// `today` · `tomorrow` · a weekday name.
fn resolve_single_word(word: &str, today: NaiveDate) -> Option<NaiveDate> {
    let lower = word.to_lowercase();
    match lower.as_str() {
        "today" => Some(today),
        "tomorrow" => today.checked_add_days(Days::new(1)),
        _ => parse_weekday_name(&lower).and_then(|weekday| next_weekday(today, weekday)),
    }
}

/// A month-day pair as the **next** occurrence: this year, or next year if it
/// has already passed.
///
/// A pair that does not exist *in the current year* is abandoned immediately —
/// next year is never consulted. That ordering is load-bearing rather than
/// incidental, and it is exactly what the original does:
///
/// ```js
/// const thisYear = new Date(today.getFullYear(), month, day);
/// if (thisYear.getMonth() !== month) return "";   // ← gives up here
/// ```
///
/// So `feb 30` stays in the title as three ordinary words, which is the same
/// judgement [`crate::dates::parse_local_date`] makes about a stored value: a
/// date nobody can write down is a typo, not a date in March.
///
/// The consequence worth knowing is `feb 29`. Typed in 2027 it finds nothing at
/// all, even though 29 February 2028 is nineteen months away, because the
/// this-year check fails first. Typed on 1 January 2028 it resolves to
/// 2028-02-29, and typed on 1 March 2028 it finds nothing again, because 2029
/// has no such day. A differential run against the TypeScript over 35,000 cases
/// found this the **only** point where a plausible reordering of the two checks
/// changes an answer, so it is written the long way round on purpose.
fn resolve_month_day(month: u32, day: u32, today: NaiveDate) -> Option<NaiveDate> {
    let year = today.year();
    let this_year = NaiveDate::from_ymd_opt(year, month, day)?;
    if this_year >= today {
        return Some(this_year);
    }
    NaiveDate::from_ymd_opt(year.checked_add(1)?, month, day)
}

/// The last day of `date`'s month.
fn last_day_of_month(date: NaiveDate) -> Option<NaiveDate> {
    date.with_day(1)?
        .checked_add_months(Months::new(1))?
        .pred_opt()
}

/// A one- or two-digit day, with an optional ordinal suffix.
///
/// `27`, `3rd`, `31st`. The suffix is not checked against the number, so `3st`
/// parses — as it does in the original, whose regex is equally relaxed. A
/// quick-add box is not the place to be pedantic about English ordinals.
fn parse_day_number(word: &str) -> Option<u32> {
    let digit_count = word.chars().take_while(char::is_ascii_digit).count();
    if !(1..=2).contains(&digit_count) {
        return None;
    }
    // Every counted character is an ASCII digit, so the character count is
    // also the byte offset; `split_at_checked` proves that rather than
    // assuming it.
    let (digits, suffix) = word.split_at_checked(digit_count)?;
    if !matches!(suffix, "" | "st" | "nd" | "rd" | "th") {
        return None;
    }
    let day: u32 = digits.parse().ok()?;
    (1..=31).contains(&day).then_some(day)
}

/// A month name or its three-letter abbreviation, one-indexed.
fn parse_month_name(word: &str) -> Option<u32> {
    match word {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" => Some(4),
        "may" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "september" => Some(9),
        "oct" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "december" => Some(12),
        _ => None,
    }
}

/// A full weekday name. Abbreviations are deliberately not recognised, so
/// `sat` stays a title word — as it does in the original.
fn parse_weekday_name(word: &str) -> Option<Weekday> {
    match word {
        "sunday" => Some(Weekday::Sun),
        "monday" => Some(Weekday::Mon),
        "tuesday" => Some(Weekday::Tue),
        "wednesday" => Some(Weekday::Wed),
        "thursday" => Some(Weekday::Thu),
        "friday" => Some(Weekday::Fri),
        "saturday" => Some(Weekday::Sat),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
