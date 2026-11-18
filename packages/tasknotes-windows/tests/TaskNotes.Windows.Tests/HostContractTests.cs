using System.Text.Json;
using Microsoft.Extensions.Logging;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Covers portable configuration, diagnostics classification, and UIA IDs.</summary>
    [TestClass]
    public sealed class HostContractTests
    {
        /// <summary>Keeps an unwritable diagnostics sink from failing the code that logs.</summary>
        [TestMethod]
        public void DiagnosticsSurviveAnUnwritableSink()
        {
            using TemporaryDirectory temporary = new();
            using JsonLineLoggerProvider provider = new(temporary.Path);
            string blocked = Path.Combine(
                temporary.Path,
                $"tasknotes-{DateTime.UtcNow:yyyyMMdd}-00.jsonl"
            );
            Directory.CreateDirectory(blocked);
            ILogger logger = provider.CreateLogger("TaskNotes.Unit");

            KeyValuePair<string, object?>[] state = [new("Operation", "refresh")];
            logger.Log(
                LogLevel.Warning,
                new EventId(1, "Sink"),
                state,
                null,
                static (_, _) => "ignored formatter output"
            );
            logger.Log(
                LogLevel.Warning,
                new EventId(2, "Sink"),
                state,
                null,
                static (_, _) => "ignored formatter output"
            );

            Assert.IsEmpty(Directory.GetFiles(temporary.Path));
        }

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
                    new FacetValidationException("validation")
                )
            );
            Assert.AreEqual(
                "auth",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new FacetAuthenticationException("auth", 401)
                )
            );
            Assert.AreEqual(
                "network",
                TaskNotesExceptionPolicy.UserFacingMessage(new FacetNetworkException("network"))
            );
            Assert.AreEqual(
                "api (HTTP 503)",
                TaskNotesExceptionPolicy.UserFacingMessage(new FacetApiException("api", 503))
            );
            Assert.AreEqual(
                "Local storage access was denied. Restore access before trying again.",
                TaskNotesExceptionPolicy.UserFacingMessage(
                    new UnauthorizedAccessException("denied")
                )
            );
            Assert.AreEqual(
                "Local storage could not be updated. Check available space and access before trying again.",
                TaskNotesExceptionPolicy.UserFacingMessage(new IOException("disk full"))
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

            Assert.AreEqual(
                "Update your Facet server token in Settings to resume background sync.",
                TaskNotesExceptionPolicy.BackgroundMessage(
                    new FacetAuthenticationException("auth", 401)
                )
            );
            Assert.AreEqual(
                "Facet server is offline; cached tasks remain available.",
                TaskNotesExceptionPolicy.BackgroundMessage(new FacetNetworkException("offline"))
            );
            Assert.AreEqual(
                "api (HTTP 502)",
                TaskNotesExceptionPolicy.BackgroundMessage(new FacetApiException("api", 502))
            );
            Assert.IsNull(
                TaskNotesExceptionPolicy.BackgroundMessage(
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
        }

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
