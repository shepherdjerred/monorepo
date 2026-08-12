using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.ApplicationModel.Activation;
using Windows.Storage;

namespace TaskNotes.Windows.App
{
    /// <summary>Provides dependency composition, diagnostics, and packaged activation.</summary>
    public partial class App : Application
    {
        private readonly IHost _host;
        private readonly ILogger<App> _logger;
        private readonly UiOperationQueue _uiOperations;
        private MainWindow? _window;

        /// <summary>Initializes application resources and the dependency composition root.</summary>
        public App()
        {
            InitializeComponent();
            string localFolder = ApplicationData.Current.LocalFolder.Path;
            JsonLineLoggerProvider diagnostics = new(Path.Combine(localFolder, "Logs"));
            _host = new HostBuilder()
                .ConfigureLogging(logging =>
                {
                    logging.ClearProviders();
                    logging.SetMinimumLevel(LogLevel.Debug);
                    logging.AddProvider(diagnostics);
                })
                .ConfigureServices(services =>
                {
                    services.AddSingleton<AppSettingsService>();
                    services.AddSingleton<IServerConfigurationStore>(provider =>
                        provider.GetRequiredService<AppSettingsService>()
                    );
                    services.AddSingleton<IShellPreferencesStore>(provider =>
                        provider.GetRequiredService<AppSettingsService>()
                    );
                    services.AddSingleton<IUiDispatcher>(_ => new WinUiDispatcher(
                        DispatcherQueue.GetForCurrentThread()
                            ?? throw new InvalidOperationException(
                                "TaskNotes must be composed on the WinUI thread."
                            )
                    ));
                    services.AddSingleton(provider => new UiOperationQueue(
                        DispatcherQueue.GetForCurrentThread()
                            ?? throw new InvalidOperationException(
                                "TaskNotes must be composed on the WinUI thread."
                            ),
                        provider.GetRequiredService<ILogger<UiOperationQueue>>()
                    ));
                    services.AddSingleton(provider => new TaskNotesStore(
                        Path.Combine(localFolder, "TaskNotes"),
                        provider.GetRequiredService<ILogger<TaskNotesStore>>()
                    ));
                    services.AddSingleton<ITaskNotesStore>(provider =>
                        provider.GetRequiredService<TaskNotesStore>()
                    );
                    services.AddSingleton<ShellViewModel>();
                    services.AddSingleton<TaskEditorViewModel>();
                    services.AddSingleton<QuickAddViewModel>();
                    services.AddSingleton<SettingsViewModel>();
                    services.AddSingleton<GlobalHotkeyViewModel>();
                    services.AddSingleton<PomodoroViewModel>();
                    services.AddSingleton<TimeReportViewModel>();
                    services.AddSingleton<MainWindow>();
                })
                .Build();
            _logger = _host.Services.GetRequiredService<ILogger<App>>();
            _uiOperations = _host.Services.GetRequiredService<UiOperationQueue>();
            UnhandledException += OnUnhandledException;
            AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        }

        /// <summary>Creates the main window or redirects activation to the existing process.</summary>
        protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
        {
            _uiOperations.Run("launch", () => LaunchAsync(args));
        }

        private async Task LaunchAsync(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
        {
            _ = args;
            await _host.StartAsync();
            AppActivationArguments activation = AppInstance.GetCurrent().GetActivatedEventArgs();
            AppInstance instance = AppInstance.FindOrRegisterForKey("TaskNotes.Main");
            if (!instance.IsCurrent)
            {
                await instance.RedirectActivationToAsync(activation);
                Exit();
                return;
            }

            instance.Activated += InstanceActivated;
            _window = _host.Services.GetRequiredService<MainWindow>();
            _window.Activate();
            await RouteActivationAsync(activation);
        }

        private void InstanceActivated(object? sender, AppActivationArguments args)
        {
            _ = sender;
            if (_window is not null)
            {
                _uiOperations.Run(
                    "redirected-activation",
                    () => EnqueueAsync(_window.DispatcherQueue, () => RouteActivationAsync(args))
                );
            }
        }

        private async Task RouteActivationAsync(AppActivationArguments args)
        {
            if (
                _window is not null
                && args.Kind == ExtendedActivationKind.Protocol
                && args.Data is IProtocolActivatedEventArgs protocol
            )
            {
                await _window.ActivateRouteAsync(protocol.Uri);
            }
        }

        private static async Task EnqueueAsync(DispatcherQueue dispatcher, Func<Task> operation)
        {
            ArgumentNullException.ThrowIfNull(dispatcher);
            ArgumentNullException.ThrowIfNull(operation);
            TaskCompletionSource<Task> scheduled = new(
                TaskCreationOptions.RunContinuationsAsynchronously
            );
            if (!dispatcher.TryEnqueue(() => scheduled.SetResult(operation())))
            {
                throw new InvalidOperationException(
                    "The TaskNotes UI dispatcher rejected activation work."
                );
            }
            Task operationTask = await scheduled.Task.ConfigureAwait(false);
            await operationTask.ConfigureAwait(false);
        }

        private void OnUnhandledException(
            object sender,
            Microsoft.UI.Xaml.UnhandledExceptionEventArgs args
        )
        {
            _ = sender;
            LogUnhandledUiException(_logger, args.Exception);
        }

        private void OnDomainUnhandledException(
            object? sender,
            System.UnhandledExceptionEventArgs args
        )
        {
            _ = sender;
            Exception? exception = args.ExceptionObject is Exception error ? error : null;
            LogUnhandledProcessException(_logger, exception);
        }

        private void OnUnobservedTaskException(
            object? sender,
            UnobservedTaskExceptionEventArgs args
        )
        {
            _ = sender;
            LogUnobservedTaskException(_logger, args.Exception);
        }

        [LoggerMessage(
            EventId = 1001,
            Level = LogLevel.Critical,
            Message = "TaskNotes encountered an unhandled UI exception."
        )]
        private static partial void LogUnhandledUiException(ILogger logger, Exception exception);

        [LoggerMessage(
            EventId = 1002,
            Level = LogLevel.Critical,
            Message = "TaskNotes encountered an unhandled process exception."
        )]
        private static partial void LogUnhandledProcessException(
            ILogger logger,
            Exception? exception
        );

        [LoggerMessage(
            EventId = 1003,
            Level = LogLevel.Critical,
            Message = "TaskNotes detected an unobserved task exception."
        )]
        private static partial void LogUnobservedTaskException(ILogger logger, Exception exception);
    }
}
