using Microsoft.Testing.Platform.Builder;
using Microsoft.UI.Xaml;
using Microsoft.VisualStudio.TestTools.UnitTesting.AppContainer;

namespace TaskNotes.Windows.App.Tests
{
    /// <summary>Self-hosted MTP WinUI application that provides the XAML dispatcher under test.</summary>
    public sealed partial class TestApplication : Application
    {
        private Task? _testRun;
        private TestWindow? _window;

        /// <summary>Initializes the XAML application resources.</summary>
        public TestApplication()
        {
            InitializeComponent();
        }

        /// <inheritdoc />
        protected override void OnLaunched(LaunchActivatedEventArgs args)
        {
            _ = args;
            _window = new TestWindow();
            _window.Activate();
            UITestMethodAttribute.DispatcherQueue = _window.DispatcherQueue;
            _testRun = RunTestsAsync();
        }

        private async Task RunTestsAsync()
        {
            try
            {
                string[] commandLine = Environment
                    .GetCommandLineArgs()
                    .Skip(1)
                    .Where(argument =>
                        !argument.Contains("EnableMSTestRunner", StringComparison.Ordinal)
                    )
                    .ToArray();
                ITestApplicationBuilder builder =
                    await Microsoft.Testing.Platform.Builder.TestApplication.CreateBuilderAsync(
                        commandLine
                    );
                builder.AddSelfRegisteredExtensions(commandLine);
                using ITestApplication application = await builder.BuildAsync();
                Environment.ExitCode = await application.RunAsync();
            }
            catch (Exception exception)
            {
                Environment.ExitCode = 1;
                if (
                    _window?.DispatcherQueue.TryEnqueue(() =>
                        throw new InvalidOperationException(
                            "The TaskNotes WinUI test host failed unexpectedly.",
                            exception
                        )
                    ) != true
                )
                {
                    Environment.FailFast(
                        "The TaskNotes WinUI test host lost its dispatcher.",
                        exception
                    );
                }
            }
            finally
            {
                if (
                    _window?.DispatcherQueue.TryEnqueue(() =>
                    {
                        _window.Close();
                        Exit();
                    }) != true
                )
                {
                    Environment.Exit(Environment.ExitCode);
                }
            }
        }
    }
}
