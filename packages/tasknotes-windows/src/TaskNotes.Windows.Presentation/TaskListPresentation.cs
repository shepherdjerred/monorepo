using System.Globalization;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>A collection-view group preserves the core's row order and membership.</summary>
public sealed class TaskRowGroup : List<TaskRowPresentation>
{
    /// <summary>Initialize a group without reimplementing domain grouping.</summary>
    public TaskRowGroup(string label, IEnumerable<TaskRowPresentation> rows)
        : base(rows) => Label = label;

    /// <summary>Configured display label, distinct from a workflow wire value.</summary>
    public string Label { get; }

    /// <summary>Accessible header including the visible count.</summary>
    public string Header => string.IsNullOrEmpty(Label) ? string.Empty : $"{Label} · {Count}";
}

/// <summary>Compact desktop row decoration; mutation identity remains the immutable core projection.</summary>
public sealed class TaskRowPresentation
{
    /// <summary>Initialize using the exact query scope and one shared civil day.</summary>
    public TaskRowPresentation(TaskItem task, TaskListQuery query, DateOnly today)
    {
        Task = task;
        Metadata = string.Join(
            " · ",
            task.Projects.Where(value =>
                    !(query.Kind == TaskListKind.Project && value == query.Scope)
                )
                .Concat(
                    task.Contexts.Where(value =>
                            !(query.Kind == TaskListKind.Context && value == query.Scope)
                        )
                        .Select(value => $"@{value}")
                )
                .Concat(
                    task.Tags.Where(value =>
                            !(query.Kind == TaskListKind.Tag && value == query.Scope)
                        )
                        .Select(value => $"#{value}")
                )
        );
        string raw = task.DateLabel;
        if (
            DateOnly.TryParseExact(
                raw,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var date
            )
        )
            Date =
                date == today ? "Today"
                : date == today.AddDays(1) ? "Tomorrow"
                : date.ToString("MMM d", CultureInfo.CurrentCulture);
        else
            Date = raw; // Timestamp/unknown display values stay visible rather than silently changing meaning.
        var sources = new[]
        {
            (Value: task.OccurrenceDate, Name: "Occurrence"),
            (Value: task.Due, Name: "Due"),
            (Value: task.Scheduled, Name: "Scheduled"),
        };
        var matches = sources.Where(value => value.Value == raw).ToArray();
        // The core record exposes the effective civil date, not its provenance.
        // Coincident dates or offset timestamps cannot prove which input supplied it.
        string source =
            matches.Length == 1
            && !sources.Any(value => value.Value?.Contains('T', StringComparison.Ordinal) == true)
                ? matches[0].Name
                : "Date";
        DateDescription = raw.Length == 0 ? string.Empty : $"{source} {raw}";
    }

    /// <summary>Immutable mutation owner and revision.</summary>
    public TaskItem Task { get; }

    /// <summary>Scope-specific trailing metadata.</summary>
    public string Metadata { get; }

    /// <summary>Localized date column, retaining the core-selected date source.</summary>
    public string Date { get; }

    /// <summary>Date source and exact stored value for accessibility and tooltips.</summary>
    public string DateDescription { get; }

    /// <summary>A visible recurrence marker; it never carries pending-sync semantics.</summary>
    public string RecurrenceMark => Task.IsRecurring ? "↻" : string.Empty;

    /// <summary>Configured priority, rather than guessed enum colors.</summary>
    public string Priority => Task.PriorityLabel;

    /// <summary>Unsupported colors produce a per-choice diagnostic without removing tasks or actions.</summary>
    public string ColorWarning =>
        string.Join(
            "\n",
            new[]
            {
                ConfiguredColor.Diagnostic(Task.StatusColor),
                ConfiguredColor.Diagnostic(Task.PriorityColor),
            }.Where(value => value.Length > 0)
        );

    /// <summary>Full row description accompanies compact truncated text.</summary>
    public string AccessibleLabel =>
        string.Join(
            ", ",
            new[]
            {
                Task.Title,
                Task.StatusLabel,
                Task.PriorityLabel,
                Task.IsRecurring ? "Repeats" : string.Empty,
                DateDescription,
                Metadata,
                Task.PendingLabel,
                ColorWarning,
            }.Where(value => value.Length > 0)
        );
}
