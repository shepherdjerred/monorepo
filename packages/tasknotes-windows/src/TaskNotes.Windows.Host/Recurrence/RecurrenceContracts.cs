namespace TaskNotes.Windows.Host;

/// <summary>The frequency choices available to native repeat controls.</summary>
public enum RecurrenceFrequency
{
    /// <summary>Every number of days.</summary>
    Daily,

    /// <summary>Every number of weeks.</summary>
    Weekly,

    /// <summary>Every number of months.</summary>
    Monthly,

    /// <summary>Every number of years.</summary>
    Yearly,
}

/// <summary>An ordinal weekday choice supplied by the Rust common projection.</summary>
public enum RecurrenceOrdinal
{
    /// <summary>The first matching weekday.</summary>
    First,

    /// <summary>The second matching weekday.</summary>
    Second,

    /// <summary>The third matching weekday.</summary>
    Third,

    /// <summary>The fourth matching weekday.</summary>
    Fourth,

    /// <summary>The fifth matching weekday.</summary>
    Fifth,

    /// <summary>The last matching weekday.</summary>
    Last,
}

/// <summary>Typed common calendar selectors; only Rust parses or builds their rules.</summary>
public abstract record RecurrencePattern
{
    /// <summary>A daily pattern.</summary>
    public sealed record Daily : RecurrencePattern;

    /// <summary>A weekly pattern retaining every selected weekday.</summary>
    public sealed record Weekly(IReadOnlyList<DayOfWeek> Weekdays) : RecurrencePattern;

    /// <summary>A numbered day in each selected month.</summary>
    public sealed record MonthlyDayOfMonth(byte Day) : RecurrencePattern;

    /// <summary>An ordinal weekday in each selected month.</summary>
    public sealed record MonthlyOrdinalWeekday(RecurrenceOrdinal Ordinal, DayOfWeek Weekday)
        : RecurrencePattern;

    /// <summary>An explicit month and day in each selected year.</summary>
    public sealed record YearlyMonthDay(byte Month, byte Day) : RecurrencePattern;
}

/// <summary>The complete common ending condition supplied to Rust.</summary>
public abstract record RecurrenceEnd
{
    /// <summary>No declared end.</summary>
    public sealed record Never : RecurrenceEnd;

    /// <summary>An inclusive ISO civil date.</summary>
    public sealed record OnDate(string Date) : RecurrenceEnd;

    /// <summary>A total occurrence count.</summary>
    public sealed record AfterOccurrences(uint Count) : RecurrenceEnd;
}

/// <summary>A portable lossless view of the Rust common recurrence draft.</summary>
public sealed record RecurrenceDraft(
    uint Interval,
    RecurrencePattern Pattern,
    RecurrenceEnd Ending
);

/// <summary>A resolved anchor and optional lossless common draft; null retains authoritative raw text.</summary>
public sealed record RecurrenceProjection(string Start, RecurrenceDraft? Draft);

/// <summary>Off-thread Rust operations for native repeat controls.</summary>
public interface IRecurrenceEditor
{
    /// <summary>Resolves the anchor and asks Rust whether a stored rule has a lossless common projection.</summary>
    Task<RecurrenceProjection> ProjectAsync(
        string rule,
        string? scheduled,
        string? dateCreated,
        string today,
        CancellationToken cancellationToken = default
    );

    /// <summary>Asks Rust for the selected frequency's defaults at a resolved anchor.</summary>
    Task<RecurrencePattern> PatternAsync(
        RecurrenceFrequency frequency,
        string start,
        CancellationToken cancellationToken = default
    );

    /// <summary>Asks Rust to validate and serialize the complete edited common draft.</summary>
    Task<string> BuildAsync(
        RecurrenceDraft draft,
        string start,
        CancellationToken cancellationToken = default
    );
}
