using System.Text.Json;

namespace TaskNotes.Windows.Host;

public sealed partial class FacetTaskNotesStore
{
    /// <summary>Complete the exact rendered occurrence and reviewed revision, even if the query changes while queued.</summary>
    public Task SetRowCompletionAsync(
        TaskItem row,
        bool completed,
        CancellationToken cancellationToken = default
    ) =>
        SubmitRowsAsync(
            [row],
            basis => FacetRowCommands.Completion(basis.Single(), completed),
            true,
            cancellationToken
        );

    /// <summary>Freeze each row and reject multiple occurrences of one note before admission; core batches require distinct files.</summary>
    public Task CompleteRowsAsync(
        IReadOnlyList<TaskItem> rows,
        CancellationToken cancellationToken = default
    ) => SubmitRowsAsync(rows, FacetRowCommands.CompletionBatch, true, cancellationToken);

    /// <summary>Status changes retain the rendered occurrence and its reviewed revision.</summary>
    public Task SetRowStatusAsync(
        TaskItem row,
        string status,
        CancellationToken cancellationToken = default
    ) =>
        SubmitRowsAsync(
            [row],
            basis => new
            {
                kind = "set_status",
                path = basis[0].Path,
                expectedRevision = basis[0].Revision,
                occurrenceDate = basis[0].Occurrence,
                status,
            },
            false,
            cancellationToken
        );

    /// <summary>Scheduling edits each underlying note once, explicitly deduplicating selected occurrences.</summary>
    public Task ScheduleRowsAsync(
        IReadOnlyList<TaskItem> rows,
        string? scheduled,
        CancellationToken cancellationToken = default
    ) =>
        SubmitRowsAsync(
            rows,
            basis => FacetRowCommands.Properties(basis, new { scheduled }),
            false,
            cancellationToken
        );

    /// <summary>Priority is note-scoped while its revision and vault remain frozen.</summary>
    public Task PrioritizeRowsAsync(
        IReadOnlyList<TaskItem> rows,
        string priority,
        CancellationToken cancellationToken = default
    ) =>
        SubmitRowsAsync(
            rows,
            basis => FacetRowCommands.Properties(basis, new { priority }),
            false,
            cancellationToken
        );

    /// <summary>Delete each reviewed note once; selected occurrences never become another note's action.</summary>
    public Task DeleteRowsAsync(
        IReadOnlyList<TaskItem> rows,
        CancellationToken cancellationToken = default
    ) =>
        SubmitRowsAsync(
            rows,
            basis => new
            {
                kind = "batch",
                commands = FacetRowCommands
                    .Notes(basis)
                    .Select(row => new
                    {
                        kind = "delete",
                        path = row.Path,
                        expectedRevision = row.Revision,
                    })
                    .ToArray(),
            },
            false,
            cancellationToken
        );

    private Task<JsonElement> SubmitRowsAsync(
        IReadOnlyList<TaskItem> rows,
        Func<IReadOnlyList<FacetRowCommands.Basis>, object> command,
        bool completion,
        CancellationToken cancellationToken
    )
    {
        // Freeze synchronously, before SerializedAsync's first queue wait. Nothing below
        // resolves IDs through the mutable _tasks projection or current query again.
        var basis = FacetRowCommands.Freeze(rows);
        string profile = basis[0].Profile;
        JsonElement frozen = JsonSerializer.SerializeToElement(command(basis));
        return SerializedAsync(
            () =>
            {
                if (SelectedProfileId != profile)
                    throw new ArgumentException(
                        "The rendered rows belong to another vault. Return to their owning vault before submitting them."
                    );
                return MutateAsync(frozen, completion, cancellationToken);
            },
            cancellationToken
        );
    }
}

/// <summary>Presentation identity is converted to existing core commands without interpreting recurrence.</summary>
internal static class FacetRowCommands
{
    internal sealed record Basis(string Profile, string Path, string Revision, string? Occurrence);

    internal static Basis[] Freeze(IReadOnlyList<TaskItem> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (rows.Count == 0)
            throw new ArgumentException("Select at least one task row.", nameof(rows));
        var basis = rows.Select(row => new Basis(
                row.ProfileId
                    ?? throw new ArgumentException(
                        "The task row has no owning vault.",
                        nameof(rows)
                    ),
                row.VaultPath
                    ?? throw new ArgumentException(
                        "The task row has no reviewed vault path.",
                        nameof(rows)
                    ),
                row.ExpectedRevision
                    ?? throw new ArgumentException(
                        "The task row has no reviewed revision.",
                        nameof(rows)
                    ),
                row.OccurrenceDate
            ))
            .Distinct()
            .ToArray();
        if (basis.Any(row => row.Profile != basis[0].Profile))
            throw new ArgumentException("Select rows from one owning vault.", nameof(rows));
        return basis;
    }

    internal static object Completion(Basis row, bool completed) =>
        new
        {
            kind = "set_completion",
            path = row.Path,
            expectedRevision = row.Revision,
            occurrenceDate = row.Occurrence,
            completed,
        };

    internal static object CompletionBatch(IReadOnlyList<Basis> rows)
    {
        if (rows.GroupBy(row => (row.Profile, row.Path)).Any(group => group.Count() > 1))
            throw new ArgumentException(
                "Complete these recurring occurrences separately. A bulk completion can contain only one occurrence of each note.",
                nameof(rows)
            );
        return new
        {
            kind = "batch",
            commands = rows.Select(row => Completion(row, true)).ToArray(),
        };
    }

    internal static Basis[] Notes(IReadOnlyList<Basis> rows) =>
        rows.GroupBy(row => (row.Profile, row.Path))
            .Select(group =>
            {
                if (group.Select(row => row.Revision).Distinct(StringComparer.Ordinal).Count() != 1)
                    throw new ArgumentException(
                        "Selected occurrences contain different reviewed revisions of the same note.",
                        nameof(rows)
                    );
                return group.First();
            })
            .ToArray();

    internal static object Properties(IReadOnlyList<Basis> rows, object properties) =>
        new
        {
            kind = "batch",
            commands = Notes(rows)
                .Select(row => new
                {
                    kind = "update",
                    path = row.Path,
                    expectedRevision = row.Revision,
                    properties,
                })
                .ToArray(),
        };
}
