using System.Text;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies durable host storage contracts.</summary>
    [TestClass]
    public sealed class FileHostStorageTests
    {
        /// <summary>Round-trips every raw storage slot and both numeric slots.</summary>
        [TestMethod]
        public void AllStringAndIntegerSlotsRoundTrip()
        {
            using TemporaryDirectory directory = new();
            FileHostStorage storage = new(directory.Path);

            storage.WriteQueue( /*lang=json,strict*/
                "[{\"id\":\"command-1\"}]"
            );
            storage.WriteDeadLetter("[]");
            storage.WriteIdAliases("{}");
            storage.WriteIdCounters( /*lang=json,strict*/
                "{\"command\":1}"
            );
            storage.WriteCompletionRestores("{}");
            storage.WriteLastSyncTime(42);
            storage.WriteSchemaVersion(2);

            Assert.AreEqual( /*lang=json,strict*/
                "[{\"id\":\"command-1\"}]",
                storage.ReadQueue()
            );
            Assert.AreEqual("[]", storage.ReadDeadLetter());
            Assert.AreEqual("{}", storage.ReadIdAliases());
            Assert.AreEqual( /*lang=json,strict*/
                "{\"command\":1}",
                storage.ReadIdCounters()
            );
            Assert.AreEqual("{}", storage.ReadCompletionRestores());
            Assert.AreEqual(42, storage.ReadLastSyncTime());
            Assert.AreEqual(2u, storage.ReadSchemaVersion());
        }

        /// <summary>Rejects malformed bytes instead of silently replacing them.</summary>
        [TestMethod]
        public void InvalidUtf8FailsAsValidationInsteadOfBeingReplaced()
        {
            using TemporaryDirectory directory = new();
            File.WriteAllBytes(Path.Combine(directory.Path, "queue.json"), [0xC3, 0x28]);
            FileHostStorage storage = new(directory.Path);

            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(storage.ReadQueue);
        }

        /// <summary>Reports corrupt version data as a validation failure.</summary>
        [TestMethod]
        public void CorruptIntegerFailsLoudly()
        {
            using TemporaryDirectory directory = new();
            File.WriteAllText(
                Path.Combine(directory.Path, "schema-version.json"),
                "two",
                Encoding.UTF8
            );
            FileHostStorage storage = new(directory.Path);

            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(() =>
                storage.ReadSchemaVersion()
            );
            File.WriteAllText(
                Path.Combine(directory.Path, "last-sync-time.json"),
                "yesterday",
                Encoding.UTF8
            );
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(() =>
                storage.ReadLastSyncTime()
            );
        }

        /// <summary>Rejects malformed JSON and invalid task records without replacing the cache.</summary>
        [TestMethod]
        public void CorruptTaskDocumentsFailLoudly()
        {
            using TemporaryDirectory directory = new();
            FileHostStorage storage = new(directory.Path);
            File.WriteAllText(Path.Combine(directory.Path, "tasks.json"), "[", Encoding.UTF8);
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(storage.ReadTasks);
            File.WriteAllText(
                Path.Combine(directory.Path, "tasks.json"),
                /*lang=json,strict*/"[{\"id\":\"Tasks/not-markdown.txt\",\"title\":\"Invalid\"}]",
                Encoding.UTF8
            );
            _ = Assert.Throws<Core.CoreException>(storage.ReadTasks);
        }

        /// <summary>Allows migration cleanup to be repeated safely.</summary>
        [TestMethod]
        public void LegacyQueueRemovalIsIdempotent()
        {
            using TemporaryDirectory directory = new();
            string legacy = Path.Combine(directory.Path, "legacy-queue.json");
            File.WriteAllText(legacy, "[]", Encoding.UTF8);
            FileHostStorage storage = new(directory.Path);

            storage.RemoveLegacyQueue();
            storage.RemoveLegacyQueue();

            Assert.IsFalse(File.Exists(legacy));
        }

        /// <summary>Returns contract defaults for every absent slot.</summary>
        [TestMethod]
        public void MissingStorageSlotsReturnCoreDefaults()
        {
            using TemporaryDirectory directory = new();
            FileHostStorage storage = new(directory.Path);
            Assert.IsNull(storage.ReadQueue());
            Assert.IsNull(storage.ReadDeadLetter());
            Assert.IsNull(storage.ReadIdAliases());
            Assert.IsNull(storage.ReadIdCounters());
            Assert.IsNull(storage.ReadCompletionRestores());
            Assert.IsNull(storage.ReadLastSyncTime());
            Assert.IsNull(storage.ReadLegacyQueue());
            Assert.IsNull(storage.ReadSavedViews());
            Assert.AreEqual(0u, storage.ReadSchemaVersion());
            Assert.IsEmpty(storage.ReadTasks());
        }

        /// <summary>Round-trips core tasks and rejects a non-array cache document.</summary>
        [TestMethod]
        public async Task TaskCacheRoundTripsAndRejectsWrongRootShape()
        {
            using TemporaryDirectory directory = new();
            FileHostStorage storage = new(directory.Path);
            storage.WriteTasks([
                Core.TaskNotesCoreMethods.TaskFromJson(
                    /*lang=json,strict*/"{\"id\":\"Tasks/cache.md\",\"title\":\"Cache task\"}"
                ),
            ]);
            Core.Task[] tasks = storage.ReadTasks();
            Assert.HasCount(1, tasks);
            storage.WriteTasks(tasks);
            Assert.HasCount(1, storage.ReadTasks());
            await File.WriteAllTextAsync(
                Path.Combine(directory.Path, "tasks.json"),
                "{}",
                Encoding.UTF8,
                TestContext.CancellationToken
            );
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(storage.ReadTasks);
        }

        /// <summary>Rejects a storage root that is already occupied by a file.</summary>
        [TestMethod]
        public void StorageRootCreationFailurePreservesTheInvariantError()
        {
            using TemporaryDirectory directory = new();
            string file = Path.Combine(directory.Path, "occupied");
            File.WriteAllText(file, "not a directory", Encoding.UTF8);
            _ = Assert.ThrowsExactly<Core.CoreException.Invariant>(() => new FileHostStorage(file));
        }

        /// <summary>Preserves atomic-write failures and does not leave temporary files behind.</summary>
        [TestMethod]
        public void DirectoryInPlaceOfDestinationPreservesOriginalWriteFailure()
        {
            using TemporaryDirectory directory = new();
            Directory.CreateDirectory(Path.Combine(directory.Path, "queue.json"));
            FileHostStorage storage = new(directory.Path);

            Core.CoreException.Invariant failure =
                Assert.ThrowsExactly<Core.CoreException.Invariant>(() => storage.WriteQueue("[]"));

            StringAssert.Contains(failure.Message, "write queue.json", StringComparison.Ordinal);
            Assert.HasCount(
                0,
                Directory.GetFiles(
                    directory.Path,
                    "queue.json.*.tmp",
                    SearchOption.TopDirectoryOnly
                )
            );
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
