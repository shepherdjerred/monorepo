using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Actual Rust/SQLite projection supplies one complete OS plan without opening disabled Sync sessions.</summary>
[TestClass]
public sealed class FacetReminderIntegrationTests
{
    private static readonly DateTimeOffset Clock = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The real producer spans multiple pages, reports invalid stored reminders and keeps a reminder-only writer offline.</summary>
    [TestMethod]
    public async Task ReminderOnlyWriterReadsEveryNativePageWithActualAuthorizationAndNoNetwork()
    {
        using TemporaryDirectory temporary = new();
        string physical =
            OperatingSystem.IsMacOS()
            && temporary.Path.StartsWith("/var/", StringComparison.Ordinal)
                ? "/private" + temporary.Path
                : temporary.Path;
        string root = Path.Combine(physical, "replica");
        string state = Path.Combine(physical, "state");
        Directory.CreateDirectory(root);
        for (int index = 0; index < 129; index++)
            await File.WriteAllTextAsync(
                Path.Combine(root, $"reminder-{index:D3}.md"),
                $"---\ndateCreated: '2026-10-03T12:00:00Z'\nstatus: open\npriority: normal\ntags: [task]\nreminders:\n  - id: reminder-{index:D3}\n    type: absolute\n    absoluteTime: '2026-10-04T13:00:00Z'\n---\n",
                TestContext.CancellationToken
            );
        await File.WriteAllTextAsync(
            Path.Combine(root, "invalid.md"),
            "---\ndateCreated: '2026-10-03T12:00:00Z'\nstatus: open\ntags: [task]\nreminders: invalid-existing-value\n---\n",
            TestContext.CancellationToken
        );
        var profile = new FacetProfileRegistration(
            "p",
            "Reminder vault",
            root,
            true,
            true,
            "owner",
            new ObsidianVaultChoice(
                "fixture-vault",
                "Reminder vault",
                "sync-test.obsidian.md",
                "test",
                "public-salt",
                0,
                false,
                false
            )
        );
        new FacetProfileCatalog(state).Add(profile);
        int connections = 0;
        await using var store = FacetPortableCapability.Store(
            state,
            new Secrets(),
            null,
            () =>
            {
                Interlocked.Increment(ref connections);
                throw new InvalidOperationException(
                    "A reminder-only writer must not open network sessions."
                );
            },
            allowSync: false
        );
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        FacetReminderPlan? observed = null;
        await store.ReconcileReminderPlanAsync(
            "p",
            Clock,
            "America/Los_Angeles",
            Clock.AddHours(2),
            (plan, _) =>
            {
                observed = plan;
                return Task.CompletedTask;
            },
            TestContext.CancellationToken
        );
        Assert.IsNotNull(observed);
        Assert.HasCount(129, observed.Reminders);
        Assert.HasCount(
            129,
            observed.Reminders.Select(row => row.NotificationId).Distinct().ToArray()
        );
        Assert.AreEqual(1UL, observed.ProblemCount);
        Assert.AreEqual(
            "invalid.md",
            observed.Problems.Single().GetProperty("taskPath").GetString()
        );
        Assert.IsTrue(observed.Reminders.All(row => row.FireAt == Clock.AddHours(1)));
        Assert.AreEqual(0, connections);
        Assert.IsEmpty(store.State.PendingIds);
        Assert.IsEmpty(store.State.FacetPendingActions);
        IOException failure = new("The OS schedule sink failed.");
        var actual = await Assert.ThrowsExactlyAsync<IOException>(() =>
            store.ReconcileReminderPlanAsync(
                "p",
                Clock,
                "America/Los_Angeles",
                Clock.AddHours(2),
                (_, _) => Task.FromException(failure),
                TestContext.CancellationToken
            )
        );
        Assert.AreSame(failure, actual);
        Assert.AreEqual(0, connections);
        Assert.IsEmpty(store.State.FacetPendingActions);
        await using var unauthorized = FacetPortableCapability.Store(
            state,
            new Secrets(authorized: false),
            synchronize: false
        );
        await unauthorized.InitializeAsync(null, null, TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<FacetAuthorizationRequiredException>(() =>
            unauthorized.ReconcileReminderPlanAsync(
                "p",
                Clock,
                "America/Los_Angeles",
                Clock.AddHours(2),
                (_, _) =>
                    throw new InvalidOperationException(
                        "An unauthorized schedule must not reach the OS sink."
                    ),
                TestContext.CancellationToken
            )
        );
    }

    private sealed class Secrets(bool authorized = true) : IFacetSecretStore
    {
        public string? Read(string identity) =>
            authorized
                ? identity switch
                {
                    "obsidian/account-owner" => "owner",
                    "obsidian/account-token" => "synthetic-token",
                    "obsidian/vault-key/owner/p/fixture-vault" => Convert.ToBase64String(
                        new byte[32]
                    ),
                    _ => null,
                }
                : null;

        public void Save(string identity, string value) =>
            throw new InvalidOperationException("This fixture does not authorize live accounts.");

        public void Remove(string identity) { }
    }

    /// <summary>Framework cancellation.</summary>
    public TestContext TestContext { get; set; } = null!;
}
