using System.Globalization;
using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Automatic admission is fenced again on the actual native worker and preserves original journal bytes.</summary>
[TestClass]
public sealed class FacetOccurrenceOwnershipTests
{
    /// <summary>Queued work cannot write after its captured owner changes while another worker operation is in flight.</summary>
    [TestMethod]
    public async Task ChangedOwnerBeforeNativeDispatchPreservesTheAdmittedEnvelope()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        using ManualResetEventSlim entered = new(false);
        using ManualResetEventSlim release = new(false);
        Task<bool> blocker = fixture.Engine.Runner.RunAsync(() =>
        {
            entered.Set();
            if (!release.Wait(TimeSpan.FromSeconds(10)))
                throw new TimeoutException("The ownership fixture did not release its worker.");
            return true;
        });
        bool owns = true;
        try
        {
            Assert.IsTrue(await Task.Run(() => entered.Wait(TimeSpan.FromSeconds(5))));
            _ = await Assert.ThrowsExactlyAsync<OperationCanceledException>(() =>
            {
                Task<string> queued = fixture.Engine.ExecuteOwnedMaintenanceAsync(
                    "p",
                    fixture.Envelope.Document,
                    () => Volatile.Read(ref owns),
                    CancellationToken.None
                );
                Volatile.Write(ref owns, false);
                release.Set();
                return queued;
            });
            _ = await blocker;
            fixture.AssertUnchanged();
        }
        finally
        {
            release.Set();
        }
    }

    /// <summary>A private Sync replica without a real settled checkpoint cannot turn a Sync-disabled test into ready automatic work.</summary>
    [TestMethod]
    public async Task MissingInitialSyncBarrierNeverWritesAndRetainsTheOriginalAdmission()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        _ = await Assert.ThrowsExactlyAsync<FacetOccurrenceNotReadyException>(() =>
            fixture.Engine.ExecuteOwnedMaintenanceAsync(
                "p",
                fixture.Envelope.Document,
                () => true,
                CancellationToken.None
            )
        );
        fixture.AssertUnchanged();
    }

    /// <summary>The mutation ID, timestamp and local execution day come from one injected clock and remain immutable on retry.</summary>
    [TestMethod]
    public void GenerationAdmissionUsesTheOwningClockAndPreservesRetryBytes()
    {
        string directory = Path.Combine(
            Path.GetTempPath(),
            "facet-occurrence-clock-" + Guid.NewGuid().ToString("N")
        );
        Directory.CreateDirectory(directory);
        try
        {
            var clock = new FrozenClock();
            var journal = new FacetMutationJournal(directory, clock);
            var command = new
            {
                kind = "materialize_occurrence_window",
                origin = "automatic_maintenance",
                parentPath = "Parent.md",
                expectedParentRevision = new string('a', 64),
                referenceDate = "2026-10-24",
            };
            var first = journal.Prepare("p", command);
            var again = journal.Prepare("p", command);
            Assert.AreEqual(first, again);
            using var document = JsonDocument.Parse(first.Document);
            Assert.AreEqual(
                clock.GetUtcNow(),
                document.RootElement.GetProperty("at").GetDateTimeOffset()
            );
            Assert.AreEqual(
                "2026-10-24",
                document
                    .RootElement.GetProperty("executionContext")
                    .GetProperty("today")
                    .GetString()
            );
            Assert.AreEqual(
                "UTC",
                document
                    .RootElement.GetProperty("executionContext")
                    .GetProperty("timezone")
                    .GetString()
            );
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    private sealed class FrozenClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            DateTimeOffset.Parse("2026-10-24T12:30:00Z", CultureInfo.InvariantCulture);

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private readonly string _directory = Path.Combine(
            Path.GetTempPath(),
            "facet-occurrence-owner-" + Guid.NewGuid().ToString("N")
        );
        private readonly string _vault;
        private readonly Dictionary<string, byte[]> _before;
        private readonly FacetMutationJournal _journal;
        internal FacetEngineService Engine { get; }
        internal FacetMutationJournal.Entry Envelope { get; }

        private Fixture()
        {
            if (
                OperatingSystem.IsMacOS()
                && _directory.StartsWith("/var/", StringComparison.Ordinal)
            )
                _directory = "/private" + _directory;
            _vault = Path.Combine(_directory, "vault");
            Directory.CreateDirectory(_vault);
            File.WriteAllText(
                Path.Combine(_vault, "tasknotes.yaml"),
                "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n"
            );
            File.WriteAllText(
                Path.Combine(_vault, "Parent.md"),
                "---\ntitle: Synthetic parent\nstatus: open\ntags: [task]\ndateCreated: '2026-10-01T00:00:00Z'\nscheduled: '2026-10-24'\nrecurrence: 'DTSTART:20261024;FREQ=DAILY'\noccurrence_materialization: rolling\n---\n"
            );
            _before = Directory
                .EnumerateFiles(_vault)
                .ToDictionary(
                    file => Path.GetFileName(file),
                    File.ReadAllBytes,
                    StringComparer.Ordinal
                );
            Engine = FacetPortableCapability.Open(
                Path.Combine(_directory, "index.sqlite"),
                [new("p", _vault, true)]
            );
            _journal = new FacetMutationJournal(_directory, new FrozenClock());
            Envelope = _journal.Prepare(
                "p",
                new
                {
                    kind = "materialize_occurrence_window",
                    origin = "automatic_maintenance",
                    parentPath = "Parent.md",
                    expectedParentRevision = Convert.ToHexStringLower(
                        System.Security.Cryptography.SHA256.HashData(
                            File.ReadAllBytes(Path.Combine(_vault, "Parent.md"))
                        )
                    ),
                    referenceDate = "2026-10-24",
                }
            );
        }

        internal static async Task<Fixture> CreateAsync()
        {
            Fixture fixture = new();
            try
            {
                await fixture.Engine.InitializeAsync();
                _ = await fixture.Engine.RegisterProfileAsync(
                    "p",
                    "Synthetic private Sync replica",
                    fixture._vault,
                    true,
                    false
                );
                _ = await fixture.Engine.RefreshAsync("p");
                return fixture;
            }
            catch
            {
                await fixture.DisposeAsync();
                throw;
            }
        }

        internal void AssertUnchanged()
        {
            CollectionAssert.AreEqual(
                _before.Keys.Order(StringComparer.Ordinal).ToArray(),
                Directory
                    .EnumerateFiles(_vault)
                    .Select(Path.GetFileName)
                    .Order(StringComparer.Ordinal)
                    .ToArray()
            );
            foreach (var (name, bytes) in _before)
                CollectionAssert.AreEqual(bytes, File.ReadAllBytes(Path.Combine(_vault, name)));
            Assert.AreEqual(Envelope, _journal.PendingEntries.Single());
        }

        public async ValueTask DisposeAsync()
        {
            await Engine.DisposeAsync();
            Directory.Delete(_directory, true);
        }
    }
}
