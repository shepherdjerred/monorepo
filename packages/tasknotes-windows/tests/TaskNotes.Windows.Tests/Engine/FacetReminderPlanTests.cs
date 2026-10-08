using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>OS schedule replacement requires a complete, unchanged core reading.</summary>
[TestClass]
public sealed class FacetReminderPlanTests
{
    private static readonly DateTimeOffset Clock = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);

    /// <summary>All cursor requests retain the original clock, owning profile and exact version.</summary>
    [TestMethod]
    public async Task CollectsEveryPageWithOriginalFenceAndDiagnostics()
    {
        int calls = 0;
        var plan = await ReadAsync(
            (request, _) =>
            {
                using var parsed = JsonDocument.Parse(request);
                var root = parsed.RootElement;
                Assert.AreEqual("reminder_plan", root.GetProperty("kind").GetString());
                Assert.AreEqual(Clock, root.GetProperty("at").GetDateTimeOffset());
                Assert.AreEqual("America/Los_Angeles", root.GetProperty("timezone").GetString());
                if (calls++ == 0)
                {
                    Assert.IsFalse(root.TryGetProperty("after", out JsonElement unusedCursor));
                    Assert.AreEqual(JsonValueKind.Undefined, unusedCursor.ValueKind);
                    return Task.FromResult(Page("first", 7, 2, next: true, problems: 130));
                }
                Assert.AreEqual(7, root.GetProperty("expectedVersion").GetInt64());
                Assert.AreEqual(
                    "first",
                    root.GetProperty("after").GetProperty("reminderId").GetString()
                );
                return Task.FromResult(Page("second", 7, 2, problems: 130));
            }
        );
        Assert.AreEqual(2, calls);
        Assert.HasCount(2, plan.Reminders);
        Assert.AreEqual("p", plan.ProfileId);
        Assert.AreEqual(7UL, plan.Version);
        Assert.AreEqual(130UL, plan.ProblemCount);
        Assert.HasCount(1, plan.Problems);
        Assert.AreEqual("bad-reminder", plan.Problems[0].GetProperty("code").GetString());
        Assert.IsNull(plan.Reminders[0].Description);
        Assert.IsNull(plan.Reminders[0].OccurrenceDate);
    }

    /// <summary>A changed version, owner, total, failed page or duplicate identity never yields a partial plan.</summary>
    [TestMethod]
    public async Task RejectsIncompleteOrChangedPlansAndPreservesBoundaryFailure()
    {
        foreach (
            string second in new[]
            {
                Page("second", 8, 2),
                Page("second", 7, 3),
                Page("second", 7, 2, profile: "other"),
                Page("second", 7, 2, problems: 1),
                Page("first", 7, 2),
                Page("second", 7, 2, next: true),
            }
        )
        {
            int calls = 0;
            _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
                ReadAsync(
                    (_, _) =>
                        Task.FromResult(calls++ == 0 ? Page("first", 7, 2, next: true) : second)
                )
            );
        }
        _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
            ReadAsync((_, _) => Task.FromResult(Page("only", 7, 2)))
        );
        int reads = 0;
        IOException expected = new("The provider is unavailable.");
        var observed = await Assert.ThrowsExactlyAsync<IOException>(() =>
            ReadAsync(
                (_, _) =>
                    reads++ == 0
                        ? Task.FromResult(Page("first", 7, 2, next: true))
                        : Task.FromException<string>(expected)
            )
        );
        Assert.AreSame(expected, observed);
    }

    /// <summary>Empty output is complete; malformed cursors cannot remove an existing OS schedule.</summary>
    [TestMethod]
    public async Task AcceptsEmptyPlanAndRejectsCursorWithoutRowsOrBoundary()
    {
        string empty =
            """{"schemaVersion":1,"profileId":"p","version":7,"totalCount":0,"rows":[],"nextCursor":null,"problemCount":0,"problems":[]}""";
        var plan = await ReadAsync((_, _) => Task.FromResult(empty));
        Assert.IsEmpty(plan.Reminders);
        Assert.IsEmpty(plan.Problems);
        string cursor =
            """{"fireAt":"2026-10-04T13:00:00Z","reminderId":"missing","taskPath":"task.md"}""";
        _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
            ReadAsync(
                (_, _) =>
                    Task.FromResult(
                        empty.Replace(
                            "\"nextCursor\":null",
                            "\"nextCursor\":" + cursor,
                            StringComparison.Ordinal
                        )
                    )
            )
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
            ReadAsync(
                (_, _) =>
                    Task.FromResult(
                        Page("first", 7, 1, next: true)
                            .Replace(
                                "\"reminderId\":\"first\",\"taskPath\":\"task.md\"}",
                                "\"reminderId\":\"missing\",\"taskPath\":\"task.md\"}",
                                StringComparison.Ordinal
                            )
                    )
            )
        );
    }

    private Task<FacetReminderPlan> ReadAsync(Func<string, CancellationToken, Task<string>> read) =>
        FacetReminderPlanReader.ReadAsync(
            "p",
            Clock,
            "America/Los_Angeles",
            Clock,
            Clock.AddDays(30),
            read,
            TestContext.CancellationToken
        );

    private static string Page(
        string id,
        long version,
        int total,
        bool next = false,
        string profile = "p",
        int problems = 0
    ) =>
        JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                profileId = profile,
                version,
                totalCount = total,
                rows = new[]
                {
                    new
                    {
                        notificationId = "facet:"
                            + Convert.ToHexStringLower(
                                System.Security.Cryptography.SHA256.HashData(
                                    System.Text.Encoding.UTF8.GetBytes(id)
                                )
                            ),
                        taskPath = "task.md",
                        title = "Reminder",
                        taskRevision = new string('a', 64),
                        reminderId = id,
                        fireAt = "2026-10-04T13:00:00Z",
                        occurrenceDate = (string?)null,
                        description = (string?)null,
                    },
                },
                nextCursor = next
                    ? new
                    {
                        fireAt = "2026-10-04T13:00:00Z",
                        reminderId = id,
                        taskPath = "task.md",
                    }
                    : null,
                problemCount = problems,
                problems = problems > 0
                    ?
                    [
                        new
                        {
                            taskPath = "broken.md",
                            reminderId = (string?)null,
                            code = "bad-reminder",
                        },
                    ]
                    : Array.Empty<object>(),
            }
        );

    /// <summary>Framework cancellation.</summary>
    public TestContext TestContext { get; set; } = null!;
}
