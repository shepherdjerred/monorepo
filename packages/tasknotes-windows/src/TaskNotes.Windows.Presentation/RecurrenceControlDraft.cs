using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>Maps Rust-projected recurrence data to the simple native repeat controls without parsing rule text.</summary>
public sealed class RecurrenceControlDraft
{
    private readonly string? _raw;
    private readonly RecurrenceProjection _projection;

    private RecurrenceControlDraft(string? raw, RecurrenceProjection projection)
    {
        _raw = raw;
        _projection = projection;
        Frequency = string.IsNullOrEmpty(raw) ? null : FrequencyOf(projection.Draft?.Pattern);
        Interval = projection.Draft?.Interval ?? 1;
        Days = projection.Draft?.Pattern is RecurrencePattern.Weekly weekly
            ? weekly.Weekdays.ToArray()
            : [];
    }

    /// <summary>Whether this UI can represent the core projection and interval range.</summary>
    public bool CanEdit =>
        _projection.Draft is { Interval: >= 1 and <= 999 } draft
        && draft.Pattern is not RecurrencePattern.MonthlyOrdinalWeekday;

    /// <summary>The selected frequency, or no recurrence for a blank source.</summary>
    public RecurrenceFrequency? Frequency { get; }

    /// <summary>The projected interval.</summary>
    public uint Interval { get; }

    /// <summary>The projected weekly selections.</summary>
    public IReadOnlyList<DayOfWeek> Days { get; }

    /// <summary>Retains exact source text alongside the authoritative Rust projection.</summary>
    public static RecurrenceControlDraft FromProjection(
        string? raw,
        RecurrenceProjection projection
    )
    {
        ArgumentNullException.ThrowIfNull(projection);
        return new(raw, projection);
    }

    /// <summary>Returns unchanged bytes or asks Rust to build the explicit typed edit.</summary>
    public async Task<string?> ApplyAsync(
        IRecurrenceEditor editor,
        RecurrenceFrequency? frequency,
        double interval,
        IEnumerable<DayOfWeek> selectedDays,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(editor);
        if (!CanEdit)
            throw new ArgumentException(
                "Edit the full recurrence below, or clear it before choosing a new repeat schedule."
            );
        if (
            !double.IsFinite(interval)
            || interval is < 1 or > 999
            || Math.Truncate(interval) != interval
        )
            throw new ArgumentException("Choose a whole interval from one to 999.");
        if (frequency is null)
            return null;
        var original =
            _projection.Draft
            ?? throw new InvalidOperationException("Editable recurrence has no core draft.");
        DayOfWeek[] days = selectedDays.ToArray();
        if (
            !string.IsNullOrEmpty(_raw)
            && Frequency == frequency
            && Interval == interval
            && (frequency != RecurrenceFrequency.Weekly || Days.ToHashSet().SetEquals(days))
        )
            return _raw;
        RecurrencePattern pattern =
            FrequencyOf(original.Pattern) == frequency
                ? original.Pattern
                : await editor.PatternAsync(frequency.Value, _projection.Start, cancellationToken);
        if (frequency == RecurrenceFrequency.Weekly && (Frequency == frequency || days.Length > 0))
            pattern = new RecurrencePattern.Weekly(days);
        return await editor.BuildAsync(
            new RecurrenceDraft(checked((uint)interval), pattern, original.Ending),
            _projection.Start,
            cancellationToken
        );
    }

    private static RecurrenceFrequency? FrequencyOf(RecurrencePattern? pattern) =>
        pattern switch
        {
            null => null,
            RecurrencePattern.Daily => RecurrenceFrequency.Daily,
            RecurrencePattern.Weekly => RecurrenceFrequency.Weekly,
            RecurrencePattern.MonthlyDayOfMonth or RecurrencePattern.MonthlyOrdinalWeekday =>
                RecurrenceFrequency.Monthly,
            RecurrencePattern.YearlyMonthDay => RecurrenceFrequency.Yearly,
            _ => throw new ArgumentOutOfRangeException(nameof(pattern)),
        };
}
