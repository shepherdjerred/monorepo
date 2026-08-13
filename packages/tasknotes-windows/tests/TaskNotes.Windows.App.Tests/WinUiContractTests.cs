using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.VisualStudio.TestTools.UnitTesting.AppContainer;
using TaskNotes.Windows.App.Views;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App.Tests
{
    /// <summary>Exercises WinUI thread affinity, accessibility properties, and local diagnostics.</summary>
    [TestClass]
    public sealed class WinUiContractTests
    {
        /// <summary>Gets or sets the active test context.</summary>
        public required TestContext TestContext { get; set; }

        /// <summary>Verifies standard WinUI controls publish stable UIA identity on the UI thread.</summary>
        [UITestMethod]
        public void StandardControlExposesAutomationContractOnUiThread()
        {
            Button button = new() { Content = "Refresh" };
            AutomationProperties.SetAutomationId(button, AutomationIds.Route("refresh"));
            AutomationProperties.SetName(button, "Refresh tasks");

            Assert.IsTrue(button.DispatcherQueue.HasThreadAccess);
            Assert.AreEqual(
                AutomationIds.Route("refresh"),
                AutomationProperties.GetAutomationId(button)
            );
            Assert.AreEqual("Refresh tasks", AutomationProperties.GetName(button));
        }

        /// <summary>Verifies the production dispatcher adapter preserves UI affinity.</summary>
        [UITestMethod]
        public void DispatcherRunsInlineWhenCalledFromTheUiThread()
        {
            WinUiDispatcher dispatcher = new(
                Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread()
                    ?? throw new InvalidOperationException("The WinUI dispatcher is unavailable.")
            );
            bool invoked = false;

            dispatcher.Enqueue(() => invoked = true);

            Assert.IsTrue(dispatcher.HasThreadAccess);
            Assert.IsTrue(invoked);
        }

        /// <summary>Verifies the production dispatcher crosses onto the WinUI thread.</summary>
        [UITestMethod]
        public async Task DispatcherEnqueuesFromAWorkerThread()
        {
            WinUiDispatcher dispatcher = new(
                Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread()
                    ?? throw new InvalidOperationException("The WinUI dispatcher is unavailable.")
            );
            TaskCompletionSource completion = new(
                TaskCreationOptions.RunContinuationsAsynchronously
            );

            await Task.Run(
                () =>
                {
                    Assert.IsFalse(dispatcher.HasThreadAccess);
                    dispatcher.Enqueue(completion.SetResult);
                },
                TestContext.CancellationToken
            );
            await completion.Task.WaitAsync(TestContext.CancellationToken);
        }

        /// <summary>Verifies synchronous WinUI boundaries own and surface every asynchronous operation.</summary>
        [UITestMethod]
        public async Task UiOperationQueueDrainsSuccessAndReportsUnexpectedFailure()
        {
            Microsoft.UI.Dispatching.DispatcherQueue dispatcher =
                Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread()
                ?? throw new InvalidOperationException("The WinUI dispatcher is unavailable.");
            TaskCompletionSource success = new(TaskCreationOptions.RunContinuationsAsynchronously);
            TaskCompletionSource<(Exception Error, string Operation)> fatal = new(
                TaskCreationOptions.RunContinuationsAsynchronously
            );
            UiOperationQueue productionQueue = new(
                dispatcher,
                NullLogger<UiOperationQueue>.Instance
            );
            productionQueue.Run(
                "production-success",
                () =>
                {
                    success.SetResult();
                    return Task.CompletedTask;
                }
            );
            await success.Task.WaitAsync(TestContext.CancellationToken);
            await productionQueue.DrainAsync().WaitAsync(TestContext.CancellationToken);

            UiOperationQueue queue = new(
                dispatcher,
                NullLogger<UiOperationQueue>.Instance,
                (error, operation) => fatal.SetResult((error, operation))
            );

            InvalidOperationException expected = new("unexpected queue failure");
            queue.Run("failure", () => Task.FromException(expected));
            (Exception error, string operation) = await fatal.Task.WaitAsync(
                TestContext.CancellationToken
            );
            await queue.DrainAsync().WaitAsync(TestContext.CancellationToken);

            Assert.AreSame(expected, error);
            Assert.AreEqual("failure", operation);
            Assert.ThrowsExactly<ArgumentException>(() => queue.Run(" ", () => Task.CompletedTask));
        }

        /// <summary>Verifies extracted views accept portable models after XAML construction.</summary>
        [UITestMethod]
        public async Task ExtractedViewsRebindWhenPortableModelsAreAttached()
        {
            string directory = Path.Combine(
                Path.GetTempPath(),
                $"tasknotes-views-{Guid.NewGuid():N}"
            );
            TaskNotesStore store = new(directory);
            WinUiDispatcher dispatcher = new(
                Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread()
                    ?? throw new InvalidOperationException("The WinUI dispatcher is unavailable.")
            );
            using ShellViewModel shell = new(
                store,
                dispatcher,
                NullLogger<ShellViewModel>.Instance
            );
            using SettingsViewModel settings = new(store, new EmptyConfiguration(), dispatcher);
            using TaskEditorViewModel editor = new(store, dispatcher);
            try
            {
                BoardView boardView = new();
                SettingsView settingsView = new();
                TaskEditorView editorView = new();
                QuickAddView quickAddView = new();
                TaskListWorkspaceView taskListView = new();
                QuickAddViewModel quickAdd = new(store);
                Assert.IsNull(boardView.ViewModel);
                Assert.IsNull(settingsView.ShellViewModel);
                Assert.IsNull(settingsView.ViewModel);
                Assert.IsNull(editorView.ViewModel);
                Assert.IsNull(quickAddView.ViewModel);
                Assert.IsNull(taskListView.ViewModel);
                Assert.IsNull(taskListView.EditorViewModel);

                boardView.ViewModel = shell;
                settingsView.ShellViewModel = shell;
                settingsView.ViewModel = settings;
                editorView.ViewModel = editor;
                quickAddView.ViewModel = quickAdd;
                taskListView.ViewModel = shell;
                taskListView.EditorViewModel = editor;

                Assert.AreSame(shell, boardView.ViewModel);
                Assert.AreSame(shell, settingsView.ShellViewModel);
                Assert.AreSame(settings, settingsView.ViewModel);
                Assert.AreSame(editor, editorView.ViewModel);
                Assert.AreSame(quickAdd, quickAddView.ViewModel);
                Assert.AreSame(shell, taskListView.ViewModel);
                Assert.AreSame(editor, taskListView.EditorViewModel);

                TaskItem task = new(
                    "task.md",
                    "Task title",
                    null,
                    "open",
                    "Open",
                    "normal",
                    "Normal",
                    null,
                    null,
                    null,
                    null,
                    [],
                    [],
                    [],
                    null,
                    0,
                    false,
                    false,
                    false,
                    false,
                    false,
                    null,
                    string.Empty,
                    false
                );
                editorView.Load(task);

                Assert.AreEqual("Task title", editor.Title);
                Assert.AreEqual(Visibility.Visible, editorView.Visibility);
            }
            finally
            {
                await store.DisposeAsync();
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, true);
                }
            }
        }

        /// <summary>Verifies hotkey parsing is ordinal, deterministic, and rejects unsafe bindings.</summary>
        [TestMethod]
        public void HotkeyBindingRequiresModifierAndAsciiKey()
        {
            Assert.IsTrue(
                typeof(IGlobalHotkeyRegistrar).IsAssignableFrom(typeof(GlobalHotkeyService))
            );
            HotkeyBinding binding = HotkeyBinding.Parse("Ctrl+Alt+n");

            Assert.AreEqual(0x0003u, binding.Modifiers);
            Assert.AreEqual((uint)'N', binding.VirtualKey);
            HotkeyBinding alternate = HotkeyBinding.Parse("Shift+Win+7");
            Assert.AreEqual(0x000Cu, alternate.Modifiers);
            Assert.AreEqual((uint)'7', alternate.VirtualKey);
            Assert.ThrowsExactly<ArgumentException>(() => HotkeyBinding.Parse("N"));
            Assert.ThrowsExactly<ArgumentException>(() => HotkeyBinding.Parse("Ctrl+F12"));
        }

        /// <summary>Verifies shell settings round-trip and reject corrupt persisted values.</summary>
        [TestMethod]
        public void ShellPreferencesCodecValidatesPersistenceSchema()
        {
            Dictionary<string, object> values = [];
            ShellPreferences expected = new("board", false, "Ctrl+Shift+K", 1440, 900);

            ShellPreferencesCodec.Save(values, expected);

            Assert.AreEqual(expected, ShellPreferencesCodec.Load(values));
            values["window-width"] = "wide";
            Assert.ThrowsExactly<InvalidDataException>(() => ShellPreferencesCodec.Load(values));
            values["window-width"] = 1440d;
            values["settings-schema-version"] = 2;
            Assert.ThrowsExactly<InvalidDataException>(() => ShellPreferencesCodec.Load(values));
        }

        /// <summary>Verifies defaults and bounds at the local-settings boundary.</summary>
        [TestMethod]
        public void ShellPreferencesCodecUsesValidatedDefaults()
        {
            ShellPreferences defaults = ShellPreferencesCodec.Load(
                new Dictionary<string, object>()
            );

            Assert.AreEqual("today", defaults.NavigationRoute);
            Assert.AreEqual("Ctrl+Alt+N", defaults.QuickAddHotkey);
            Assert.ThrowsExactly<InvalidDataException>(() =>
                ShellPreferencesCodec.Save(
                    new Dictionary<string, object>(),
                    defaults with
                    {
                        WindowWidth = 700,
                    }
                )
            );
            Assert.ThrowsExactly<InvalidDataException>(() =>
                ShellPreferencesCodec.Save(
                    new Dictionary<string, object>(),
                    defaults with
                    {
                        WindowHeight = 500,
                    }
                )
            );
            Assert.ThrowsExactly<InvalidDataException>(() =>
                ShellPreferencesCodec.Save(
                    new Dictionary<string, object>(),
                    defaults with
                    {
                        WindowWidth = 4000,
                    }
                )
            );
            Assert.ThrowsExactly<InvalidDataException>(() =>
                ShellPreferencesCodec.Save(
                    new Dictionary<string, object>(),
                    defaults with
                    {
                        WindowHeight = 2200,
                    }
                )
            );
        }

        /// <summary>Verifies local JSONL diagnostics never persist content or credential fields.</summary>
        [TestMethod]
        public void DiagnosticsAllowListRejectsContentAndSecrets()
        {
            string directory = Path.Combine(
                Path.GetTempPath(),
                $"tasknotes-logs-{Guid.NewGuid():N}"
            );
            try
            {
                using JsonLineLoggerProvider provider = new(directory);
                ILogger logger = provider.CreateLogger("TaskNotes.Test");
                KeyValuePair<string, object?>[] state =
                [
                    new("Operation", "refresh"),
                    new("StatusCode", 503),
                    new("Token", "bearer-secret"),
                    new("TaskTitle", "private task"),
                    new("Authorization", "Bearer hidden"),
                    new(
                        "{OriginalFormat}",
                        "{Operation} {StatusCode} {Token} {TaskTitle} {Authorization}"
                    ),
                ];
                logger.Log(
                    LogLevel.Warning,
                    new EventId(73, "Sync"),
                    state,
                    new InvalidOperationException("secret exception message"),
                    static (values, exception) =>
                        $"{values.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)} properties, {exception?.GetType().Name}"
                );

                string[] files = Directory.GetFiles(directory);
                Assert.HasCount(1, files);
                string log = File.ReadAllText(files[0]);
                using JsonDocument document = JsonDocument.Parse(log);
                JsonElement root = document.RootElement;
                Assert.AreEqual(
                    "System.InvalidOperationException",
                    root.GetProperty("ExceptionType").GetString()
                );
                JsonElement properties = root.GetProperty("Properties");
                Assert.AreEqual("refresh", properties.GetProperty("Operation").GetString());
                Assert.AreEqual(503, properties.GetProperty("StatusCode").GetInt32());
                Assert.IsFalse(log.Contains("bearer-secret", StringComparison.Ordinal));
                Assert.IsFalse(log.Contains("private task", StringComparison.Ordinal));
                Assert.IsFalse(log.Contains("Bearer hidden", StringComparison.Ordinal));
                Assert.IsFalse(log.Contains("secret exception message", StringComparison.Ordinal));
            }
            finally
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, true);
                }
            }
        }

        private sealed class EmptyConfiguration : IServerConfigurationStore
        {
            public ServerConfiguration Load() => new(null, null);

            public void Save(string serverUrl, string? token)
            {
                _ = serverUrl;
                _ = token;
            }
        }
    }
}
