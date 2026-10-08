using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TaskNotes.Windows.Host;

/// <summary>A tracking read belongs to one original snapshot, clock and presentation request.</summary>
public sealed record FacetTrackingOwner(
    string ProfileId,
    ulong Version,
    string At,
    long RequestGeneration,
    long EngineGeneration,
    string? TaskPath = null,
    string? TaskRevision = null
);

/// <summary>A bounded continuation retains its original owner and observed lineage.</summary>
public sealed record FacetTrackingContinuation(
    FacetTrackingOwner Owner,
    JsonElement Cursor,
    ulong SeenCount,
    ulong TotalCount,
    ulong ProblemCount,
    string ProblemsFingerprint
);

/// <summary>One bounded page, with an optional owner-qualified continuation.</summary>
public sealed record FacetTrackingPage(
    FacetTrackingOwner Owner,
    IReadOnlyList<JsonElement> Rows,
    ulong TotalCount,
    ulong ProblemCount,
    FacetTrackingContinuation? Next
);

/// <summary>Legacy task-time aggregates computed without retaining all history rows.</summary>
public sealed record FacetTrackingTotals(ulong TotalMinutes, bool HasActiveSession);

/// <summary>Validates shared pages and original ownership before native presentation.</summary>
public static class FacetTrackingReader
{
    private static readonly Regex InstantParts = new(
        "^(?<whole>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.(?<fraction>[0-9]{1,9}))?(?<offset>Z|[+-][0-9]{2}:[0-9]{2})$",
        RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1)
    );

    /// <summary>Read and validate a single page; a foreign continuation never reaches native code.</summary>
    public static async Task<FacetTrackingPage> ReadPageAsync(
        FacetSchema schema,
        FacetTrackingOwner owner,
        FacetTrackingContinuation? continuation,
        Func<string, string, CancellationToken, Task<string>> fetch,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(schema);
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentNullException.ThrowIfNull(fetch);
        Require(continuation is null || continuation.Owner == owner);
        bool history = owner.TaskPath is not null;
        Require(!history || owner.TaskRevision is not null);
        var request = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["kind"] = history ? "tracking_history" : "tracking_sessions",
            ["at"] = owner.At,
            ["limit"] = 128,
            ["expectedVersion"] = owner.Version,
        };
        if (history)
            request["path"] = owner.TaskPath;
        if (continuation is not null)
            request["after"] = continuation.Cursor;
        string json = JsonSerializer.Serialize(request);
        schema.Validate(json, history ? "trackingHistoryRequest" : "trackingRequest");
        string response = await fetch(owner.ProfileId, json, cancellationToken)
            .ConfigureAwait(false);
        schema.Validate(response, history ? "trackingHistory" : "trackingSessions");
        using var document = JsonDocument.Parse(response);
        var page = document.RootElement;
        Require(page.GetProperty("profileId").GetString() == owner.ProfileId);
        Require(page.GetProperty("version").GetUInt64() == owner.Version);
        string at = page.GetProperty("at").GetString()!;
        Require(Instant(at) == Instant(owner.At));
        if (history)
        {
            Require(page.GetProperty("taskPath").GetString() == owner.TaskPath);
            Require(page.GetProperty("taskRevision").GetString() == owner.TaskRevision);
        }
        ulong total = page.GetProperty("totalCount").GetUInt64();
        ulong problemCount = page.GetProperty("problemCount").GetUInt64();
        var problems = page.GetProperty("problems").EnumerateArray().ToArray();
        Require((ulong)problems.Length == Math.Min(problemCount, 128UL));
        string fingerprint = JsonSerializer.Serialize(
            problems.Select(problem =>
                new[]
                {
                    problem.GetProperty("taskPath").GetString(),
                    problem.GetProperty("code").GetString(),
                }
            )
        );
        if (continuation is not null)
            Require(
                continuation.Cursor.GetProperty("at").GetString() == at
                    && continuation.TotalCount == total
                    && continuation.ProblemCount == problemCount
                    && continuation.ProblemsFingerprint == fingerprint
            );
        var rows = page.GetProperty("rows").EnumerateArray().Select(row => row.Clone()).ToArray();
        ulong before = continuation?.SeenCount ?? 0;
        ulong seen = checked(before + (ulong)rows.Length);
        Require(seen <= total);
        string? previousPath = history
            ? null
            : continuation?.Cursor.GetProperty("taskPath").GetString();
        HashSet<string> sessionIds = new(StringComparer.Ordinal);
        for (int index = 0; index < rows.Length; index++)
        {
            var row = rows[index];
            if (history)
            {
                Require(
                    row.GetProperty("entryIndex").GetUInt64() == checked(before + (ulong)index)
                );
                string? ended = row.GetProperty("endedAt").GetString();
                bool running = row.GetProperty("state").GetString() == "running";
                Require(running == (ended is null));
                Require(
                    ended is null
                        || Instant(ended) >= Instant(row.GetProperty("startedAt").GetString()!)
                );
                ValidateElapsed(row, ended ?? owner.At);
            }
            else
            {
                string path = row.GetProperty("taskPath").GetString()!;
                Require(previousPath is null || ComparePaths(previousPath, path) < 0);
                Require(sessionIds.Add(row.GetProperty("sessionId").GetString()!));
                previousPath = path;
                ValidateElapsed(row, owner.At);
            }
        }
        var next = page.GetProperty("nextCursor");
        if (next.ValueKind == JsonValueKind.Null)
        {
            Require(seen == total);
            return new(owner, rows, total, problemCount, null);
        }
        Require(rows.Length > 0 && seen < total && next.GetProperty("at").GetString() == at);
        var last = rows[^1];
        if (history)
            Require(
                next.GetProperty("entryIndex").GetUInt64()
                    == last.GetProperty("entryIndex").GetUInt64()
            );
        else
            Require(
                next.GetProperty("taskPath").GetString() == last.GetProperty("taskPath").GetString()
            );
        return new(
            owner,
            rows,
            total,
            problemCount,
            new(owner, next.Clone(), seen, total, problemCount, fingerprint)
        );
    }

    /// <summary>Stream every history page into checked rounded-minute and active aggregates.</summary>
    public static async Task<FacetTrackingTotals> ReadTotalsAsync(
        FacetSchema schema,
        FacetTrackingOwner owner,
        Func<string, string, CancellationToken, Task<string>> fetch,
        CancellationToken cancellationToken = default
    )
    {
        Require(owner.TaskPath is not null);
        FacetTrackingContinuation? continuation = null;
        ulong minutes = 0;
        int active = 0;
        do
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await ReadPageAsync(schema, owner, continuation, fetch, cancellationToken)
                .ConfigureAwait(false);
            if (page.ProblemCount != 0)
                throw new ArgumentException(
                    "Some tracking entries could not be read. Review this task's time entries."
                );
            foreach (var row in page.Rows)
            {
                string? ended = row.GetProperty("endedAt").GetString();
                if (ended is null)
                    Require(++active <= 1);
                ulong seconds = row.GetProperty("elapsedSeconds").GetUInt64();
                minutes = checked(minutes + checked(seconds + 30UL) / 60UL);
            }
            continuation = page.Next;
        } while (continuation is not null);
        return new(minutes, active != 0);
    }

    private static int ComparePaths(string left, string right) =>
        Encoding.UTF8.GetBytes(left).AsSpan().SequenceCompareTo(Encoding.UTF8.GetBytes(right));

    private static BigInteger Instant(string value)
    {
        var parts = InstantParts.Match(value);
        Require(parts.Success);
        // Parse only the whole second with DateTimeOffset: its tick precision must
        // never round a producer's eighth or ninth fractional digit.
        var whole = DateTimeOffset.Parse(
            parts.Groups["whole"].Value + parts.Groups["offset"].Value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind
        );
        string fractional = parts.Groups["fraction"].Value.PadRight(9, '0');
        return (BigInteger)whole.ToUnixTimeSeconds() * 1_000_000_000
            + BigInteger.Parse(fractional, CultureInfo.InvariantCulture);
    }

    private static void ValidateElapsed(JsonElement row, string ended)
    {
        BigInteger nanos = BigInteger.Max(
            BigInteger.Zero,
            Instant(ended) - Instant(row.GetProperty("startedAt").GetString()!)
        );
        Require(
            row.GetProperty("elapsedSeconds").GetUInt64() == checked((ulong)(nanos / 1_000_000_000))
        );
    }

    private static void Require(bool valid)
    {
        if (!valid)
            throw new InvalidDataException(
                "The tracking page has inconsistent ownership or lineage."
            );
    }
}
