using System.Globalization;
using TaskNotes.Protocol;

namespace TaskNotes.Windows.Host;

/// <summary>Parsed quick-capture fields ready for preview or protocol <see cref="TaskAddArgs"/> emission.</summary>
public sealed record ParsedQuickCapture(
    QuickAddPreview Preview,
    string? Description,
    TaskAddArgs CommandArgs
);

/// <summary>Pure C# natural-language Quick Add token parser.</summary>
public static class QuickCaptureParser
{
    private static readonly Dictionary<string, DayOfWeek> WeekdayMap = new(
        StringComparer.OrdinalIgnoreCase
    )
    {
        ["monday"] = DayOfWeek.Monday,
        ["mon"] = DayOfWeek.Monday,
        ["tuesday"] = DayOfWeek.Tuesday,
        ["tue"] = DayOfWeek.Tuesday,
        ["tues"] = DayOfWeek.Tuesday,
        ["wednesday"] = DayOfWeek.Wednesday,
        ["wed"] = DayOfWeek.Wednesday,
        ["thursday"] = DayOfWeek.Thursday,
        ["thu"] = DayOfWeek.Thursday,
        ["thur"] = DayOfWeek.Thursday,
        ["thurs"] = DayOfWeek.Thursday,
        ["friday"] = DayOfWeek.Friday,
        ["fri"] = DayOfWeek.Friday,
        ["saturday"] = DayOfWeek.Saturday,
        ["sat"] = DayOfWeek.Saturday,
        ["sunday"] = DayOfWeek.Sunday,
        ["sun"] = DayOfWeek.Sunday,
    };

    /// <summary>Parses natural-language input with contextual query defaults and optional field overrides.</summary>
    public static ParsedQuickCapture Parse(
        string input,
        DateOnly today,
        TaskListQuery? context = null,
        FacetCaptureOptions? options = null,
        Func<string, string>? resolveProjectId = null,
        Func<string, string>? resolveLabelId = null
    )
    {
        ArgumentNullException.ThrowIfNull(input);
        List<string> rawTokens = Tokenize(input);
        List<string> titleWords = [];
        List<string> projects = [];
        List<string> tags = [];
        List<string> contexts = [];
        string? parsedDue = null;
        string? parsedPriority = null;
        string? parsedRecurrence = null;

        int i = 0;
        while (i < rawTokens.Count)
        {
            string token = rawTokens[i];

            if (TryConsumeRecurrence(rawTokens, ref i, out string? rule))
            {
                parsedRecurrence = rule;
                continue;
            }

            if (i + 1 < rawTokens.Count && token.Equals("next", StringComparison.OrdinalIgnoreCase))
            {
                string nextWord = rawTokens[i + 1];
                if (nextWord.Equals("week", StringComparison.OrdinalIgnoreCase))
                {
                    parsedDue = FormatDate(today.AddDays(7));
                    i += 2;
                    continue;
                }
                if (WeekdayMap.TryGetValue(nextWord, out DayOfWeek nextWeekday))
                {
                    parsedDue = FormatDate(NextWeekday(today, nextWeekday));
                    i += 2;
                    continue;
                }
            }

            if (token.Equals("today", StringComparison.OrdinalIgnoreCase))
            {
                parsedDue = FormatDate(today);
                i++;
                continue;
            }

            if (token.Equals("tomorrow", StringComparison.OrdinalIgnoreCase))
            {
                parsedDue = FormatDate(today.AddDays(1));
                i++;
                continue;
            }

            if (WeekdayMap.TryGetValue(token, out DayOfWeek weekday))
            {
                parsedDue = FormatDate(NextWeekday(today, weekday));
                i++;
                continue;
            }

            if (RecurrenceCodec.TryParseCivilDate(token, out DateOnly explicitDate))
            {
                parsedDue = FormatDate(explicitDate);
                i++;
                continue;
            }

            if (TryParsePriorityToken(token, out string? priorityCode))
            {
                parsedPriority = priorityCode;
                i++;
                continue;
            }

            if (token.StartsWith('#') && token.Length > 1)
            {
                string projectName = Unquote(token[1..]);
                if (
                    projectName.Length > 0
                    && !projects.Contains(projectName, StringComparer.Ordinal)
                )
                {
                    projects.Add(projectName);
                    i++;
                    continue;
                }
            }

            if (token.StartsWith('@') && token.Length > 1)
            {
                string labelName = Unquote(token[1..]);
                if (labelName.Length > 0 && !tags.Contains(labelName, StringComparer.Ordinal))
                {
                    tags.Add(labelName);
                    i++;
                    continue;
                }
            }

            titleWords.Add(token);
            i++;
        }

        if (context is not null)
        {
            if (context.Kind == TaskListKind.Today && parsedDue is null)
                parsedDue = FormatDate(today);
            if (
                context.Kind == TaskListKind.Project
                && !string.IsNullOrWhiteSpace(context.Scope)
                && projects.Count == 0
            )
            {
                projects.Add(context.Scope);
            }
            if (
                context.Kind == TaskListKind.Tag
                && !string.IsNullOrWhiteSpace(context.Scope)
                && !tags.Contains(context.Scope, StringComparer.Ordinal)
            )
            {
                tags.Add(context.Scope);
            }
            if (
                context.Kind == TaskListKind.Context
                && !string.IsNullOrWhiteSpace(context.Scope)
                && !contexts.Contains(context.Scope, StringComparer.Ordinal)
            )
            {
                contexts.Add(context.Scope);
            }
        }

        string? scheduled = null;
        string? body = null;
        if (options is not null)
        {
            if (options.Due is not null)
                parsedDue = BlankToNull(options.Due.Value);
            if (options.Scheduled is not null)
                scheduled = BlankToNull(options.Scheduled.Value);
            if (options.Priority is not null)
                parsedPriority = BlankToNull(options.Priority.Value);
            if (options.Recurrence is not null)
                parsedRecurrence = BlankToNull(options.Recurrence.Value);
            if (options.Projects is not null)
                projects = [.. options.Projects.Value];
            if (options.Contexts is not null)
                contexts = [.. options.Contexts.Value];
            if (options.Tags is not null)
                tags = [.. options.Tags.Value];
            if (options.Body is not null)
                body = options.Body.Value;
        }

        string effectiveDue = parsedDue ?? scheduled ?? string.Empty;
        string? finalDue = effectiveDue.Length == 0 ? null : effectiveDue;
        string finalPriority = NormalizePriorityWire(parsedPriority);
        string title = string.Join(' ', titleWords).Trim();

        QuickAddPreview preview = new(
            title,
            parsedDue,
            finalPriority,
            projects.ToArray(),
            contexts.ToArray(),
            tags.ToArray(),
            parsedRecurrence
        )
        {
            Scheduled = scheduled,
        };

        string projectId =
            projects.Count > 0 && resolveProjectId is not null
                ? resolveProjectId(projects[0])
                : string.Empty;
        List<string> labelIds = [];
        if (resolveLabelId is not null)
        {
            foreach (string label in tags.Concat(contexts))
            {
                string id = resolveLabelId(label);
                if (!string.IsNullOrEmpty(id) && !labelIds.Contains(id, StringComparer.Ordinal))
                    labelIds.Add(id);
            }
        }

        TaskAddArgs args = new(
            Title: title,
            ProjectId: projectId,
            Description: body,
            Priority: ParseProtocolPriority(finalPriority),
            DueDate: finalDue,
            RecurrenceRule: parsedRecurrence,
            LabelIds: labelIds.Count > 0 ? labelIds : null
        );
        return new ParsedQuickCapture(preview, body, args);
    }

    /// <summary>Converts a UI priority wire token into protocol <see cref="Priority"/>.</summary>
    public static Priority ParseProtocolPriority(string? wire) =>
        wire?.Trim().ToUpperInvariant() switch
        {
            null or "" or "P4" or "4" or "LOW" or "NORMAL" or "NONE" => Priority.P4,
            "P1" or "1" or "HIGHEST" or "URGENT" => Priority.P1,
            "P2" or "2" or "HIGH" => Priority.P2,
            "P3" or "3" or "MEDIUM" => Priority.P3,
            _ => throw new FacetValidationException($"Unsupported priority '{wire}'."),
        };

    /// <summary>Converts a protocol <see cref="Priority"/> into the canonical UI priority wire value.</summary>
    public static string ToPriorityWire(Priority priority) =>
        priority switch
        {
            Priority.P1 => "p1",
            Priority.P2 => "p2",
            Priority.P3 => "p3",
            _ => "p4",
        };

    /// <summary>Normalizes user priority strings into canonical <c>p1</c>..<c>p4</c> wire values.</summary>
    public static string NormalizePriorityWire(string? raw) =>
        string.IsNullOrWhiteSpace(raw) ? "p4" : ToPriorityWire(ParseProtocolPriority(raw));

    private static bool TryParsePriorityToken(string token, out string? wire)
    {
        switch (token.ToUpperInvariant())
        {
            case "P1" or "!1":
                wire = "p1";
                return true;
            case "P2" or "!2":
                wire = "p2";
                return true;
            case "P3" or "!3":
                wire = "p3";
                return true;
            case "P4" or "!4":
                wire = "p4";
                return true;
            default:
                wire = null;
                return false;
        }
    }

    private static bool TryConsumeRecurrence(List<string> tokens, ref int index, out string? rule)
    {
        string current = tokens[index];
        if (current.Equals("daily", StringComparison.OrdinalIgnoreCase))
        {
            index++;
            rule = "FREQ=DAILY";
            return true;
        }
        if (current.Equals("weekly", StringComparison.OrdinalIgnoreCase))
        {
            index++;
            rule = "FREQ=WEEKLY";
            return true;
        }
        if (current.Equals("monthly", StringComparison.OrdinalIgnoreCase))
        {
            index++;
            rule = "FREQ=MONTHLY";
            return true;
        }
        if (
            current.Equals("yearly", StringComparison.OrdinalIgnoreCase)
            || current.Equals("annually", StringComparison.OrdinalIgnoreCase)
        )
        {
            index++;
            rule = "FREQ=YEARLY";
            return true;
        }

        if (
            !current.Equals("every", StringComparison.OrdinalIgnoreCase)
            || index + 1 >= tokens.Count
        )
        {
            rule = null;
            return false;
        }

        string second = tokens[index + 1];
        if (
            index + 2 < tokens.Count
            && int.TryParse(
                second,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out int interval
            )
            && interval >= 1
            && TryUnitToFreq(tokens[index + 2], out string? intervalFreq)
        )
        {
            index += 3;
            rule =
                interval == 1
                    ? $"FREQ={intervalFreq}"
                    : $"FREQ={intervalFreq};INTERVAL={interval.ToString(CultureInfo.InvariantCulture)}";
            return true;
        }

        if (
            second.Equals("weekday", StringComparison.OrdinalIgnoreCase)
            || second.Equals("weekdays", StringComparison.OrdinalIgnoreCase)
        )
        {
            index += 2;
            rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
            return true;
        }

        if (TryUnitToFreq(second, out string? simpleFreq))
        {
            index += 2;
            rule = $"FREQ={simpleFreq}";
            return true;
        }

        if (WeekdayMap.TryGetValue(second, out DayOfWeek weekday))
        {
            index += 2;
            rule = $"FREQ=WEEKLY;BYDAY={WeekdayCode(weekday)}";
            return true;
        }

        rule = null;
        return false;
    }

    private static bool TryUnitToFreq(string word, out string? freq)
    {
        switch (word.ToUpperInvariant())
        {
            case "DAY" or "DAYS":
                freq = "DAILY";
                return true;
            case "WEEK" or "WEEKS":
                freq = "WEEKLY";
                return true;
            case "MONTH" or "MONTHS":
                freq = "MONTHLY";
                return true;
            case "YEAR" or "YEARS":
                freq = "YEARLY";
                return true;
            default:
                freq = null;
                return false;
        }
    }

    private static string WeekdayCode(DayOfWeek day) =>
        day switch
        {
            DayOfWeek.Monday => "MO",
            DayOfWeek.Tuesday => "TU",
            DayOfWeek.Wednesday => "WE",
            DayOfWeek.Thursday => "TH",
            DayOfWeek.Friday => "FR",
            DayOfWeek.Saturday => "SA",
            _ => "SU",
        };

    private static DateOnly NextWeekday(DateOnly today, DayOfWeek target)
    {
        int diff = ((int)target - (int)today.DayOfWeek + 7) % 7;
        return today.AddDays(diff == 0 ? 7 : diff);
    }

    private static string FormatDate(DateOnly date) =>
        date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? BlankToNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Unquote(string value) =>
        value.Length >= 2 && value[0] == '"' && value[^1] == '"'
            ? value[1..^1].Trim()
            : value.Trim();

    private static List<string> Tokenize(string input)
    {
        List<string> tokens = [];
        int i = 0;
        while (i < input.Length)
        {
            while (i < input.Length && char.IsWhiteSpace(input[i]))
                i++;
            if (i >= input.Length)
                break;

            int start = i;
            if ((input[i] is '#' or '@') && i + 1 < input.Length && input[i + 1] == '"')
            {
                i += 2;
                while (i < input.Length && input[i] != '"')
                    i++;
                if (i < input.Length)
                    i++;
                tokens.Add(input[start..i]);
                continue;
            }

            while (i < input.Length && !char.IsWhiteSpace(input[i]))
                i++;
            tokens.Add(input[start..i]);
        }
        return tokens;
    }
}
