using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace TaskNotes.Windows.Host;

/// <summary>Result of advancing a recurring task on completion.</summary>
/// <param name="NextDate">Next civil date (<c>yyyy-MM-dd</c>), or null when series terminates.</param>
/// <param name="UpdatedRule">Updated <c>RRULE</c> (for example decremented <c>COUNT</c>), or null.</param>
/// <param name="ShouldComplete">True when the series has reached <c>UNTIL</c> or <c>COUNT</c> exhaustion.</param>
public sealed record NextOccurrenceResult(
    string? NextDate,
    string? UpdatedRule,
    bool ShouldComplete
);

/// <summary>Pure C# RFC 5545 recurrence parser, builder, and occurrence calculator.</summary>
public sealed class RecurrenceCodec : IRecurrenceEditor
{
    private static readonly DayOfWeek[] IsoWeekdays =
    [
        DayOfWeek.Monday,
        DayOfWeek.Tuesday,
        DayOfWeek.Wednesday,
        DayOfWeek.Thursday,
        DayOfWeek.Friday,
        DayOfWeek.Saturday,
        DayOfWeek.Sunday,
    ];

    /// <summary>Shared stateless recurrence editor instance.</summary>
    public static RecurrenceCodec Shared { get; } = new();

    /// <inheritdoc />
    public Task<RecurrenceProjection> ProjectAsync(
        string rule,
        string? scheduled,
        string? dateCreated,
        string today,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(rule);
        if (!TryParseCivilDate(today, out DateOnly todayDate))
            throw new FacetValidationException("Today must be an ISO civil date (YYYY-MM-DD).");

        DateOnly? anchor = null;
        if (!string.IsNullOrEmpty(scheduled))
        {
            if (!TryParseCivilDate(scheduled, out DateOnly scheduledDate))
                return Task.FromResult(new RecurrenceProjection(today, null));
            anchor = scheduledDate;
        }
        else if (!string.IsNullOrEmpty(dateCreated))
        {
            if (!TryParseCreatedAnchor(dateCreated, out DateOnly createdDate))
                return Task.FromResult(new RecurrenceProjection(today, null));
            anchor = createdDate;
        }

        string startText = (anchor ?? todayDate).ToString(
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture
        );

        if (string.IsNullOrWhiteSpace(rule))
        {
            return Task.FromResult(
                new RecurrenceProjection(
                    startText,
                    new RecurrenceDraft(1, new RecurrencePattern.Daily(), new RecurrenceEnd.Never())
                )
            );
        }

        RecurrenceDraft? draft = TryProjectDraft(rule, anchor);
        return Task.FromResult(new RecurrenceProjection(startText, draft));
    }

    /// <inheritdoc />
    public Task<RecurrencePattern> PatternAsync(
        RecurrenceFrequency frequency,
        string start,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!TryParseCivilDate(start, out DateOnly anchor))
            throw new FacetValidationException("Recurrence start must be YYYY-MM-DD.");

        RecurrencePattern pattern = frequency switch
        {
            RecurrenceFrequency.Daily => new RecurrencePattern.Daily(),
            RecurrenceFrequency.Weekly => new RecurrencePattern.Weekly([anchor.DayOfWeek]),
            RecurrenceFrequency.Monthly => new RecurrencePattern.MonthlyDayOfMonth(
                checked((byte)anchor.Day)
            ),
            RecurrenceFrequency.Yearly => new RecurrencePattern.YearlyMonthDay(
                checked((byte)anchor.Month),
                checked((byte)anchor.Day)
            ),
            _ => throw new ArgumentOutOfRangeException(nameof(frequency)),
        };
        return Task.FromResult(pattern);
    }

    /// <inheritdoc />
    public Task<string> BuildAsync(
        RecurrenceDraft draft,
        string start,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(draft);
        if (!TryParseCivilDate(start, out _))
            throw new FacetValidationException("Recurrence start must be YYYY-MM-DD.");
        if (draft.Interval == 0)
            throw new FacetValidationException("recurrence interval must be positive");

        StringBuilder builder = new();
        switch (draft.Pattern)
        {
            case RecurrencePattern.Daily:
                builder.Append("FREQ=DAILY");
                AppendInterval(builder, draft.Interval);
                break;

            case RecurrencePattern.Weekly weekly:
                if (weekly.Weekdays.Count == 0)
                    throw new FacetValidationException("select at least one weekday");
                foreach (DayOfWeek day in weekly.Weekdays)
                    _ = FormatWeekday(day);
                string[] orderedDays = IsoWeekdays
                    .Where(day => weekly.Weekdays.Contains(day))
                    .Select(FormatWeekday)
                    .ToArray();
                builder.Append("FREQ=WEEKLY");
                AppendInterval(builder, draft.Interval);
                builder.Append(";BYDAY=").Append(string.Join(',', orderedDays));
                break;

            case RecurrencePattern.MonthlyDayOfMonth monthlyDay:
                if (monthlyDay.Day is < 1 or > 31)
                    throw new FacetValidationException("day of month must be between 1 and 31");
                builder.Append("FREQ=MONTHLY");
                AppendInterval(builder, draft.Interval);
                builder
                    .Append(";BYMONTHDAY=")
                    .Append(monthlyDay.Day.ToString(CultureInfo.InvariantCulture));
                break;

            case RecurrencePattern.MonthlyOrdinalWeekday monthlyOrdinal:
                string prefix = FormatOrdinal(monthlyOrdinal.Ordinal);
                string weekday = FormatWeekday(monthlyOrdinal.Weekday);
                builder.Append("FREQ=MONTHLY");
                AppendInterval(builder, draft.Interval);
                builder.Append(";BYDAY=").Append(prefix).Append(weekday);
                break;

            case RecurrencePattern.YearlyMonthDay yearly:
                if (yearly.Month is < 1 or > 12)
                    throw new FacetValidationException("month must be between 1 and 12");
                int maxDays = DateTime.DaysInMonth(2024, yearly.Month);
                if (yearly.Day < 1 || yearly.Day > maxDays)
                    throw new FacetValidationException(
                        "day is out of range for the selected month"
                    );
                builder.Append("FREQ=YEARLY");
                AppendInterval(builder, draft.Interval);
                builder
                    .Append(";BYMONTH=")
                    .Append(yearly.Month.ToString(CultureInfo.InvariantCulture))
                    .Append(";BYMONTHDAY=")
                    .Append(yearly.Day.ToString(CultureInfo.InvariantCulture));
                break;

            default:
                throw new InvalidOperationException(
                    $"Unsupported recurrence pattern '{draft.Pattern.GetType().Name}'."
                );
        }

        switch (draft.Ending)
        {
            case RecurrenceEnd.Never:
                break;
            case RecurrenceEnd.OnDate onDate:
                if (!TryParseCivilDate(onDate.Date, out DateOnly untilDate))
                    throw new FacetValidationException("UNTIL date must be YYYY-MM-DD.");
                builder
                    .Append(";UNTIL=")
                    .Append(untilDate.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                break;
            case RecurrenceEnd.AfterOccurrences after:
                if (after.Count == 0)
                    throw new FacetValidationException("occurrence count must be positive");
                builder
                    .Append(";COUNT=")
                    .Append(after.Count.ToString(CultureInfo.InvariantCulture));
                break;
            default:
                throw new InvalidOperationException(
                    $"Unsupported recurrence ending '{draft.Ending.GetType().Name}'."
                );
        }

        return Task.FromResult(builder.ToString());
    }

    /// <summary>Computes the next occurrence date and updated rule when completing a recurring task.</summary>
    public static NextOccurrenceResult ComputeNextOccurrence(
        string recurrenceRule,
        string? currentDueDate,
        DateOnly today
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(recurrenceRule);
        (string cleanRule, DateOnly? dtStart) = ExtractRuleAndDtStart(recurrenceRule);
        if (!TryParseLooseRule(cleanRule, out ParsedRule? parsed) || parsed is null)
        {
            return new NextOccurrenceResult(null, recurrenceRule, ShouldComplete: true);
        }

        if (parsed.Count is <= 1)
        {
            return new NextOccurrenceResult(null, recurrenceRule, ShouldComplete: true);
        }

        DateOnly baseDate =
            currentDueDate is not null && TryParseCivilDate(currentDueDate, out DateOnly due)
                ? due
                : dtStart ?? today;

        DateOnly? next = FindNextDate(parsed, baseDate, dtStart ?? baseDate);
        if (next is null)
        {
            return new NextOccurrenceResult(null, recurrenceRule, ShouldComplete: true);
        }

        if (parsed.Until is DateOnly until && next.Value > until)
        {
            return new NextOccurrenceResult(null, recurrenceRule, ShouldComplete: true);
        }

        string updatedRule = parsed.Count is int count
            ? DecrementCountInRule(recurrenceRule, count - 1)
            : recurrenceRule;
        return new NextOccurrenceResult(
            next.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            updatedRule,
            ShouldComplete: false
        );
    }

    /// <summary>Checks whether a recurring task falls on a target civil date.</summary>
    public static bool OccursOn(string recurrenceRule, string? anchorDate, DateOnly target)
    {
        if (string.IsNullOrWhiteSpace(recurrenceRule))
            return false;
        (string cleanRule, DateOnly? dtStart) = ExtractRuleAndDtStart(recurrenceRule);
        if (!TryParseLooseRule(cleanRule, out ParsedRule? parsed) || parsed is null)
            return false;

        DateOnly anchor =
            anchorDate is not null && TryParseCivilDate(anchorDate, out DateOnly due)
                ? due
                : dtStart ?? target;
        if (target < anchor)
            return false;
        if (parsed.Until is DateOnly until && target > until)
            return false;

        return MatchesOccurrence(parsed, anchor, target);
    }

    internal static bool TryParseCivilDate(string? text, out DateOnly date)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            date = default;
            return false;
        }
        return DateOnly.TryParseExact(
            text.Trim(),
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out date
        );
    }

    private static bool TryParseCreatedAnchor(string text, out DateOnly date)
    {
        if (TryParseCivilDate(text, out date))
            return true;
        if (
            DateTimeOffset.TryParse(
                text,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out DateTimeOffset timestamp
            )
        )
        {
            date = DateOnly.FromDateTime(timestamp.UtcDateTime);
            return true;
        }
        date = default;
        return false;
    }

    private static void AppendInterval(StringBuilder builder, uint interval)
    {
        if (interval > 1)
        {
            builder.Append(";INTERVAL=").Append(interval.ToString(CultureInfo.InvariantCulture));
        }
    }

    private static RecurrenceDraft? TryProjectDraft(string rawRule, DateOnly? anchor)
    {
        if (
            rawRule.Contains('\n', StringComparison.Ordinal)
            || rawRule.Contains('\r', StringComparison.Ordinal)
        )
        {
            return null;
        }

        string trimmed = rawRule.Trim();
        if (trimmed.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[6..];
        if (trimmed.Length == 0)
            return null;

        Dictionary<string, string> parts = new(StringComparer.OrdinalIgnoreCase);
        foreach (string segment in trimmed.Split(';'))
        {
            int eq = segment.IndexOf('=', StringComparison.Ordinal);
            if (eq <= 0 || eq == segment.Length - 1)
                return null;
            string key = segment[..eq].Trim();
            string value = segment[(eq + 1)..].Trim();
            if (!parts.TryAdd(key, value))
                return null;
        }

        foreach (string key in parts.Keys)
        {
            if (
                !key.Equals("FREQ", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("INTERVAL", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("BYDAY", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("BYMONTHDAY", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("BYMONTH", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("UNTIL", StringComparison.OrdinalIgnoreCase)
                && !key.Equals("COUNT", StringComparison.OrdinalIgnoreCase)
            )
            {
                return null;
            }
        }

        if (!parts.TryGetValue("FREQ", out string? freqText))
            return null;

        uint interval = 1;
        if (
            parts.TryGetValue("INTERVAL", out string? intervalText)
            && (
                !uint.TryParse(
                    intervalText,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out interval
                )
                || interval == 0
            )
        )
        {
            return null;
        }

        bool hasUntil = parts.TryGetValue("UNTIL", out string? untilText);
        bool hasCount = parts.TryGetValue("COUNT", out string? countText);
        if (hasUntil && hasCount)
            return null;

        RecurrenceEnd ending = new RecurrenceEnd.Never();
        if (hasUntil)
        {
            if (!TryParseUntilDate(untilText!, out DateOnly untilDate))
                return null;
            ending = new RecurrenceEnd.OnDate(
                untilDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            );
        }
        else if (hasCount)
        {
            if (
                !uint.TryParse(
                    countText!,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out uint count
                )
                || count == 0
            )
            {
                return null;
            }
            ending = new RecurrenceEnd.AfterOccurrences(count);
        }

        string upperFreq = freqText.ToUpperInvariant();
        switch (upperFreq)
        {
            case "DAILY":
                if (
                    parts.ContainsKey("BYDAY")
                    || parts.ContainsKey("BYMONTHDAY")
                    || parts.ContainsKey("BYMONTH")
                )
                {
                    return null;
                }
                return new RecurrenceDraft(interval, new RecurrencePattern.Daily(), ending);

            case "WEEKLY":
                if (parts.ContainsKey("BYMONTHDAY") || parts.ContainsKey("BYMONTH"))
                    return null;
                if (parts.TryGetValue("BYDAY", out string? weeklyByDay))
                {
                    List<DayOfWeek> days = [];
                    foreach (string token in weeklyByDay.Split(','))
                    {
                        if (!TryParseWeekday(token, out DayOfWeek day))
                            return null;
                        if (!days.Contains(day))
                            days.Add(day);
                    }
                    if (days.Count == 0)
                        return null;
                    DayOfWeek[] sorted = IsoWeekdays.Where(days.Contains).ToArray();
                    return new RecurrenceDraft(
                        interval,
                        new RecurrencePattern.Weekly(sorted),
                        ending
                    );
                }
                if (anchor is not DateOnly weeklyAnchor)
                    return null;
                return new RecurrenceDraft(
                    interval,
                    new RecurrencePattern.Weekly([weeklyAnchor.DayOfWeek]),
                    ending
                );

            case "MONTHLY":
                if (parts.ContainsKey("BYMONTH"))
                    return null;
                bool hasByDay = parts.TryGetValue("BYDAY", out string? monthlyByDay);
                bool hasByMonthDay = parts.TryGetValue("BYMONTHDAY", out string? byMonthDayText);
                if (hasByDay && hasByMonthDay)
                    return null;
                if (hasByMonthDay)
                {
                    if (
                        !byte.TryParse(
                            byMonthDayText!,
                            NumberStyles.None,
                            CultureInfo.InvariantCulture,
                            out byte dom
                        ) || dom is < 1 or > 31
                    )
                    {
                        return null;
                    }
                    return new RecurrenceDraft(
                        interval,
                        new RecurrencePattern.MonthlyDayOfMonth(dom),
                        ending
                    );
                }
                if (hasByDay)
                {
                    if (
                        !TryParseOrdinalWeekday(
                            monthlyByDay!,
                            out RecurrenceOrdinal ordinal,
                            out DayOfWeek weekday
                        )
                    )
                    {
                        return null;
                    }
                    return new RecurrenceDraft(
                        interval,
                        new RecurrencePattern.MonthlyOrdinalWeekday(ordinal, weekday),
                        ending
                    );
                }
                if (anchor is not DateOnly monthlyAnchor)
                    return null;
                return new RecurrenceDraft(
                    interval,
                    new RecurrencePattern.MonthlyDayOfMonth(checked((byte)monthlyAnchor.Day)),
                    ending
                );

            case "YEARLY":
                if (parts.ContainsKey("BYDAY"))
                    return null;
                bool hasMonth = parts.TryGetValue("BYMONTH", out string? monthText);
                bool hasDay = parts.TryGetValue("BYMONTHDAY", out string? dayText);
                if (hasMonth != hasDay)
                    return null;
                if (hasMonth && hasDay)
                {
                    if (
                        !byte.TryParse(
                            monthText!,
                            NumberStyles.None,
                            CultureInfo.InvariantCulture,
                            out byte month
                        )
                        || month is < 1 or > 12
                        || !byte.TryParse(
                            dayText!,
                            NumberStyles.None,
                            CultureInfo.InvariantCulture,
                            out byte day
                        )
                        || day < 1
                        || day > DateTime.DaysInMonth(2024, month)
                    )
                    {
                        return null;
                    }
                    return new RecurrenceDraft(
                        interval,
                        new RecurrencePattern.YearlyMonthDay(month, day),
                        ending
                    );
                }
                if (anchor is not DateOnly yearlyAnchor)
                    return null;
                return new RecurrenceDraft(
                    interval,
                    new RecurrencePattern.YearlyMonthDay(
                        checked((byte)yearlyAnchor.Month),
                        checked((byte)yearlyAnchor.Day)
                    ),
                    ending
                );

            default:
                return null;
        }
    }

    private static (string CleanRule, DateOnly? DtStart) ExtractRuleAndDtStart(string raw)
    {
        DateOnly? dtStart = null;
        string clean = raw.Trim();
        if (
            clean.Contains('\n', StringComparison.Ordinal)
            || clean.Contains('\r', StringComparison.Ordinal)
        )
        {
            string? rruleLine = null;
            foreach (
                string line in clean.Split(
                    ['\r', '\n'],
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries
                )
            )
            {
                if (line.StartsWith("DTSTART", StringComparison.OrdinalIgnoreCase))
                {
                    int colon = line.IndexOf(':', StringComparison.Ordinal);
                    if (
                        colon >= 0
                        && TryParseUntilDate(line[(colon + 1)..], out DateOnly parsedStart)
                    )
                        dtStart = parsedStart;
                }
                else if (line.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase))
                {
                    rruleLine = line[6..];
                }
                else if (line.Contains("FREQ=", StringComparison.OrdinalIgnoreCase))
                {
                    rruleLine = line;
                }
            }
            clean = rruleLine ?? clean;
        }
        else if (clean.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase))
        {
            clean = clean[6..];
        }
        return (clean, dtStart);
    }

    private sealed record ParsedRule(
        RecurrenceFrequency Frequency,
        int Interval,
        DayOfWeek[]? ByDay,
        (int Ordinal, DayOfWeek Weekday)? OrdinalByDay,
        int? ByMonthDay,
        int? ByMonth,
        DateOnly? Until,
        int? Count
    );

    private static bool TryParseLooseRule(string rule, out ParsedRule? parsed)
    {
        parsed = null;
        Dictionary<string, string> parts = new(StringComparer.OrdinalIgnoreCase);
        foreach (string segment in rule.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            int eq = segment.IndexOf('=', StringComparison.Ordinal);
            if (eq <= 0)
                return false;
            parts[segment[..eq].Trim()] = segment[(eq + 1)..].Trim();
        }

        if (!parts.TryGetValue("FREQ", out string? freqRaw))
            return false;

        RecurrenceFrequency? freq = freqRaw.ToUpperInvariant() switch
        {
            "DAILY" => RecurrenceFrequency.Daily,
            "WEEKLY" => RecurrenceFrequency.Weekly,
            "MONTHLY" => RecurrenceFrequency.Monthly,
            "YEARLY" => RecurrenceFrequency.Yearly,
            _ => null,
        };
        if (freq is null)
            return false;

        int interval = 1;
        if (
            parts.TryGetValue("INTERVAL", out string? intRaw)
            && (
                !int.TryParse(intRaw, NumberStyles.None, CultureInfo.InvariantCulture, out interval)
                || interval <= 0
            )
        )
        {
            return false;
        }

        DayOfWeek[]? byDay = null;
        (int Ordinal, DayOfWeek Weekday)? ordinalByDay = null;
        if (parts.TryGetValue("BYDAY", out string? byDayRaw))
        {
            if (
                freq == RecurrenceFrequency.Monthly
                && TryParseSignedOrdinalWeekday(byDayRaw, out int ord, out DayOfWeek ordDay)
            )
            {
                ordinalByDay = (ord, ordDay);
            }
            else
            {
                List<DayOfWeek> list = [];
                foreach (string token in byDayRaw.Split(','))
                {
                    if (TryParseWeekday(token, out DayOfWeek d) && !list.Contains(d))
                        list.Add(d);
                }
                if (list.Count > 0)
                    byDay = IsoWeekdays.Where(list.Contains).ToArray();
            }
        }

        int? byMonthDay = null;
        if (
            parts.TryGetValue("BYMONTHDAY", out string? domRaw)
            && int.TryParse(
                domRaw,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out int domVal
            )
        )
        {
            byMonthDay = domVal;
        }

        int? byMonth = null;
        if (
            parts.TryGetValue("BYMONTH", out string? monthRaw)
            && int.TryParse(
                monthRaw,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out int monthVal
            )
            && monthVal is >= 1 and <= 12
        )
        {
            byMonth = monthVal;
        }

        DateOnly? until = null;
        if (
            parts.TryGetValue("UNTIL", out string? untilRaw)
            && TryParseUntilDate(untilRaw, out DateOnly u)
        )
        {
            until = u;
        }

        int? count = null;
        if (
            parts.TryGetValue("COUNT", out string? countRaw)
            && int.TryParse(countRaw, NumberStyles.None, CultureInfo.InvariantCulture, out int c)
        )
        {
            count = c;
        }

        parsed = new ParsedRule(
            freq.Value,
            interval,
            byDay,
            ordinalByDay,
            byMonthDay,
            byMonth,
            until,
            count
        );
        return true;
    }

    private static DateOnly? FindNextDate(ParsedRule rule, DateOnly current, DateOnly anchor)
    {
        switch (rule.Frequency)
        {
            case RecurrenceFrequency.Daily:
                return current.AddDays(rule.Interval);

            case RecurrenceFrequency.Weekly:
            {
                DayOfWeek[] targetDays = rule.ByDay is { Length: > 0 } days
                    ? days
                    : [current.DayOfWeek];
                DateOnly weekMonday = StartOfIsoWeek(current);
                for (int offset = 1; offset <= 7; offset++)
                {
                    DateOnly candidate = current.AddDays(offset);
                    if (
                        StartOfIsoWeek(candidate) == weekMonday
                        && targetDays.Contains(candidate.DayOfWeek)
                    )
                    {
                        return candidate;
                    }
                }
                DateOnly nextCycleMonday = weekMonday.AddDays(7 * rule.Interval);
                for (int offset = 0; offset < 7; offset++)
                {
                    DateOnly candidate = nextCycleMonday.AddDays(offset);
                    if (targetDays.Contains(candidate.DayOfWeek))
                        return candidate;
                }
                return null;
            }

            case RecurrenceFrequency.Monthly:
            {
                DateOnly cursor = new DateOnly(current.Year, current.Month, 1).AddMonths(
                    rule.Interval
                );
                for (int attempt = 0; attempt < 24; attempt++)
                {
                    DateOnly? candidate = ResolveMonthlyDate(
                        cursor.Year,
                        cursor.Month,
                        rule,
                        anchor.Day
                    );
                    if (candidate is DateOnly resolved && resolved > current)
                        return resolved;
                    cursor = cursor.AddMonths(rule.Interval);
                }
                return null;
            }

            case RecurrenceFrequency.Yearly:
            {
                int targetMonth = rule.ByMonth ?? anchor.Month;
                int targetDay = rule.ByMonthDay ?? anchor.Day;
                int year = current.Year;
                DateOnly sameYear = ClampedDate(year, targetMonth, targetDay);
                if (sameYear > current && rule.Interval == 1)
                    return sameYear;
                return ClampedDate(year + rule.Interval, targetMonth, targetDay);
            }

            default:
                return null;
        }
    }

    private static bool MatchesOccurrence(ParsedRule rule, DateOnly anchor, DateOnly target)
    {
        switch (rule.Frequency)
        {
            case RecurrenceFrequency.Daily:
                return (target.DayNumber - anchor.DayNumber) % rule.Interval == 0;

            case RecurrenceFrequency.Weekly:
            {
                DayOfWeek[] days = rule.ByDay is { Length: > 0 } d ? d : [anchor.DayOfWeek];
                if (!days.Contains(target.DayOfWeek))
                    return false;
                int weekDiff =
                    (StartOfIsoWeek(target).DayNumber - StartOfIsoWeek(anchor).DayNumber) / 7;
                return weekDiff >= 0 && weekDiff % rule.Interval == 0;
            }

            case RecurrenceFrequency.Monthly:
            {
                int monthDiff = (target.Year - anchor.Year) * 12 + (target.Month - anchor.Month);
                if (monthDiff < 0 || monthDiff % rule.Interval != 0)
                    return false;
                return ResolveMonthlyDate(target.Year, target.Month, rule, anchor.Day) == target;
            }

            case RecurrenceFrequency.Yearly:
            {
                int yearDiff = target.Year - anchor.Year;
                if (yearDiff < 0 || yearDiff % rule.Interval != 0)
                    return false;
                int month = rule.ByMonth ?? anchor.Month;
                int day = rule.ByMonthDay ?? anchor.Day;
                return ClampedDate(target.Year, month, day) == target;
            }

            default:
                return false;
        }
    }

    private static DateOnly? ResolveMonthlyDate(
        int year,
        int month,
        ParsedRule rule,
        int fallbackDay
    )
    {
        if (rule.OrdinalByDay is var (ordinal, weekday))
        {
            return NthWeekdayOfMonth(year, month, ordinal, weekday);
        }
        int dom = rule.ByMonthDay ?? fallbackDay;
        if (dom == -1)
            return new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        if (dom < 1)
            return null;
        return ClampedDate(year, month, dom);
    }

    private static DateOnly? NthWeekdayOfMonth(int year, int month, int ordinal, DayOfWeek weekday)
    {
        int daysInMonth = DateTime.DaysInMonth(year, month);
        if (ordinal == -1)
        {
            for (int day = daysInMonth; day >= 1; day--)
            {
                DateOnly d = new(year, month, day);
                if (d.DayOfWeek == weekday)
                    return d;
            }
            return null;
        }

        int seen = 0;
        for (int day = 1; day <= daysInMonth; day++)
        {
            DateOnly d = new(year, month, day);
            if (d.DayOfWeek == weekday && ++seen == ordinal)
                return d;
        }
        return null;
    }

    private static DateOnly ClampedDate(int year, int month, int day)
    {
        int clampedDay = Math.Clamp(day, 1, DateTime.DaysInMonth(year, month));
        return new DateOnly(year, month, clampedDay);
    }

    private static DateOnly StartOfIsoWeek(DateOnly date)
    {
        int offset = date.DayOfWeek == DayOfWeek.Sunday ? 6 : (int)date.DayOfWeek - 1;
        return date.AddDays(-offset);
    }

    private static string DecrementCountInRule(string rawRule, int remaining) =>
        Regex.Replace(
            rawRule,
            @"\bCOUNT=\d+",
            $"COUNT={remaining.ToString(CultureInfo.InvariantCulture)}",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            TimeSpan.FromSeconds(1)
        );

    private static bool TryParseUntilDate(string raw, out DateOnly date)
    {
        string trimmed = raw.Trim();
        if (trimmed.Length >= 8)
        {
            string digits = trimmed.Contains('-', StringComparison.Ordinal)
                ? trimmed[..Math.Min(10, trimmed.Length)]
                : trimmed[..8];
            string format = digits.Contains('-', StringComparison.Ordinal)
                ? "yyyy-MM-dd"
                : "yyyyMMdd";
            if (
                DateOnly.TryParseExact(
                    digits,
                    format,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out date
                )
            )
            {
                return true;
            }
        }
        date = default;
        return false;
    }

    private static bool TryParseWeekday(string raw, out DayOfWeek weekday)
    {
        switch (raw.Trim().ToUpperInvariant())
        {
            case "MO":
                weekday = DayOfWeek.Monday;
                return true;
            case "TU":
                weekday = DayOfWeek.Tuesday;
                return true;
            case "WE":
                weekday = DayOfWeek.Wednesday;
                return true;
            case "TH":
                weekday = DayOfWeek.Thursday;
                return true;
            case "FR":
                weekday = DayOfWeek.Friday;
                return true;
            case "SA":
                weekday = DayOfWeek.Saturday;
                return true;
            case "SU":
                weekday = DayOfWeek.Sunday;
                return true;
            default:
                weekday = default;
                return false;
        }
    }

    private static bool TryParseOrdinalWeekday(
        string raw,
        out RecurrenceOrdinal ordinal,
        out DayOfWeek weekday
    )
    {
        ordinal = default;
        weekday = default;
        if (!TryParseSignedOrdinalWeekday(raw, out int signed, out weekday))
            return false;
        switch (signed)
        {
            case 1:
                ordinal = RecurrenceOrdinal.First;
                return true;
            case 2:
                ordinal = RecurrenceOrdinal.Second;
                return true;
            case 3:
                ordinal = RecurrenceOrdinal.Third;
                return true;
            case 4:
                ordinal = RecurrenceOrdinal.Fourth;
                return true;
            case 5:
                ordinal = RecurrenceOrdinal.Fifth;
                return true;
            case -1:
                ordinal = RecurrenceOrdinal.Last;
                return true;
            default:
                return false;
        }
    }

    private static bool TryParseSignedOrdinalWeekday(
        string raw,
        out int ordinal,
        out DayOfWeek weekday
    )
    {
        ordinal = 0;
        weekday = default;
        string trimmed = raw.Trim();
        if (trimmed.Length < 3 || trimmed.Contains(',', StringComparison.Ordinal))
            return false;
        string dayPart = trimmed[^2..];
        string ordPart = trimmed[..^2];
        if (!TryParseWeekday(dayPart, out weekday))
            return false;
        return int.TryParse(
                ordPart,
                NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture,
                out ordinal
            ) && ordinal is -1 or (>= 1 and <= 5);
    }

    private static string FormatWeekday(DayOfWeek weekday) =>
        weekday switch
        {
            DayOfWeek.Monday => "MO",
            DayOfWeek.Tuesday => "TU",
            DayOfWeek.Wednesday => "WE",
            DayOfWeek.Thursday => "TH",
            DayOfWeek.Friday => "FR",
            DayOfWeek.Saturday => "SA",
            DayOfWeek.Sunday => "SU",
            _ => throw new InvalidOperationException($"Unknown weekday '{weekday}'."),
        };

    private static string FormatOrdinal(RecurrenceOrdinal ordinal) =>
        ordinal switch
        {
            RecurrenceOrdinal.First => "1",
            RecurrenceOrdinal.Second => "2",
            RecurrenceOrdinal.Third => "3",
            RecurrenceOrdinal.Fourth => "4",
            RecurrenceOrdinal.Fifth => "5",
            RecurrenceOrdinal.Last => "-1",
            _ => throw new InvalidOperationException($"Unknown ordinal '{ordinal}'."),
        };
}
