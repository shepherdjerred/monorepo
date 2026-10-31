using System.Globalization;
using System.Text;
using System.Text.Json;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Actual SQLite/core workflows use the existing portable capability and authenticated offline protocol fixture; no Windows or live Sync claim.</summary>
[TestClass]
public sealed partial class FacetOccurrenceStoreTests
{
    /// <summary>Only an observed absent old automatic decision is retired before a fresh current-fence plan.</summary>
    [TestMethod]
    public async Task ObsoleteAbsentAutomaticFencesRetireAndReplanIncludingMissingTargets()
    {
        foreach (string change in new[] { "changed", "deleted", "nonrecurring" })
        {
            await using Fixture fixture = await Fixture.CreateAsync();
            var old = fixture.RetainAutomatic(new string('0', 64));
            fixture.ChangeParent(change);
            await using var store = fixture.Open();
            await store.InitializeAsync(null, null);
            await store.RefreshAsync();
            Assert.IsFalse(store.State.FacetPendingActions.Any(action => action.Id == old.Id));
            Assert.IsFalse(fixture.Pending().Any(entry => entry.Id == old.Id));
            Assert.HasCount(change == "changed" ? 3 : 0, fixture.Children());
        }
    }

    /// <summary>A matching applied native outcome is not rejected merely because its parent is no longer a target.</summary>
    [TestMethod]
    public async Task ObsoleteAppliedAutomaticEnvelopeRemainsAvailableForOriginalObservation()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        var old = fixture.RetainAutomatic();
        await fixture.ApplyAsync(old, failFlush: false);
        fixture.ChangeParent("nonrecurring");
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.AreEqual(old, fixture.Pending().Single());
        Assert.AreEqual(old.Id, store.State.FacetPendingActions.Single().Id);
        Assert.HasCount(3, fixture.Children());
    }

    /// <summary>A real provider failure after native admission remains pending and cannot authorize stale-envelope retirement.</summary>
    [TestMethod]
    public async Task UncertainPendingAutomaticEnvelopeSurvivesRecoveryFailure()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        var old = fixture.RetainAutomatic();
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Host>(() =>
            fixture.ApplyAsync(old, failFlush: true)
        );
        await using var store = fixture.Open(failFlush: true);
        await store.InitializeAsync(null, null);
        Assert.AreEqual(old, fixture.Pending().Single());
        Assert.AreEqual(old.Id, store.State.FacetPendingActions.Single().Id);
    }

    /// <summary>Automatic maintenance repairs a deleted child after an explicit request, without taking the last user action's Undo authority.</summary>
    [TestMethod]
    public async Task AutomaticMaintenanceRecreatesDeletedChildrenAndPreservesUserUndo()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.HasCount(3, fixture.Children());
        Assert.IsFalse(
            store.State.CanUndoCompletion,
            "Automatic window receipts never become user Undo authority."
        );
        byte[] original = await File.ReadAllBytesAsync(fixture.Plain);
        var plain = store.State.AllTasks.Single(task => task.Title == "Synthetic plain task");
        await store.SetCompletionAsync(plain.Id, true);
        await store.RefreshAsync();
        Assert.IsTrue(store.State.CanUndoCompletion);
        string deleted = fixture.Children()[0];
        File.Delete(deleted);
        await store.SetQueryAsync(new TaskListQuery(TaskListKind.Browse));
        Assert.IsFalse(File.Exists(deleted), "Browsing cannot write missing occurrence files.");
        var at = fixture.Clock.GetUtcNow();
        await store.ReconcileReminderPlanAsync(
            "p",
            at,
            "Etc/UTC",
            at.AddDays(30),
            (_, _) => Task.CompletedTask
        );
        Assert.IsFalse(
            File.Exists(deleted),
            "Reminder projection cannot materialize missing children."
        );
        await store.RefreshAsync();
        Assert.IsTrue(File.Exists(deleted));
        Assert.HasCount(3, fixture.Children());
        Assert.IsTrue(
            store.State.CanUndoCompletion,
            "Maintenance must preserve the preceding user completion receipt."
        );
        await store.UndoCompletionAsync();
        CollectionAssert.AreEqual(original, await File.ReadAllBytesAsync(fixture.Plain));
        Assert.HasCount(3, fixture.Children());
        Assert.IsEmpty(store.State.FacetPendingActions);
    }

    /// <summary>A cold restart discovers missing children from current core state, even after the primary automatic envelope was cleaned up.</summary>
    [TestMethod]
    public async Task RestartDoesNotPermanentlyMemoizeAParentAndDay()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        await using (var first = fixture.Open())
        {
            await first.InitializeAsync(null, null);
            Assert.HasCount(3, fixture.Children());
        }
        string deleted = fixture.Children()[0];
        File.Delete(deleted);
        await using var restarted = fixture.Open();
        await restarted.InitializeAsync(null, null);
        Assert.IsTrue(File.Exists(deleted));
        Assert.HasCount(3, fixture.Children());
        Assert.IsFalse(restarted.State.CanUndoCompletion);
    }

    /// <summary>Explicit single-date generation is a real user mutation whose exact files can be undone.</summary>
    [TestMethod]
    public async Task ExplicitGenerationUsesFreshRowsAndRejectsAnotherProfile()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.IsEmpty(fixture.Children());
        var parent = store.State.AllTasks.Single(task => task.Title == "Synthetic rolling series");
        await store.GenerateOccurrenceAsync(parent, "2026-10-24");
        Assert.HasCount(1, fixture.Children());
        Assert.IsTrue(store.State.CanUndoCompletion);
        await store.UndoCompletionAsync();
        Assert.IsEmpty(fixture.Children());
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.GenerateOccurrenceWindowAsync(parent with { ProfileId = "another" })
        );
    }

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            DateTimeOffset.Parse("2026-10-24T12:30:00Z", CultureInfo.InvariantCulture);

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    private sealed class Secrets : IFacetSecretStore
    {
        internal Func<bool>? RemoveOwnerWhen { get; set; }
        internal Action? BeforeOwnerRead { get; set; }
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal)
        {
            [ObsidianAccountService.OwnerIdentity] = "fixture-owner",
            [ObsidianAccountService.TokenIdentity] = "synthetic-offline-fixture-token",
            [ObsidianAccountService.KeyIdentity("fixture-owner", "p", "fixture-vault")] =
                Convert.ToBase64String(new byte[32]),
        };

        public string? Read(string identity)
        {
            if (identity == ObsidianAccountService.OwnerIdentity)
                BeforeOwnerRead?.Invoke();
            if (
                identity == ObsidianAccountService.OwnerIdentity
                && RemoveOwnerWhen?.Invoke() == true
            )
                _values.Remove(ObsidianAccountService.OwnerIdentity);
            return _values.GetValueOrDefault(identity);
        }

        public void Save(string identity, string value) => _values[identity] = value;

        public void Remove(string identity) => _values.Remove(identity);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private readonly string _directory = Path.Combine(
            Path.GetTempPath(),
            "facet-occurrence-store-" + Guid.NewGuid().ToString("N")
        );
        private readonly string _vault;
        private readonly string _state;
        private readonly Secrets _secrets = new();
        internal TimeProvider Clock { get; } = new Clock();
        internal string Plain => Path.Combine(_vault, "Plain.md");
        internal string SecondPlain => Path.Combine(_directory, "second", "Plain.md");

        private Fixture()
        {
            if (
                OperatingSystem.IsMacOS()
                && _directory.StartsWith("/var/", StringComparison.Ordinal)
            )
                _directory = "/private" + _directory;
            _vault = Path.Combine(_directory, "vault");
            _state = Path.Combine(_directory, "state");
            Directory.CreateDirectory(_vault);
            File.WriteAllText(
                Path.Combine(_vault, "tasknotes.yaml"),
                "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n"
            );
            File.WriteAllText(
                Plain,
                "---\ntitle: Synthetic plain task\nstatus: open\ntags: [task]\ndateCreated: '2026-10-01T00:00:00Z'\n---\nPreserve exact user bytes.\n"
            );
            File.WriteAllText(
                Path.Combine(_vault, "Parent.md"),
                "---\ntitle: Synthetic rolling series\nstatus: open\ntags: [task]\ndateCreated: '2026-10-01T00:00:00Z'\nscheduled: '2026-10-24'\nrecurrence_anchor: scheduled\nrecurrence: 'DTSTART:20261024;FREQ=DAILY'\noccurrence_materialization: rolling\noccurrence_past_horizon: P0D\noccurrence_future_horizon: P2D\n---\n"
            );
            new FacetProfileCatalog(_state).Add(
                new(
                    "p",
                    "Synthetic private replica",
                    _vault,
                    true,
                    false,
                    "fixture-owner",
                    new(
                        "fixture-vault",
                        "Offline fixture",
                        "sync-test.obsidian.md",
                        "",
                        "public-salt",
                        0,
                        false,
                        false
                    )
                )
            );
        }

        internal static async Task<Fixture> CreateAsync(bool ready = true)
        {
            Fixture fixture = new();
            try
            {
                if (ready)
                {
                    await using var engine = FacetPortableCapability.Open(
                        Path.Combine(fixture._state, "facet.sqlite"),
                        [new("p", fixture._vault, true)]
                    );
                    await engine.InitializeAsync();
                    _ = await engine.RegisterProfileAsync(
                        "p",
                        "Synthetic private replica",
                        fixture._vault,
                        true,
                        false
                    );
                    _ = await engine.RefreshAsync("p");
                    await FacetRemoteFixture.ApplyAsync(
                        engine,
                        "p",
                        "Reference.md",
                        Encoding.UTF8.GetBytes("Synthetic authenticated protocol barrier.\n"),
                        "{\"schemaVersion\":1,\"uid\":1,\"ctime\":1000,\"mtime\":1000}",
                        CancellationToken.None
                    );
                }
                return fixture;
            }
            catch
            {
                await fixture.DisposeAsync();
                throw;
            }
        }

        internal FacetTaskNotesStore Open(bool failFlush = false) =>
            failFlush
                ? new FacetTaskNotesStore(
                    _state,
                    _secrets,
                    null,
                    null,
                    Clock,
                    false,
                    FailingCapability
                )
                : FacetPortableCapability.Store(_state, _secrets, time: Clock, allowSync: false);

        internal FacetMutationJournal.Entry RetainAutomatic(string? revision = null)
        {
            var journal = new FacetMutationJournal(_state, Clock);
            string hash =
                revision
                ?? Convert.ToHexStringLower(
                    System.Security.Cryptography.SHA256.HashData(
                        File.ReadAllBytes(Path.Combine(_vault, "Parent.md"))
                    )
                );
            return journal.Prepare(
                "p",
                new
                {
                    kind = "materialize_occurrence_window",
                    origin = "automatic_maintenance",
                    parentPath = "Parent.md",
                    expectedParentRevision = hash,
                    referenceDate = "2026-10-24",
                }
            );
        }

        internal IReadOnlyList<FacetMutationJournal.Entry> Pending() =>
            new FacetMutationJournal(_state, Clock).PendingEntries;

        internal void SelectForColdStart(string profile) =>
            new FacetProfileCatalog(_state).Select(profile);

        internal FacetMutationJournal.Entry RetainSecondPlainUpdate() =>
            new FacetMutationJournal(_state, Clock).Prepare(
                "q",
                new
                {
                    kind = "update",
                    path = "Plain.md",
                    expectedRevision = Convert.ToHexStringLower(
                        System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(SecondPlain))
                    ),
                    properties = new { priority = "high" },
                }
            );

        internal async Task CompleteSecondPlainOutsideHostAsync()
        {
            string second = Path.GetDirectoryName(SecondPlain)!;
            await using var engine = FacetPortableCapability.Open(
                Path.Combine(_state, "facet.sqlite"),
                [new("q", second, true)]
            );
            await engine.InitializeAsync();
            _ = await engine.ExecuteAsync(
                "q",
                "{\"schemaVersion\":1,\"mutationId\":\"second-plain-completion\",\"at\":\"2026-10-24T12:00:00Z\",\"executionContext\":{\"today\":\"2026-10-24\",\"timezone\":\"UTC\"},\"command\":{\"kind\":\"set_completion\",\"path\":\"Plain.md\",\"completed\":true}}"
            );
        }

        internal void ChangeParent(string change)
        {
            string path = Path.Combine(_vault, "Parent.md");
            if (change == "renamed")
                File.Move(path, Path.Combine(_vault, "Renamed.md"));
            else if (change == "deleted")
                File.Delete(path);
            else if (change == "nonrecurring")
                File.WriteAllText(
                    path,
                    File.ReadAllText(path)
                        .Replace(
                            "recurrence: 'DTSTART:20261024;FREQ=DAILY'\n",
                            "",
                            StringComparison.Ordinal
                        )
                );
            else
                File.AppendAllText(path, "\nSynthetic concurrent parent edit.\n");
        }

        internal void EditParent(string before, string after)
        {
            string path = Path.Combine(_vault, "Parent.md");
            string bytes = File.ReadAllText(path);
            Assert.Contains(before, bytes, "The synthetic edit must target known fixture content.");
            File.WriteAllText(path, bytes.Replace(before, after, StringComparison.Ordinal));
        }

        internal byte[] ReadParent() => File.ReadAllBytes(Path.Combine(_vault, "Parent.md"));

        internal void RestoreParent(byte[] bytes) =>
            File.WriteAllBytes(Path.Combine(_vault, "Parent.md"), bytes);

        internal void RemoveAuthorityWhen(Func<bool> condition) =>
            _secrets.RemoveOwnerWhen = condition;

        internal void AddSecondSeries() =>
            File.WriteAllText(
                Path.Combine(_vault, "Second.md"),
                File.ReadAllText(Path.Combine(_vault, "Parent.md"))
                    .Replace(
                        "Synthetic rolling series",
                        "Synthetic second series",
                        StringComparison.Ordinal
                    )
            );

        internal void AfterFirstAutomaticAdmission(Action change)
        {
            _secrets.BeforeOwnerRead = () =>
            {
                if (!Pending().Any(entry => entry.Profile == "p"))
                    return;
                _secrets.BeforeOwnerRead = null;
                change();
            };
        }

        internal async Task AddSecondReadyProfileAsync(bool dense = false)
        {
            string second = Path.Combine(_directory, "second");
            Directory.CreateDirectory(second);
            File.Copy(
                Path.Combine(_vault, "tasknotes.yaml"),
                Path.Combine(second, "tasknotes.yaml")
            );
            File.Copy(Path.Combine(_vault, "Parent.md"), Path.Combine(second, "Parent.md"));
            File.Copy(Plain, SecondPlain);
            if (dense)
            {
                string repeated = string.Join(',', Enumerable.Repeat("0", 101));
                string parent = await File.ReadAllTextAsync(Path.Combine(second, "Parent.md"));
                await File.WriteAllTextAsync(
                    Path.Combine(second, "Parent.md"),
                    parent
                        .Replace(
                            "occurrence_materialization: rolling",
                            "occurrence_materialization: on_completion",
                            StringComparison.Ordinal
                        )
                        .Replace(
                            "DTSTART:20261024;FREQ=DAILY",
                            $"DTSTART:20261024;FREQ=DAILY;COUNT=1;BYHOUR={repeated};BYMINUTE={repeated};BYSECOND={repeated}",
                            StringComparison.Ordinal
                        )
                );
            }
            new FacetProfileCatalog(_state).Add(
                new(
                    "q",
                    "Second private replica",
                    second,
                    true,
                    false,
                    "fixture-owner",
                    new(
                        "fixture-vault-2",
                        "Second offline fixture",
                        "sync-test.obsidian.md",
                        "",
                        "public-salt",
                        0,
                        false,
                        false
                    )
                )
            );
            new FacetProfileCatalog(_state).Select("p");
            _secrets.Save(
                ObsidianAccountService.KeyIdentity("fixture-owner", "q", "fixture-vault-2"),
                Convert.ToBase64String(new byte[32])
            );
            await using var engine = FacetPortableCapability.Open(
                Path.Combine(_state, "facet.sqlite"),
                [new("q", second, true)]
            );
            await engine.InitializeAsync();
            _ = await engine.RegisterProfileAsync(
                "q",
                "Second private replica",
                second,
                true,
                false
            );
            _ = await engine.RefreshAsync("q");
            await FacetRemoteFixture.ApplyAsync(
                engine,
                "q",
                "Reference.md",
                Encoding.UTF8.GetBytes("Second authenticated fixture.\n"),
                "{\"schemaVersion\":1,\"uid\":1,\"ctime\":1000,\"mtime\":1000}",
                CancellationToken.None
            );
        }

        internal string[] SecondChildren() =>
            Directory
                .EnumerateFiles(
                    Path.Combine(_directory, "second"),
                    "*.md",
                    SearchOption.AllDirectories
                )
                .Where(file =>
                    File.ReadAllText(file).Contains("recurrence_parent:", StringComparison.Ordinal)
                )
                .ToArray();

        internal async Task<JsonElement> ReadFeatureAsync(object request)
        {
            await using var engine = FacetPortableCapability.Open(
                Path.Combine(_state, "facet.sqlite"),
                [new("p", _vault, true)]
            );
            await engine.InitializeAsync();
            using var document = JsonDocument.Parse(
                await engine.FeaturesAsync(
                    "p",
                    JsonSerializer.SerializeToElement(request).GetRawText()
                )
            );
            return document.RootElement.Clone();
        }

        internal Task<JsonElement> ChildPropertiesAsync(string path) =>
            ReadFeatureAsync(
                new
                {
                    kind = "normalization_preview",
                    path = Path.GetRelativePath(_vault, path).Replace('\\', '/'),
                }
            );

        internal async Task ApplyAsync(FacetMutationJournal.Entry entry, bool failFlush)
        {
            await using var engine = failFlush
                ? new FacetEngineService(
                    Path.Combine(_state, "facet.sqlite"),
                    [new("p", _vault, true)],
                    FailingCapability
                )
                : FacetPortableCapability.Open(
                    Path.Combine(_state, "facet.sqlite"),
                    [new("p", _vault, true)]
                );
            await engine.InitializeAsync();
            _ = await engine.ExecuteAsync("p", entry.Document);
        }

        private static FacetBoundedVault FailingCapability(
            FacetVaultFiles files,
            string profile,
            string identity,
            string directory
        ) =>
            files.OpenBoundedCapability(
                profile,
                identity,
                directory,
                stream =>
                    File.GetCreationTimeUtc(stream.SafeFileHandle)
                        .Ticks.ToString(CultureInfo.InvariantCulture),
                (_, _) => throw new IOException("Synthetic durable provider flush failure.")
            );

        internal string[] Children() =>
            Directory
                .EnumerateFiles(_vault, "*.md", SearchOption.AllDirectories)
                .Where(file =>
                    File.ReadAllText(file).Contains("recurrence_parent:", StringComparison.Ordinal)
                )
                .Order(StringComparer.Ordinal)
                .ToArray();

        public ValueTask DisposeAsync()
        {
            Directory.Delete(_directory, true);
            return ValueTask.CompletedTask;
        }
    }
}
