using System.Text.Json;
using Microsoft.Extensions.Logging;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Covers portable configuration, diagnostics classification, IDs, and saved-view persistence.</summary>
    [TestClass]
    public sealed class HostContractTests
    {
        /// <summary>Verifies diagnostics retain only the allow-listed structured fields.</summary>
        [TestMethod]
        public void DiagnosticsRedactSecretsAndNormalizeProperties()
        {
            using TemporaryDirectory temporary = new();
            using JsonLineLoggerProvider provider = new(temporary.Path);
            ILogger logger = provider.CreateLogger("TaskNotes.Unit");
            KeyValuePair<string, object?>[] state =
            [
                new("CorrelationId", Guid.Parse("ec9fc8b4-d756-43c0-bcbc-63645a3f7a72")),
                new("DurationMs", 42.5m),
                new("Operation", "refresh"),
                new("Outcome", true),
                new("StatusCode", (ushort)503),
                new("Token", "bearer-secret"),
                new("TaskTitle", "private task"),
                new("{OriginalFormat}", "{Operation} {StatusCode} {Token}"),
            ];

            logger.Log(
                LogLevel.Warning,
                new EventId(73, "Sync"),
                state,
                new InvalidOperationException("secret exception message"),
                static (_, _) => "ignored formatter output"
            );

            string[] files = Directory.GetFiles(temporary.Path);
            Assert.HasCount(1, files);
            string log = File.ReadAllText(files[0]);
            using JsonDocument document = JsonDocument.Parse(log);
            JsonElement root = document.RootElement;
            Assert.AreEqual("Warning", root.GetProperty("Level").GetString());
            Assert.AreEqual("TaskNotes.Unit", root.GetProperty("Category").GetString());
            Assert.AreEqual(73, root.GetProperty("EventId").GetInt32());
            Assert.AreEqual("Sync", root.GetProperty("EventName").GetString());
            Assert.AreEqual(
                "System.InvalidOperationException",
                root.GetProperty("ExceptionType").GetString()
            );
            JsonElement properties = root.GetProperty("Properties");
            Assert.AreEqual("refresh", properties.GetProperty("Operation").GetString());
            Assert.IsFalse(log.Contains("bearer-secret", StringComparison.Ordinal));
            Assert.IsFalse(log.Contains("private task", StringComparison.Ordinal));
            Assert.IsFalse(log.Contains("secret exception message", StringComparison.Ordinal));
        }

        /// <summary>Verifies logging scopes, disabled levels, retention, and disposal.</summary>
        [TestMethod]
        public void DiagnosticsHonorRetentionAndLoggerContracts()
        {
            using TemporaryDirectory temporary = new();
            string expired = Path.Combine(temporary.Path, "tasknotes-20000101-00.jsonl");
            File.WriteAllText(expired, "expired\n");
            File.SetLastWriteTimeUtc(expired, DateTime.UtcNow.AddDays(-8));

            using JsonLineLoggerProvider provider = new(temporary.Path);
            ILogger logger = provider.CreateLogger("TaskNotes.Unit");
            Assert.IsFalse(File.Exists(expired));
            Assert.IsFalse(logger.IsEnabled(LogLevel.Trace));
            Assert.IsTrue(logger.IsEnabled(LogLevel.Debug));
            logger.BeginScope("scope")?.Dispose();
            logger.Log(
                LogLevel.Trace,
                new EventId(1),
                "disabled",
                null,
                static (state, _) => state
            );
            Assert.HasCount(0, Directory.GetFiles(temporary.Path));
        }

        /// <summary>Keeps credential and URL stores separate and rejects blank URLs.</summary>
        [TestMethod]
        public void ConfigurationStorageSeparatesTokensAndUrls()
        {
            TestUrlSettings url = new();
            TestTokenSettings token = new();
            TaskNotesConfigurationStorage storage = new(url, token);
            storage.Save("https://tasks.example", "secret");
            TaskNotesConfiguration loaded = storage.Load();
            Assert.AreEqual("https://tasks.example", loaded.ServerUrl);
            Assert.AreEqual("secret", loaded.Token);
            Assert.AreEqual(1, url.SaveCount);
            Assert.AreEqual(1, token.SaveCount);
            _ = Assert.ThrowsExactly<ArgumentException>(() => storage.Save(string.Empty, null));
        }

        /// <summary>Classifies expected boundary failures without exposing unexpected exceptions.</summary>
        [TestMethod]
        public void ExceptionPolicyOnlyReturnsAllowListedUserMessages()
        {
            Assert.AreEqual(
                "validation",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new Core.CoreException.Validation("validation")
                )
            );
            Assert.AreEqual(
                "invariant",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new Core.CoreException.Invariant("invariant")
                )
            );
            Assert.AreEqual(
                "network",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new Core.CoreException.Network("network")
                )
            );
            Assert.AreEqual(
                "api (HTTP 503)",
                TaskNotesExceptionPolicy.UserFacingMessage(new Core.CoreException.Api("api", 503))
            );
            Assert.AreEqual(
                "missing",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new Core.CoreException.NotFound("missing")
                )
            );
            Assert.AreEqual(
                "connection",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new Core.CoreException.Connection("connection")
                )
            );
            Assert.AreEqual(
                "argument",
                TaskNotesExceptionPolicy.UserFacingMessage(new ArgumentException("argument"))
            );
            Assert.AreEqual(
                "data",
                TaskNotesExceptionPolicy.UserFacingMessage(new InvalidDataException("data"))
            );
            Assert.AreEqual(
                "The operation was cancelled.",
                TaskNotesExceptionPolicy.UserFacingMessage(new OperationCanceledException())
            );
            Assert.IsNull(
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new InvalidOperationException("secret detail")
                )
            );
        }

        /// <summary>Builds every dynamic UI Automation identifier deterministically.</summary>
        [TestMethod]
        public void AutomationIdentifiersAreStable()
        {
            Assert.AreEqual("TaskNotes.Task.task.md", AutomationIds.TaskRow("task.md"));
            Assert.AreEqual("TaskNotes.Route.today", AutomationIds.Route("today"));
            Assert.AreEqual("TaskNotes.Board.done", AutomationIds.BoardColumn("done"));
            TaskTimeReading timing = new("task.md", 42, true);
            Assert.AreEqual("task.md", timing.TaskId);
            Assert.AreEqual(42u, timing.TotalMinutes);
            Assert.IsTrue(timing.HasActiveSession);
        }

        /// <summary>Sorts saved views and rejects duplicate IDs, blank names, and malformed core documents.</summary>
        [TestMethod]
        public async Task SavedViewStorageValidatesEveryPersistentContract()
        {
            using TemporaryDirectory directory = new();
            SavedViewDefinition template;
            await using (TaskNotesStore store = new(directory.Path))
            {
                await store.InitializeAsync(null, null, TestContext.CancellationToken);
                template = store.State.SavedViews[0];
            }
            FileHostStorage files = new(directory.Path);
            SavedViewStorage storage = new(files);
            SavedViewDefinition valid = template with { Id = "two", Name = "Two", Order = 2 };
            SavedViewDefinition first = template with { Id = "one", Name = "One", Order = 1 };
            storage.Save([valid, first]);
            Assert.AreSequenceEqual(["one", "two"], storage.Load().Select(view => view.Id));

            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(() =>
                storage.Save([first, first])
            );
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(() =>
                storage.Save([first with { Id = string.Empty }])
            );
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(() =>
                storage.Save([first with { Name = " " }])
            );
            _ = Assert.Throws<Core.CoreException>(() =>
                storage.Save([first with { FilterJson = "not json" }])
            );
            files.WriteSavedViews("{}");
            _ = Assert.ThrowsExactly<Core.CoreException.Validation>(storage.Load);
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }

        private sealed class TestUrlSettings : IServerUrlSettings
        {
            private string? _value;
            internal int SaveCount { get; private set; }

            public string? Load() => _value;

            public void Save(string serverUrl)
            {
                SaveCount++;
                _value = serverUrl;
            }
        }

        private sealed class TestTokenSettings : ITokenSettings
        {
            private string? _value;
            internal int SaveCount { get; private set; }

            public string? Load() => _value;

            public void Save(string? token)
            {
                SaveCount++;
                _value = token;
            }
        }
    }
}
