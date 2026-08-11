//! Lexing a rule string into raw option slots — a port of rrule.js's
//! `parseString`.
//!
//! This layer deliberately does **no** validation and no normalisation. Its job
//! is to reproduce, exactly, which inputs the reference *throws* on, because a
//! throw is what makes the engine fail open and show the task. Everything it
//! accepts is handed to [`super::options`] still in its raw JavaScript shape.
//!
//! Three details of the reference are reproduced rather than tidied up:
//!
//! * A value that is not an integer literal is kept as **text**, not dropped.
//!   `COUNT=abc` is `"abc"`, which is truthy but decrements to `NaN`, and that
//!   is why it collapses the rule to exactly one occurrence.
//! * A comma in a value makes it a **list**, and a list is not the same as a
//!   one-element scalar: `parseOptions` splits `BYMONTHDAY` by sign only for
//!   lists, so `BYMONTHDAY=abc` and `BYMONTHDAY=1,abc` end up in different
//!   places.
//! * A key may be present with an **undefined** value — `FREQ=NONSENSE` looks
//!   up an enum that has no such member. That is not the same as the key being
//!   absent: an absent `FREQ` defaults to `YEARLY`, a present-but-unresolved
//!   one is rejected. [`Slot`] carries the distinction.

use super::instant;

/// The reference threw. Every caller turns this into "show the task".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Unparsable;

/// A rule part's presence, with JavaScript's third state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) enum Slot<T> {
    /// The key never appeared.
    #[default]
    Absent,
    /// The key appeared but its value resolved to `undefined`.
    Undefined,
    /// The key appeared and resolved.
    Present(T),
}

impl<T> Slot<T> {
    /// The reference's `isPresent`, which is false for `undefined`.
    pub(super) const fn as_present(&self) -> Option<&T> {
        match self {
            Self::Present(value) => Some(value),
            Self::Absent | Self::Undefined => None,
        }
    }
}

/// One numeric rule-part value as `parseIndividualNumber` leaves it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PartValue {
    /// An integer literal.
    Number(i64),
    /// Anything else, kept verbatim. It compares equal to nothing numeric, so
    /// it filters every day out rather than being ignored.
    Text(String),
}

/// A numeric rule part before normalisation. A comma decides the variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RawPart {
    /// No comma appeared in the value.
    Scalar(PartValue),
    /// A comma appeared, so the reference produced a JavaScript array.
    List(Vec<PartValue>),
}

impl RawPart {
    /// The reference's `Boolean(value)`: only `0` and `""` are falsy here,
    /// because an array object is always truthy.
    pub(super) fn is_truthy(&self) -> bool {
        match self {
            Self::Scalar(PartValue::Number(value)) => *value != 0,
            Self::Scalar(PartValue::Text(text)) => !text.is_empty(),
            Self::List(_) => true,
        }
    }

    /// The reference's `notEmpty(value)`. A bare number has no `length`, so it
    /// is never "empty" — which is how `BYMONTH=0` still suppresses the
    /// defaults it would otherwise pick up.
    pub(super) fn is_not_empty(&self) -> bool {
        match self {
            Self::Scalar(PartValue::Number(_)) => true,
            Self::Scalar(PartValue::Text(text)) => !text.is_empty(),
            Self::List(values) => !values.is_empty(),
        }
    }
}

/// One `BYDAY` element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WeekdaySpec {
    /// A bare weekday such as `MO`.
    Plain(u8),
    /// An ordinal weekday such as `-1FR`.
    Nth(u8, i64),
    /// A two-letter code that is not a weekday. The reference stores
    /// `undefined` here and only trips over it later, in `parseOptions`.
    Unknown,
}

/// Every rule part, still raw.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct RawOptions {
    pub(super) freq: Slot<Frequency>,
    pub(super) wkst: Slot<u8>,
    pub(super) count: Option<RawPart>,
    pub(super) interval: Option<RawPart>,
    pub(super) setpos: Option<RawPart>,
    pub(super) month: Option<RawPart>,
    pub(super) monthday: Option<RawPart>,
    pub(super) yearday: Option<RawPart>,
    pub(super) weekno: Option<RawPart>,
    pub(super) hour: Option<RawPart>,
    pub(super) minute: Option<RawPart>,
    pub(super) second: Option<RawPart>,
    pub(super) weekday: Option<Vec<WeekdaySpec>>,
    pub(super) until: Option<i64>,
    pub(super) easter: Option<EasterOffset>,
    /// Whether a `TZID` survived into the parsed options.
    pub(super) tzid: bool,
}

/// `BYEASTER`, which the reference reads with `Number(value)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EasterOffset {
    /// A usable day offset from Easter Sunday.
    Days(i64),
    /// `Number(value)` produced `NaN`, which matches no day at all.
    NotANumber,
}

/// RFC 5545 `FREQ`, ordered so that comparisons match rrule.js's numbering —
/// `YEARLY` is 0 and `SECONDLY` is 6, and the iterator branches on `<` and `>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Frequency {
    /// Once a year.
    Yearly,
    /// Once a month.
    Monthly,
    /// Once a week.
    Weekly,
    /// Once a day.
    Daily,
    /// Once an hour.
    Hourly,
    /// Once a minute.
    Minutely,
    /// Once a second.
    Secondly,
}

impl Frequency {
    /// The reference's `freqIsDailyOrGreater`, which decides whether the
    /// time-of-day set is fixed for the whole expansion or recomputed per step.
    pub(super) const fn is_daily_or_greater(self) -> bool {
        matches!(
            self,
            Self::Yearly | Self::Monthly | Self::Weekly | Self::Daily
        )
    }

    fn from_name(name: &str) -> Option<Self> {
        match name {
            "YEARLY" => Some(Self::Yearly),
            "MONTHLY" => Some(Self::Monthly),
            "WEEKLY" => Some(Self::Weekly),
            "DAILY" => Some(Self::Daily),
            "HOURLY" => Some(Self::Hourly),
            "MINUTELY" => Some(Self::Minutely),
            "SECONDLY" => Some(Self::Secondly),
            _ => None,
        }
    }
}

/// The `Days` lookup, which is a plain object and therefore case-sensitive.
fn weekday_from_code(code: &str) -> Option<u8> {
    match code {
        "MO" => Some(0),
        "TU" => Some(1),
        "WE" => Some(2),
        "TH" => Some(3),
        "FR" => Some(4),
        "SA" => Some(5),
        "SU" => Some(6),
        _ => None,
    }
}

/// Parse a whole rule string.
///
/// The reference splits on newlines, drops blank lines, and then merges only
/// the *first two* surviving line results — so a third line is silently
/// ignored. Reproduced rather than generalised.
pub(super) fn parse_rule_string(rule: &str) -> Result<RawOptions, Unparsable> {
    let mut lines = Vec::new();
    for line in rule.split('\n') {
        if let Some(parsed) = parse_line(line)? {
            lines.push(parsed);
        }
    }
    let mut merged = RawOptions::default();
    for parsed in lines.into_iter().take(2) {
        merge(&mut merged, parsed);
    }
    Ok(merged)
}

/// `__assign(__assign({}, first), second)`: every key the later object owns
/// wins, including keys it owns with an `undefined` value.
fn merge(into: &mut RawOptions, from: RawOptions) {
    if from.freq != Slot::Absent {
        into.freq = from.freq;
    }
    if from.wkst != Slot::Absent {
        into.wkst = from.wkst;
    }
    if from.weekday.is_some() {
        into.weekday = from.weekday;
    }
    if from.until.is_some() {
        into.until = from.until;
    }
    if from.easter.is_some() {
        into.easter = from.easter;
    }
    into.tzid |= from.tzid;
    for (target, source) in [
        (&mut into.count, from.count),
        (&mut into.interval, from.interval),
        (&mut into.setpos, from.setpos),
        (&mut into.month, from.month),
        (&mut into.monthday, from.monthday),
        (&mut into.yearday, from.yearday),
        (&mut into.weekno, from.weekno),
        (&mut into.hour, from.hour),
        (&mut into.minute, from.minute),
        (&mut into.second, from.second),
    ] {
        if source.is_some() {
            *target = source;
        }
    }
}

/// `parseLine`. Returns `None` for a line that is blank after trimming.
fn parse_line(line: &str) -> Result<Option<RawOptions>, Unparsable> {
    let trimmed = strip_one_edge(line);
    if trimmed.is_empty() {
        return Ok(None);
    }
    match content_line_key(trimmed) {
        None | Some("RRULE" | "EXRULE") => parse_rrule(trimmed).map(Some),
        Some("DTSTART") => {
            // The model overwrites `dtstart` after parsing, so only a surviving
            // `TZID` is observable here.
            let (tzid, _) = parse_dtstart_part(trimmed)?;
            Ok(Some(RawOptions {
                tzid,
                ..RawOptions::default()
            }))
        }
        // `Unsupported RFC prop`.
        Some(_) => Err(Unparsable),
    }
}

/// `/^\s+|\s+$/` without the global flag replaces only the **first** match, so
/// a string with leading whitespace loses only that.
fn strip_one_edge(line: &str) -> &str {
    if line.starts_with(char::is_whitespace) {
        line.trim_start()
    } else {
        line.trim_end()
    }
}

/// `/^([A-Z]+?)[:;]/` against the upper-cased line: the shortest run of ASCII
/// letters that is immediately followed by `:` or `;`.
fn content_line_key(line: &str) -> Option<&str> {
    let letters = line.bytes().take_while(u8::is_ascii_alphabetic).count();
    if letters == 0 {
        return None;
    }
    let separator = line.as_bytes().get(letters)?;
    if *separator == b':' || *separator == b';' {
        line.get(..letters)
    } else {
        None
    }
}

/// `parseRrule`.
fn parse_rrule(line: &str) -> Result<RawOptions, Unparsable> {
    let stripped = strip_prefix_ignore_case(line, "RRULE:").unwrap_or(line);
    let (tzid, _) = parse_dtstart_part(stripped)?;
    let mut options = RawOptions {
        tzid,
        ..RawOptions::default()
    };

    let body = strip_prefix_ignore_case(line, "RRULE:")
        .or_else(|| strip_prefix_ignore_case(line, "EXRULE:"))
        .unwrap_or(line);
    for attribute in body.split(';') {
        let mut fields = attribute.split('=');
        let key = fields.next().unwrap_or_default().to_ascii_uppercase();
        let value = fields.next();
        apply_attribute(&mut options, &key, value, line)?;
    }
    Ok(options)
}

/// One `KEY=VALUE` pair. `value` is `None` when the attribute carried no `=`,
/// which is a `TypeError` in every branch that dereferences it.
fn apply_attribute(
    options: &mut RawOptions,
    key: &str,
    value: Option<&str>,
    line: &str,
) -> Result<(), Unparsable> {
    match key {
        "FREQ" => {
            let value = value.ok_or(Unparsable)?;
            options.freq = slot_from(Frequency::from_name(&value.to_ascii_uppercase()));
        }
        "WKST" => {
            let value = value.ok_or(Unparsable)?;
            options.wkst = slot_from(weekday_from_code(&value.to_ascii_uppercase()));
        }
        "BYWEEKDAY" | "BYDAY" => {
            options.weekday = Some(parse_weekday_list(value.ok_or(Unparsable)?)?);
        }
        "UNTIL" => {
            options.until = Some(until_string_to_date(value.unwrap_or("undefined"))?);
        }
        "BYEASTER" => {
            // `Number(value)`, which is `0` for the empty string and `NaN` for
            // anything else it cannot read.
            let offset = value.and_then(|raw| {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    Some(0)
                } else {
                    trimmed.parse::<i64>().ok()
                }
            });
            options.easter = Some(offset.map_or(EasterOffset::NotANumber, EasterOffset::Days));
        }
        "DTSTART" | "TZID" => {
            let (tzid, _) = parse_dtstart_part(line)?;
            options.tzid = tzid;
        }
        _ => {
            let part = parse_number(value.ok_or(Unparsable)?);
            let target = match key {
                "COUNT" => &mut options.count,
                "INTERVAL" => &mut options.interval,
                "BYSETPOS" => &mut options.setpos,
                "BYMONTH" => &mut options.month,
                "BYMONTHDAY" => &mut options.monthday,
                "BYYEARDAY" => &mut options.yearday,
                "BYWEEKNO" => &mut options.weekno,
                "BYHOUR" => &mut options.hour,
                "BYMINUTE" => &mut options.minute,
                "BYSECOND" => &mut options.second,
                // `Unknown RRULE property`.
                _ => return Err(Unparsable),
            };
            *target = Some(part);
        }
    }
    Ok(())
}

fn slot_from<T>(resolved: Option<T>) -> Slot<T> {
    resolved.map_or(Slot::Undefined, Slot::Present)
}

fn strip_prefix_ignore_case<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let head = line.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        line.get(prefix.len()..)
    } else {
        None
    }
}

/// `parseNumber`: a comma anywhere makes it a list.
fn parse_number(value: &str) -> RawPart {
    if value.contains(',') {
        RawPart::List(value.split(',').map(parse_individual_number).collect())
    } else {
        RawPart::Scalar(parse_individual_number(value))
    }
}

/// `parseIndividualNumber`: `/^[+-]?\d+$/` or the raw text.
///
/// A literal too large for `i64` is kept as text. The reference would produce a
/// lossy float, which matches no calendar field either, so both answers filter
/// the same days out.
fn parse_individual_number(value: &str) -> PartValue {
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    if !digits.is_empty()
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && let Ok(parsed) = value.parse::<i64>()
    {
        return PartValue::Number(parsed);
    }
    PartValue::Text(value.to_owned())
}

/// `parseWeekday`.
fn parse_weekday_list(value: &str) -> Result<Vec<WeekdaySpec>, Unparsable> {
    value.split(',').map(parse_one_weekday).collect()
}

fn parse_one_weekday(day: &str) -> Result<WeekdaySpec, Unparsable> {
    if day.chars().count() == 2 {
        return Ok(weekday_from_code(day).map_or(WeekdaySpec::Unknown, WeekdaySpec::Plain));
    }
    // `/^([+-]?\d{1,2})([A-Z]{2})$/`.
    let code_start = day.len().checked_sub(2).ok_or(Unparsable)?;
    let (ordinal, code) = (day.get(..code_start), day.get(code_start..));
    let (ordinal, code) = (ordinal.ok_or(Unparsable)?, code.ok_or(Unparsable)?);
    if !code.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(Unparsable);
    }
    let digits = ordinal.strip_prefix(['+', '-']).unwrap_or(ordinal);
    if digits.is_empty() || digits.len() > 2 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(Unparsable);
    }
    let number: i64 = ordinal.parse().map_err(|_| Unparsable)?;
    // `Days[wdaypart].weekday` is a `TypeError` for an unknown code, and the
    // `Weekday` constructor rejects `n === 0`.
    let weekday = weekday_from_code(code).ok_or(Unparsable)?;
    if number == 0 {
        return Err(Unparsable);
    }
    Ok(WeekdaySpec::Nth(weekday, number))
}

/// `untilStringToDate`: `/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/`.
fn until_string_to_date(value: &str) -> Result<i64, Unparsable> {
    let bytes = value.as_bytes();
    let all_digits = |range: core::ops::Range<usize>| {
        value
            .get(range)
            .is_some_and(|slice| slice.bytes().all(|byte| byte.is_ascii_digit()))
    };
    let number = |range: core::ops::Range<usize>| -> i64 {
        value
            .get(range)
            .and_then(|slice| slice.parse::<i64>().ok())
            .unwrap_or(0)
    };
    if bytes.len() < 8 || !all_digits(0..8) {
        return Err(Unparsable);
    }
    let (hour, minute, second) = match bytes.len() {
        8 => (0, 0, 0),
        15 | 16 => {
            let has_zulu = bytes.len() == 15 || bytes.get(15) == Some(&b'Z');
            if bytes.get(8) != Some(&b'T') || !all_digits(9..15) || !has_zulu {
                return Err(Unparsable);
            }
            (number(9..11), number(11..13), number(13..15))
        }
        _ => return Err(Unparsable),
    };
    instant::from_parts(
        number(0..4),
        number(4..6) - 1,
        number(6..8),
        hour,
        minute,
        second,
        0,
    )
    .ok_or(Unparsable)
}

/// `parseDtstart`: `/DTSTART(?:;TZID=([^:=]+?))?(?::|=)([^;\s]+)/i`.
///
/// Returns whether a non-empty `TZID` was captured, and the parsed instant.
/// Both are only observable through the model when a rule carries a *second*
/// `DTSTART`, since the model strips the first one before this runs.
fn parse_dtstart_part(line: &str) -> Result<(bool, Option<i64>), Unparsable> {
    let lowered = line.to_ascii_lowercase();
    for (start, _) in lowered.match_indices("dtstart") {
        let Some(rest) = line.get(start.saturating_add("dtstart".len())..) else {
            continue;
        };
        let (tzid, after_tzid) = if let Some(after) = strip_prefix_ignore_case(rest, ";TZID=") {
            let Some(end) = after.find([':', '=']).filter(|end| *end > 0) else {
                continue;
            };
            (after.get(..end), after.get(end..))
        } else {
            (None, Some(rest))
        };
        let Some(after_tzid) = after_tzid else {
            continue;
        };
        let Some(value) = after_tzid.strip_prefix([':', '=']) else {
            continue;
        };
        let end = value
            .find(|character: char| character == ';' || character.is_whitespace())
            .unwrap_or(value.len());
        if end == 0 {
            continue;
        }
        let Some(value) = value.get(..end) else {
            continue;
        };
        let parsed = until_string_to_date(value)?;
        return Ok((tzid.is_some_and(|tzid| !tzid.is_empty()), Some(parsed)));
    }
    Ok((false, None))
}

#[cfg(test)]
mod tests {
    use super::{Frequency, PartValue, RawPart, Slot, Unparsable, WeekdaySpec, parse_rule_string};

    fn parse(rule: &str) -> Result<super::RawOptions, Unparsable> {
        parse_rule_string(rule)
    }

    #[test]
    fn an_empty_option_set_leaves_freq_absent() {
        // The model trims `DTSTART:20260105` down to the empty string, and an
        // absent FREQ later defaults to YEARLY rather than failing.
        let parsed = parse("").expect("an empty rule string parses");
        assert_eq!(parsed.freq, Slot::Absent);
    }

    #[test]
    fn an_unresolved_freq_is_undefined_not_absent() {
        assert_eq!(
            parse("FREQ=NONSENSE").expect("parses").freq,
            Slot::Undefined
        );
        assert_eq!(parse("FREQ=").expect("parses").freq, Slot::Undefined);
    }

    #[test]
    fn keys_and_values_are_case_insensitive() {
        assert_eq!(
            parse("freq=daily").expect("parses").freq,
            Slot::Present(Frequency::Daily)
        );
    }

    #[test]
    fn a_trailing_separator_throws_but_a_doubled_one_does_too() {
        assert_eq!(parse("FREQ=DAILY;"), Err(Unparsable));
        assert_eq!(parse("FREQ=DAILY;;INTERVAL=2"), Err(Unparsable));
    }

    #[test]
    fn unknown_properties_and_bare_tokens_throw() {
        assert_eq!(parse("garbage"), Err(Unparsable));
        assert_eq!(parse("FREQ"), Err(Unparsable));
        assert_eq!(parse("=DAILY"), Err(Unparsable));
        assert_eq!(parse("FREQ=DAILY;UNKNOWNPART=7"), Err(Unparsable));
    }

    #[test]
    fn a_content_line_prefix_is_tolerated() {
        assert_eq!(
            parse("RRULE:FREQ=DAILY").expect("parses").freq,
            Slot::Present(Frequency::Daily)
        );
    }

    #[test]
    fn an_unknown_wkst_is_undefined_rather_than_rejected() {
        assert_eq!(
            parse("FREQ=DAILY;WKST=XX").expect("parses").wkst,
            Slot::Undefined
        );
    }

    #[test]
    fn a_non_numeric_count_stays_text() {
        assert_eq!(
            parse("FREQ=DAILY;COUNT=abc").expect("parses").count,
            Some(RawPart::Scalar(PartValue::Text("abc".to_owned())))
        );
        assert_eq!(
            parse("FREQ=DAILY;COUNT=-5").expect("parses").count,
            Some(RawPart::Scalar(PartValue::Number(-5)))
        );
    }

    #[test]
    fn a_comma_makes_a_list() {
        assert_eq!(
            parse("FREQ=MONTHLY;BYMONTHDAY=15,-1")
                .expect("parses")
                .monthday,
            Some(RawPart::List(vec![
                PartValue::Number(15),
                PartValue::Number(-1)
            ]))
        );
    }

    #[test]
    fn weekday_codes_and_ordinals() {
        assert_eq!(
            parse("FREQ=WEEKLY;BYDAY=MO,WE").expect("parses").weekday,
            Some(vec![WeekdaySpec::Plain(0), WeekdaySpec::Plain(2)])
        );
        assert_eq!(
            parse("FREQ=MONTHLY;BYDAY=-1FR").expect("parses").weekday,
            Some(vec![WeekdaySpec::Nth(4, -1)])
        );
        // An unknown two-letter code survives lexing and only trips over
        // `parseOptions`, which is where the reference throws.
        assert_eq!(
            parse("FREQ=WEEKLY;BYDAY=XX").expect("parses").weekday,
            Some(vec![WeekdaySpec::Unknown])
        );
        assert_eq!(parse("FREQ=WEEKLY;BYDAY="), Err(Unparsable));
        assert_eq!(parse("FREQ=WEEKLY;BYDAY=MO,,FR"), Err(Unparsable));
        assert_eq!(parse("FREQ=MONTHLY;BYDAY=0MO"), Err(Unparsable));
    }

    #[test]
    fn until_accepts_only_the_basic_forms() {
        assert!(parse("FREQ=DAILY;UNTIL=20270101").is_ok());
        assert!(parse("FREQ=DAILY;UNTIL=20270101T000000").is_ok());
        assert!(parse("FREQ=DAILY;UNTIL=20270101T000000Z").is_ok());
        assert_eq!(parse("FREQ=DAILY;UNTIL=2027-01-01"), Err(Unparsable));
        assert_eq!(parse("FREQ=DAILY;UNTIL=notadate"), Err(Unparsable));
    }
}
