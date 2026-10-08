using System.Globalization;
using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>A core-authored firing; hosts perform no date, offset or recurrence calculation.</summary>
public sealed record FacetReminder(
    string NotificationId,
    string TaskPath,
    string Title,
    string TaskRevision,
    string ReminderId,
    DateTimeOffset FireAt,
    string? OccurrenceDate,
    string? Description
);

/// <summary>A complete, version-fenced schedule for one owning vault.</summary>
public sealed record FacetReminderPlan(
    string ProfileId,
    ulong Version,
    IReadOnlyList<FacetReminder> Reminders,
    ulong ProblemCount,
    IReadOnlyList<JsonElement> Problems
);

/// <summary>A profile cannot currently project reminders; an existing OS schedule must be retained.</summary>
public sealed class FacetReminderUnavailableException : Exception
{
    /// <summary>Preserves the typed provider/configuration failure for diagnostics.</summary>
    public FacetReminderUnavailableException(string message, Exception innerException)
        : base(message, innerException) { }
}

/// <summary>Collects every metadata page before the OS may replace a profile's schedule.</summary>
internal static class FacetReminderPlanReader
{
    internal static async Task<FacetReminderPlan> ReadAsync(
        string profileId,
        DateTimeOffset at,
        string timezone,
        DateTimeOffset from,
        DateTimeOffset to,
        Func<string, CancellationToken, Task<string>> read,
        CancellationToken cancellationToken
    )
    {
        List<FacetReminder> rows = [];
        List<JsonElement> problems = [];
        HashSet<string> identities = new(StringComparer.Ordinal);
        HashSet<string> cursors = new(StringComparer.Ordinal);
        JsonElement? after = null;
        ulong? version = null;
        ulong? total = null;
        ulong? problemCount = null;
        var schema = FacetSchema.Bundled();
        do
        {
            Dictionary<string, object> request = new(StringComparer.Ordinal)
            {
                ["schemaVersion"] = 1,
                ["kind"] = "reminder_plan",
                ["at"] = at.ToString("O", CultureInfo.InvariantCulture),
                ["timezone"] = timezone,
                ["from"] = from.ToString("O", CultureInfo.InvariantCulture),
                ["to"] = to.ToString("O", CultureInfo.InvariantCulture),
                ["limit"] = 128,
            };
            if (after is JsonElement cursor)
            {
                request.Add("after", cursor);
                request.Add("expectedVersion", version!.Value);
            }
            string requestDocument = JsonSerializer.Serialize(request);
            schema.Validate(requestDocument, "reminderRequest");
            string document = await read(requestDocument, cancellationToken).ConfigureAwait(false);
            schema.Validate(document, "reminderPlan");
            using var page = JsonDocument.Parse(document);
            JsonElement root = page.RootElement;
            ulong pageVersion = root.GetProperty("version").GetUInt64();
            ulong pageTotal = root.GetProperty("totalCount").GetUInt64();
            ulong pageProblems = root.GetProperty("problemCount").GetUInt64();
            if (
                root.GetProperty("profileId").GetString() != profileId
                || (version is not null && version != pageVersion)
                || (total is not null && total != pageTotal)
                || (problemCount is not null && problemCount != pageProblems)
            )
                throw new InvalidDataException("The reminder plan changed while paging.");
            version = pageVersion;
            total = pageTotal;
            if (problemCount is null)
                problems.AddRange(
                    root.GetProperty("problems").EnumerateArray().Select(p => p.Clone())
                );
            problemCount = pageProblems;
            int pageRows = 0;
            foreach (var row in root.GetProperty("rows").EnumerateArray())
            {
                string identity = row.GetProperty("notificationId").GetString()!;
                if (!identities.Add(identity))
                    throw new InvalidDataException(
                        "The reminder plan repeats a notification identity."
                    );
                rows.Add(
                    new FacetReminder(
                        identity,
                        row.GetProperty("taskPath").GetString()!,
                        row.GetProperty("title").GetString()!,
                        row.GetProperty("taskRevision").GetString()!,
                        row.GetProperty("reminderId").GetString()!,
                        row.GetProperty("fireAt").GetDateTimeOffset(),
                        NullableString(row, "occurrenceDate"),
                        NullableString(row, "description")
                    )
                );
                pageRows++;
            }
            JsonElement next = root.GetProperty("nextCursor");
            if (next.ValueKind == JsonValueKind.Null)
                after = null;
            else
            {
                if (pageRows == 0 || !cursors.Add(next.GetRawText()))
                    throw new InvalidDataException("The reminder plan cursor did not advance.");
                FacetReminder last = rows[^1];
                if (
                    next.GetProperty("fireAt").GetDateTimeOffset() != last.FireAt
                    || next.GetProperty("reminderId").GetString() != last.ReminderId
                    || next.GetProperty("taskPath").GetString() != last.TaskPath
                )
                    throw new InvalidDataException(
                        "The reminder cursor does not identify the page boundary."
                    );
                after = next.Clone();
            }
        } while (after is not null);
        if ((ulong)rows.Count != total)
            throw new InvalidDataException("The reminder plan is incomplete.");
        return new FacetReminderPlan(
            profileId,
            version!.Value,
            rows,
            problemCount!.Value,
            problems
        );
    }

    private static string? NullableString(JsonElement document, string key) =>
        document.GetProperty(key).ValueKind == JsonValueKind.Null
            ? null
            : document.GetProperty(key).GetString();
}
