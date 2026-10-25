using System.Text.Json;
using System.Text.Json.Nodes;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Host paging/ownership tests use the committed normal project and actual shared schemas.</summary>
[TestClass]
public sealed class FacetOccurrencePlanTests
{
    /// <summary>Cross-field cursor identity and duplicate-target guards reject complete-looking pages before any caller can drain effects.</summary>
    [TestMethod]
    public async Task MaintenanceRejectsBoundCursorCorruptionAndDuplicateTargets()
    {
        foreach (
            Action<JsonObject> corrupt in new Action<JsonObject>[]
            {
                page => page["inspectedCount"] = 0,
                page => page["nextCursor"]!["version"] = 8,
                page => page["nextCursor"]!["binding"] = new string('c', 64),
                page => page["nextCursor"]!["referenceDate"] = "2026-10-25",
                page =>
                {
                    page["targets"]![0]!["referenceDate"] = "2026-10-25";
                    page["nextCursor"] = null;
                },
                page =>
                {
                    page["targets"]!.AsArray().Add(page["targets"]![0]!.DeepClone());
                    page["nextCursor"] = null;
                },
            }
        )
        {
            var changed = JsonNode.Parse(Page("b.md", "b.md", 7))!.AsObject();
            corrupt(changed);
            int call = 0;
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
                FacetOccurrencePlans.MaintenanceAsync(
                    "p",
                    "2026-10-24",
                    (_, _) =>
                        Task.FromResult(
                            call++ == 0 ? Page("a.md", "a.md", 7) : changed.ToJsonString()
                        ),
                    CancellationToken.None
                )
            );
            Assert.AreEqual(2, call);
        }
    }

    /// <summary>One obsolete rejection can replan; repeated races stop until a new external request, without consuming newer dirty input.</summary>
    [TestMethod]
    public void AutomaticReplanningIsBoundedAndCannotReplaceNewExternalRequests()
    {
        FacetOccurrenceRequests requests = new();
        requests.Request("p");
        var first = requests.Snapshot().Single();
        Assert.IsTrue(requests.RequestReplan("p", first.Value));
        var second = requests.Snapshot().Single();
        requests.Acknowledge("p", first.Value);
        Assert.IsFalse(requests.RequestReplan("p", second.Value));
        requests.Request("p");
        var external = requests.Snapshot().Single();
        Assert.IsTrue(requests.RequestReplan("p", second.Value));
        Assert.AreEqual(external, requests.Snapshot().Single());
        Assert.IsTrue(requests.RequestReplan("p", external.Value));
    }

    /// <summary>An external request arriving while an earlier plan drains cannot be consumed by its final version observation.</summary>
    [TestMethod]
    public async Task ExternalRequestDuringCapturedDrainRemainsPending()
    {
        FacetOccurrenceRequests requests = new();
        requests.Request("a");
        requests.Request("a");
        var captured = requests.Snapshot().Single();
        await Task.Run(() =>
        {
            requests.Request("a");
            requests.Request("b");
        });
        requests.Acknowledge(captured.Key, captured.Value);
        var next = requests.Snapshot();
        Assert.HasCount(2, next);
        Assert.IsGreaterThan(captured.Value, next.Single(pair => pair.Key == "a").Value);
        foreach (var pair in next)
            requests.Acknowledge(pair.Key, pair.Value);
        Assert.IsFalse(requests.HasPending);
    }

    /// <summary>All pages use one profile/reference date/index version before any generation target can escape.</summary>
    [TestMethod]
    public async Task MaintenancePagesRetainTheExactReferenceAndVersionFence()
    {
        int call = 0;
        var plan = await FacetOccurrencePlans.MaintenanceAsync(
            "p",
            "2026-10-24",
            (json, _) =>
            {
                using var request = JsonDocument.Parse(json);
                Assert.AreEqual(
                    "2026-10-24",
                    request.RootElement.GetProperty("referenceDate").GetString()
                );
                if (call++ == 0)
                    return Task.FromResult(Page("a.md", "a.md", 7));
                Assert.AreEqual(
                    7UL,
                    request.RootElement.GetProperty("expectedVersion").GetUInt64()
                );
                Assert.AreEqual(
                    "a.md",
                    request.RootElement.GetProperty("after").GetProperty("lastPath").GetString()
                );
                return Task.FromResult(Page("b.md", null, 7));
            },
            CancellationToken.None
        );
        Assert.AreEqual(7UL, plan.Version);
        Assert.HasCount(2, plan.Targets);
        Assert.AreEqual(2, call);
    }

    /// <summary>A stale version, repeated cursor, wrong owner or reference date fails before targets are returned.</summary>
    [TestMethod]
    public async Task MaintenanceDoesNotAcceptStaleOrNonadvancingPages()
    {
        foreach (
            string second in new[]
            {
                Page("b.md", null, 8),
                Page("b.md", "a.md", 7),
                Page("b.md", null, 7, "other"),
                Page("b.md", null, 7).Replace("2026-10-24", "2026-10-25", StringComparison.Ordinal),
            }
        )
        {
            int call = 0;
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
                FacetOccurrencePlans.MaintenanceAsync(
                    "p",
                    "2026-10-24",
                    (_, _) => Task.FromResult(call++ == 0 ? Page("a.md", "a.md", 7) : second),
                    CancellationToken.None
                )
            );
            Assert.AreEqual(2, call);
        }
    }

    /// <summary>The reader consumes actual committed core failure outputs without any retained primary envelope.</summary>
    [TestMethod]
    public async Task TypedFailureDiscoveryUsesSharedCoreOutputs()
    {
        using var stream =
            typeof(FacetOccurrencePlanTests).Assembly.GetManifestResourceStream(
                "FacetOccurrenceContractCases.json"
            ) ?? throw new InvalidDataException("The shared occurrence corpus is missing.");
        using var document = await JsonDocument.ParseAsync(stream);
        int count = 0;
        foreach (
            var fixture in document
                .RootElement.GetProperty("cases")
                .EnumerateArray()
                .Where(value =>
                    value.GetProperty("definition").GetString() == "generationFailuresPlan"
                    && value.GetProperty("valid").GetBoolean()
                )
        )
        {
            var output = fixture.GetProperty("value");
            if (output.GetProperty("nextCursor").ValueKind != JsonValueKind.Null)
                continue;
            string profile = output.GetProperty("profileId").GetString()!;
            var rows = await FacetOccurrencePlans.FailuresAsync(
                profile,
                (_, _) => Task.FromResult(output.GetRawText()),
                CancellationToken.None
            );
            Assert.HasCount(output.GetProperty("items").GetArrayLength(), rows);
            foreach (var row in rows)
            {
                Assert.AreEqual(profile, row.ProfileId);
                Assert.IsFalse(string.IsNullOrWhiteSpace(row.Status));
            }
            count++;
        }
        Assert.IsGreaterThan(0, count);
    }

    private static string Page(string path, string? next, ulong version, string profile = "p") =>
        JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                profileId = profile,
                version,
                referenceDate = "2026-10-24",
                inspectedCount = 1,
                targets = new[]
                {
                    new
                    {
                        parentPath = path,
                        expectedParentRevision = new string('a', 64),
                        referenceDate = "2026-10-24",
                        start = "2026-10-24",
                        end = "2026-10-26",
                    },
                },
                problems = Array.Empty<object>(),
                nextCursor = next is null
                    ? null
                    : new
                    {
                        lastPath = next,
                        referenceDate = "2026-10-24",
                        version,
                        binding = new string('b', 64),
                    },
            }
        );
}
