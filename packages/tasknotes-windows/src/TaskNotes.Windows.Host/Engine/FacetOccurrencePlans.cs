using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>A durable core-authored generation outcome survives removal of its original primary envelope.</summary>
public sealed record FacetGenerationFailure(
    string ProfileId,
    string PrimaryMutationId,
    string SuccessorId,
    string ParentPath,
    string Kind,
    string State,
    string? FailureCode,
    string? FailureMessage,
    string? UnrepairableReason
)
{
    internal JsonElement? RepairCommand { get; init; }

    /// <summary>Repair uses a fresh core-authored command and revision fences.</summary>
    public bool CanRepair => RepairCommand is not null;

    /// <summary>Native presentation distinguishes pending, failed and nonrepairable outcomes without parsing prose.</summary>
    public string Status =>
        UnrepairableReason is not null
            ? UnrepairableReason switch
            {
                "parent_missing" => "The series note is missing.",
                "invalid_current_parent" => "Correct the series note before repairing.",
                "child_missing" => "The completed occurrence is missing.",
                "changed_or_ambiguous_identity" =>
                    "The occurrence identity changed. Review its notes.",
                "child_state_changed" => "The occurrence state changed. Review its note.",
                _ => throw new InvalidDataException("Unknown generation repair reason."),
            }
            : State switch
            {
                "pending" or "staged" => "Generation pending",
                "failed" => "Generation needs repair",
                "cancelled" => "Generation cancelled",
                "applied" => "Generation applied",
                _ => throw new InvalidDataException("Unknown generation state."),
            };
}

/// <summary>A typed series discovery problem; the native UI does not parse file-error messages.</summary>
public sealed record FacetOccurrenceProblem(string ProfileId, string TaskPath, string Code)
{
    /// <summary>Fixed user-facing copy for the closed native problem family.</summary>
    public string Summary =>
        Code switch
        {
            "cached_task_problem" or "invalid_occurrence_identity" =>
                "Review this series note and its occurrence identity.",
            "invalid_occurrence_policy"
            or "invalid_recurrence_rule"
            or "invalid_recurrence_anchor"
            or "invalid_recurrence_start"
            or "missing_recurrence_seed"
            or "materialization_requires_valid_seeded_parent" =>
                "Correct this series' repeat settings before generating occurrences.",
            "invalid_occurrence_horizon"
            or "negative_occurrence_horizon"
            or "occurrence_window_overflow"
            or "occurrence_window_resource_limit" =>
                "Choose a smaller valid generation window for this series.",
            _ => throw new InvalidDataException("Unknown occurrence discovery problem."),
        };
}

internal sealed record FacetRollingPlan(
    ulong Version,
    IReadOnlyList<JsonElement> Targets,
    IReadOnlyList<JsonElement> Problems
);

internal sealed class FacetOccurrenceNotReadyException : Exception
{
    internal FacetOccurrenceNotReadyException()
        : base("Occurrence generation is waiting for vault configuration and initial Sync.") { }
}

/// <summary>Reads all closed, version-fenced pages before a host may present or execute a generation decision.</summary>
internal static class FacetOccurrencePlans
{
    internal static async Task<FacetRollingPlan> MaintenanceAsync(
        string profile,
        string referenceDate,
        Func<string, CancellationToken, Task<string>> read,
        CancellationToken cancellation
    )
    {
        var pages = await PagesAsync(
                profile,
                "rolling_maintenance_plan",
                "rollingMaintenancePlan",
                new Dictionary<string, object> { ["referenceDate"] = referenceDate },
                read,
                cancellation
            )
            .ConfigureAwait(false);
        List<JsonElement> targets = [];
        List<JsonElement> problems = [];
        HashSet<string> parents = new(StringComparer.Ordinal);
        foreach (var page in pages)
        {
            if (page.GetProperty("referenceDate").GetString() != referenceDate)
                throw new InvalidDataException(
                    "The maintenance reference date changed while paging."
                );
            foreach (var target in page.GetProperty("targets").EnumerateArray())
            {
                if (
                    target.GetProperty("referenceDate").GetString() != referenceDate
                    || !parents.Add(target.GetProperty("parentPath").GetString()!)
                )
                    throw new InvalidDataException(
                        "A maintenance target changed owner/date or repeated its parent."
                    );
                targets.Add(target.Clone());
            }
            problems.AddRange(
                page.GetProperty("problems").EnumerateArray().Select(value => value.Clone())
            );
        }
        return new(pages[0].GetProperty("version").GetUInt64(), targets, problems);
    }

    internal static async Task<IReadOnlyList<FacetGenerationFailure>> FailuresAsync(
        string profile,
        Func<string, CancellationToken, Task<string>> read,
        CancellationToken cancellation
    )
    {
        var pages = await PagesAsync(
                profile,
                "occurrence_generation_failures",
                "generationFailuresPlan",
                [],
                read,
                cancellation
            )
            .ConfigureAwait(false);
        List<FacetGenerationFailure> rows = [];
        HashSet<(string Primary, string Successor)> identities = [];
        foreach (var page in pages)
        foreach (var row in page.GetProperty("items").EnumerateArray())
        {
            var item = row.GetProperty("item");
            string primary = row.GetProperty("primaryMutationId").GetString()!;
            string successor = item.GetProperty("successorId").GetString()!;
            if (!identities.Add((primary, successor)))
                throw new InvalidDataException(
                    "Generation failure paging repeated an owned outcome."
                );
            var action = row.GetProperty("action");
            var failure = item.GetProperty("failure");
            rows.Add(
                new(
                    profile,
                    primary,
                    successor,
                    item.GetProperty("parentPath").GetString()!,
                    item.GetProperty("kind").GetString()!,
                    item.GetProperty("state").GetString()!,
                    failure.ValueKind == JsonValueKind.Null
                        ? null
                        : failure.GetProperty("code").GetString(),
                    failure.ValueKind == JsonValueKind.Null
                        ? null
                        : failure.GetProperty("message").GetString(),
                    action.GetProperty("kind").GetString() == "unrepairable"
                        ? action.GetProperty("reason").GetString()
                        : null
                )
                {
                    RepairCommand =
                        action.GetProperty("kind").GetString() == "repairable"
                            ? action.GetProperty("command").Clone()
                            : null,
                }
            );
        }
        return rows;
    }

    private static async Task<IReadOnlyList<JsonElement>> PagesAsync(
        string profile,
        string kind,
        string definition,
        Dictionary<string, object> fields,
        Func<string, CancellationToken, Task<string>> read,
        CancellationToken cancellation
    )
    {
        var schema = FacetSchema.Bundled();
        List<JsonElement> pages = [];
        HashSet<string> cursors = new(StringComparer.Ordinal);
        JsonElement? after = null;
        ulong? version = null;
        string? binding = null;
        do
        {
            var request = new Dictionary<string, object>(fields, StringComparer.Ordinal)
            {
                ["schemaVersion"] = 1,
                ["kind"] = kind,
                ["limit"] = 128,
            };
            if (after is JsonElement cursor)
            {
                request.Add("after", cursor);
                request.Add("expectedVersion", version!.Value);
            }
            string json = JsonSerializer.Serialize(request);
            schema.Validate(json, "featureRequest");
            string raw = await read(json, cancellation).ConfigureAwait(false);
            schema.Validate(raw, definition);
            using var document = JsonDocument.Parse(raw);
            var page = document.RootElement;
            ulong current = page.GetProperty("version").GetUInt64();
            if (
                page.GetProperty("profileId").GetString() != profile
                || version is not null && version != current
            )
                throw new InvalidDataException(
                    "The occurrence plan changed profile/version while paging."
                );
            version = current;
            pages.Add(page.Clone());
            var next = page.GetProperty("nextCursor");
            after = next.ValueKind == JsonValueKind.Null ? null : next.Clone();
            if (after is JsonElement nextCursor)
            {
                string currentBinding = nextCursor.GetProperty("binding").GetString()!;
                if (binding is not null && binding != currentBinding)
                    throw new InvalidDataException(
                        "The occurrence plan cursor changed its query binding."
                    );
                binding = currentBinding;
                string key = nextCursor
                    .GetProperty(kind == "rolling_maintenance_plan" ? "lastPath" : "lastId")
                    .GetString()!;
                if (
                    page.GetProperty("inspectedCount").GetUInt32() == 0
                    || nextCursor.GetProperty("version").GetUInt64() != current
                    || !cursors.Add(key)
                )
                    throw new InvalidDataException(
                        "The occurrence plan cursor did not advance at its version fence."
                    );
                if (
                    kind == "rolling_maintenance_plan"
                    && nextCursor.GetProperty("referenceDate").GetString()
                        != fields["referenceDate"].ToString()
                )
                    throw new InvalidDataException(
                        "The maintenance cursor changed its reference date."
                    );
            }
        } while (after is not null);
        return pages;
    }
}
