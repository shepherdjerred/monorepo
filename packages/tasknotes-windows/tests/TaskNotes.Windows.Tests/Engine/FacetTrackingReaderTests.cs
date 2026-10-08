using System.Text.Json;
using System.Text.Json.Nodes;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Current producer SQLite captures prove bounded reading and exact legacy rounding.</summary>
[TestClass]
public sealed class FacetTrackingReaderTests
{
    private static readonly string[] UnicodePaths =
    [
        "Tasks/A.md",
        "Tasks/e\u0301.md",
        "Tasks/é.md",
        "Tasks/\uE000.md",
        "Tasks/\U00010000.md",
    ];

    /// <summary>All eight actual histories, including nanosecond boundaries, retain the original clock.</summary>
    [TestMethod]
    public async Task ActualCapturedHistoriesMatchLegacyTotals()
    {
        using var stream = typeof(FacetTrackingReaderTests).Assembly.GetManifestResourceStream(
            "TrackingCaptureV2.json"
        )!;
        using var capture = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.CancellationToken
        );
        foreach (var test in capture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var pages = test.GetProperty("historyPagesRaw")
                .EnumerateArray()
                .Select(page => page.GetString()!)
                .ToArray();
            using var first = JsonDocument.Parse(pages[0]);
            var owner = Owner(first.RootElement) with
            {
                At = first
                    .RootElement.GetProperty("at")
                    .GetString()!
                    .Replace("Z", "+00:00", StringComparison.Ordinal),
            };
            int calls = 0;
            Task<string> FetchAsync(string profile, string request, CancellationToken token)
            {
                Assert.AreEqual(owner.ProfileId, profile);
                using var wire = JsonDocument.Parse(request);
                Assert.AreEqual(owner.At, wire.RootElement.GetProperty("at").GetString());
                Assert.AreEqual(
                    owner.Version,
                    wire.RootElement.GetProperty("expectedVersion").GetUInt64()
                );
                return Task.FromResult(pages[calls++]);
            }
            var totals = await FacetTrackingReader.ReadTotalsAsync(
                FacetSchema.Bundled(),
                owner,
                FetchAsync,
                TestContext.CancellationToken
            );
            using var legacy = JsonDocument.Parse(test.GetProperty("taskTimeRaw").GetString()!);
            Assert.AreEqual(
                legacy.RootElement.GetProperty("totalMinutes").GetUInt64(),
                totals.TotalMinutes,
                test.GetProperty("id").GetString()
            );
            Assert.AreEqual(
                legacy.RootElement.GetProperty("hasActiveSession").GetBoolean(),
                totals.HasActiveSession
            );
            Assert.AreEqual(pages.Length, calls);
        }
    }

    /// <summary>Actual session pages retain bounded rows and owner-qualified continuation.</summary>
    [TestMethod]
    public async Task ActualSessionsAndForeignContinuation()
    {
        using var stream = typeof(FacetTrackingReaderTests).Assembly.GetManifestResourceStream(
            "TrackingCaptureV2.json"
        )!;
        using var capture = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.CancellationToken
        );
        var pages = capture
            .RootElement.GetProperty("sessionsPagesRaw")
            .EnumerateArray()
            .Select(page => page.GetString()!)
            .ToArray();
        using var first = JsonDocument.Parse(pages[0]);
        var owner = Owner(first.RootElement);
        int calls = 0;
        Task<string> FetchAsync(string profile, string request, CancellationToken token) =>
            Task.FromResult(pages[calls++]);
        var page = await FacetTrackingReader.ReadPageAsync(
            FacetSchema.Bundled(),
            owner,
            null,
            FetchAsync,
            TestContext.CancellationToken
        );
        Assert.HasCount(2, page.Rows);
        Assert.IsNotNull(page.Next);
        foreach (
            var stale in new[]
            {
                owner with
                {
                    ProfileId = "foreign",
                },
                owner with
                {
                    Version = 2,
                },
                owner with
                {
                    At = "2026-10-07T12:00:00.250000002Z",
                },
                owner with
                {
                    RequestGeneration = 8,
                },
                owner with
                {
                    EngineGeneration = 8,
                },
            }
        )
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
                FacetTrackingReader.ReadPageAsync(
                    FacetSchema.Bundled(),
                    stale,
                    page.Next,
                    FetchAsync,
                    TestContext.CancellationToken
                )
            );
        Assert.AreEqual(
            1,
            calls,
            "Foreign client continuation must be rejected before native invocation."
        );
        var final = await FacetTrackingReader.ReadPageAsync(
            FacetSchema.Bundled(),
            owner,
            page.Next,
            FetchAsync,
            TestContext.CancellationToken
        );
        Assert.HasCount(2, final.Rows);
        Assert.IsNull(final.Next);
        Assert.AreEqual(4UL, final.TotalCount);
    }

    /// <summary>Schema-valid producer inconsistencies fail loudly rather than display partial history.</summary>
    [TestMethod]
    public async Task RelationalCorruptionAndRawDuplicateKeysFail()
    {
        using var stream = typeof(FacetTrackingReaderTests).Assembly.GetManifestResourceStream(
            "TrackingCaptureV2.json"
        )!;
        using var capture = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.CancellationToken
        );
        string raw = capture
            .RootElement.GetProperty("cases")[0]
            .GetProperty("historyPagesRaw")[0]
            .GetString()!;
        using var original = JsonDocument.Parse(raw);
        var owner = Owner(original.RootElement);
        foreach (
            string field in new[]
            {
                "profileId",
                "version",
                "at",
                "taskPath",
                "taskRevision",
                "totalCount",
                "elapsed",
                "index",
                "empty",
                "unknown",
                "duplicate",
            }
        )
        {
            var node = JsonNode.Parse(raw)!;
            switch (field)
            {
                case "profileId":
                    node[field] = "foreign";
                    break;
                case "version":
                    node[field] = 2;
                    break;
                case "at":
                    node[field] = "2026-10-07T12:00:00.250000002Z";
                    break;
                case "taskPath":
                    node[field] = "Tasks/foreign.md";
                    break;
                case "taskRevision":
                    node[field] = new string('a', 64);
                    break;
                case "totalCount":
                    node[field] = 999;
                    break;
                case "elapsed":
                    node["rows"]![0]!["elapsedSeconds"] = 30;
                    break;
                case "index":
                    node["rows"]![0]!["entryIndex"] = 1;
                    break;
                case "empty":
                    node["rows"] = new JsonArray();
                    node["nextCursor"] = new JsonObject { ["entryIndex"] = 1, ["at"] = owner.At };
                    break;
                case "unknown":
                    node["extra"] = true;
                    break;
            }
            string changed =
                field == "duplicate" ? raw.Insert(1, "\"version\":1,") : node.ToJsonString();
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(
                () =>
                    FacetTrackingReader.ReadPageAsync(
                        FacetSchema.Bundled(),
                        owner,
                        null,
                        (_, _, _) => Task.FromResult(changed),
                        TestContext.CancellationToken
                    ),
                field
            );
        }
    }

    private static FacetTrackingOwner Owner(JsonElement page) =>
        new(
            page.GetProperty("profileId").GetString()!,
            page.GetProperty("version").GetUInt64(),
            page.GetProperty("at").GetString()!,
            7,
            9,
            page.TryGetProperty("taskPath", out var path) ? path.GetString() : null,
            page.TryGetProperty("taskRevision", out var revision) ? revision.GetString() : null
        );

    /// <summary>Actual SQLite pages keep byte-distinct paths and Rust UTF8 order across supplementary characters.</summary>
    [TestMethod]
    public async Task ActualUnicodeSessionsKeepByteOrderAndDistinctPaths()
    {
        using var stream = typeof(FacetTrackingReaderTests).Assembly.GetManifestResourceStream(
            "TrackingCaptureUnicode.json"
        )!;
        using var capture = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.CancellationToken
        );
        var pages = capture
            .RootElement.GetProperty("sessionsPagesRaw")
            .EnumerateArray()
            .Select(value => value.GetString()!)
            .ToArray();
        using var first = JsonDocument.Parse(pages[0]);
        var owner = Owner(first.RootElement);
        int calls = 0;
        FacetTrackingContinuation? continuation = null;
        List<string> actualPaths = [];
        do
        {
            var page = await FacetTrackingReader.ReadPageAsync(
                FacetSchema.Bundled(),
                owner,
                continuation,
                (_, _, _) => Task.FromResult(pages[calls++]),
                TestContext.CancellationToken
            );
            actualPaths.AddRange(page.Rows.Select(row => row.GetProperty("taskPath").GetString()!));
            Assert.IsTrue(page.Rows.Count <= 128);
            continuation = page.Next;
        } while (continuation is not null);
        CollectionAssert.AreEqual(UnicodePaths, actualPaths);
        Assert.AreEqual(3, calls);
    }

    /// <summary>Continuations reject changed cumulative totals, problems, revision, clock text, cursor and no-progress pages.</summary>
    [TestMethod]
    public async Task ContinuationLineageAndOverflowFailLoudly()
    {
        using var stream = typeof(FacetTrackingReaderTests).Assembly.GetManifestResourceStream(
            "TrackingCaptureV2.json"
        )!;
        using var capture = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.CancellationToken
        );
        var test = capture
            .RootElement.GetProperty("cases")
            .EnumerateArray()
            .Single(value => value.GetProperty("id").GetString() == "history-130");
        string firstRaw = test.GetProperty("historyPagesRaw")[0].GetString()!;
        string secondRaw = test.GetProperty("historyPagesRaw")[1].GetString()!;
        using var firstDocument = JsonDocument.Parse(firstRaw);
        var owner = Owner(firstDocument.RootElement);
        var first = await FacetTrackingReader.ReadPageAsync(
            FacetSchema.Bundled(),
            owner,
            null,
            (_, _, _) => Task.FromResult(firstRaw),
            TestContext.CancellationToken
        );
        var continuation = first.Next!;
        foreach (
            string change in new[]
            {
                "total",
                "problem",
                "revision",
                "clock-text",
                "index",
                "last-cursor",
                "no-progress",
            }
        )
        {
            var page = JsonNode.Parse(secondRaw)!;
            switch (change)
            {
                case "total":
                    page["totalCount"] = 131;
                    break;
                case "problem":
                    page["problemCount"] = 1;
                    page["problems"] = new JsonArray(
                        new JsonObject
                        {
                            ["taskPath"] = owner.TaskPath,
                            ["code"] = "invalid_time_entries",
                        }
                    );
                    break;
                case "revision":
                    page["taskRevision"] = new string('a', 64);
                    break;
                case "clock-text":
                    page["at"] = owner.At.Replace("Z", "+00:00", StringComparison.Ordinal);
                    break;
                case "index":
                    page["rows"]![0]!["entryIndex"] = 127;
                    break;
                case "last-cursor":
                    page["nextCursor"] = JsonNode.Parse(continuation.Cursor.GetRawText());
                    break;
                case "no-progress":
                    page["rows"] = new JsonArray();
                    page["nextCursor"] = JsonNode.Parse(continuation.Cursor.GetRawText());
                    break;
            }
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(
                () =>
                    FacetTrackingReader.ReadPageAsync(
                        FacetSchema.Bundled(),
                        owner,
                        continuation,
                        (_, _, _) => Task.FromResult(page.ToJsonString()),
                        TestContext.CancellationToken
                    ),
                change
            );
        }
        var overflowPage = JsonNode.Parse(secondRaw)!;
        overflowPage["totalCount"] = ulong.MaxValue;
        var overflow = continuation with
        {
            SeenCount = ulong.MaxValue,
            TotalCount = ulong.MaxValue,
        };
        _ = await Assert.ThrowsExactlyAsync<OverflowException>(() =>
            FacetTrackingReader.ReadPageAsync(
                FacetSchema.Bundled(),
                owner,
                overflow,
                (_, _, _) => Task.FromResult(overflowPage.ToJsonString()),
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Gets the test runner cancellation context.</summary>
    public TestContext TestContext { get; set; } = null!;
}
