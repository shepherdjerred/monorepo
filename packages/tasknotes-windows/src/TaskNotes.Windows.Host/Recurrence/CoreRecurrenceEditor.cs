using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Runs pure common-recurrence APIs on an owned native worker, independently of vault selection.</summary>
public sealed class CoreRecurrenceEditor : IRecurrenceEditor
{
    /// <summary>A stateless shared adapter; each operation drains and disposes its own native worker.</summary>
    public static IRecurrenceEditor Shared { get; } = new CoreRecurrenceEditor();

    /// <inheritdoc />
    public Task<RecurrenceProjection> ProjectAsync(
        string rule,
        string? scheduled,
        string? dateCreated,
        string today,
        CancellationToken cancellationToken = default
    ) =>
        RunAsync(
            () =>
            {
                // Rust's empty-rule model intentionally has no DTSTART. The fixed Daily
                // probe asks it to resolve the anchor for a newly selected repeat instead.
                string probe = rule.Length == 0 ? "FREQ=DAILY" : rule;
                string? resolved = Core.TaskNotesCoreMethods.RecurrenceResolvedStart(
                    probe,
                    scheduled,
                    dateCreated
                );
                string start = resolved ?? today;
                bool newWithoutAnchor =
                    rule.Length == 0
                    && string.IsNullOrEmpty(scheduled)
                    && string.IsNullOrEmpty(dateCreated);
                // Missing anchors can use the caller's day for a genuinely new rule only.
                // An unreadable provided anchor or an unresolved existing rule stays raw.
                Core.CommonRecurrenceDraft? draft =
                    resolved is not null || newWithoutAnchor
                        ? Core.TaskNotesCoreMethods.RecurrenceParseCommon(probe, start)
                        : null;
                return new RecurrenceProjection(
                    start,
                    draft is null ? null : RecurrenceMapping.FromCore(draft)
                );
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task<RecurrencePattern> PatternAsync(
        RecurrenceFrequency frequency,
        string start,
        CancellationToken cancellationToken = default
    ) =>
        RunAsync(
            () =>
            {
                // These complete fixed probes ask Rust to resolve calendar defaults. They are
                // never persisted; every edited rule comes exclusively from RecurrenceBuildCommon.
                string probe = frequency switch
                {
                    RecurrenceFrequency.Daily => "FREQ=DAILY",
                    RecurrenceFrequency.Weekly => "FREQ=WEEKLY",
                    RecurrenceFrequency.Monthly => "FREQ=MONTHLY",
                    RecurrenceFrequency.Yearly => "FREQ=YEARLY",
                    _ => throw new ArgumentOutOfRangeException(nameof(frequency)),
                };
                Core.CommonRecurrenceDraft draft =
                    Core.TaskNotesCoreMethods.RecurrenceParseCommon(probe, start)
                    ?? throw new InvalidOperationException(
                        "The core rejected a supported common recurrence pattern."
                    );
                return RecurrenceMapping.FromCore(draft).Pattern;
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task<string> BuildAsync(
        RecurrenceDraft draft,
        string start,
        CancellationToken cancellationToken = default
    ) =>
        RunAsync(
            () =>
                Core.TaskNotesCoreMethods.RecurrenceBuildCommon(
                    RecurrenceMapping.ToCore(draft),
                    start
                ),
            cancellationToken
        );

    private static async Task<T> RunAsync<T>(Func<T> operation, CancellationToken cancellationToken)
    {
        EngineRunner runner = new();
        await using (runner.ConfigureAwait(false))
        {
            return await runner.RunAsync(operation, cancellationToken).ConfigureAwait(false);
        }
    }
}
