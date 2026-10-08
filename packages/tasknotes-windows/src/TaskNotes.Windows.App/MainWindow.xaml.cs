using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.VisualStudio.Threading;
using TaskNotes.Windows.App.Views;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Graphics;

namespace TaskNotes.Windows.App
{
    /// <summary>Hosts every native TaskNotes destination and auxiliary-window command.</summary>
    public sealed partial class MainWindow : Window, System.IAsyncDisposable
    {
        private static readonly string[] ConflictVersions = ["base", "local", "remote"];
        private readonly AsyncManualResetEvent _initialized = new();
        private readonly AppSettingsService _settings;
        private readonly ILogger<MainWindow> _logger;
        private readonly UiOperationQueue _uiOperations;
        private readonly QuickAddViewModel _quickAdd;
        private readonly TaskEditorViewModel _taskEditor;
        private readonly FacetSettingsViewModel _settingsViewModel;
        private readonly GlobalHotkeyViewModel _globalHotkey;
        private readonly PomodoroViewModel _pomodoro;
        private readonly TimeReportViewModel _timeReport;
        private readonly FacetReminderDelivery _reminders;
        private TaskListQuery _query = TaskListQuery.Today;
        private PomodoroWindow? _pomodoroWindow;
        private TimeReportWindow? _timeReportWindow;
        private bool _loaded;
        private string _navigationRoute = "today";
        private CancellationTokenSource? SearchCancellation { get; set; }

        /// <summary>Initializes the packaged application window and shared store.</summary>
        internal MainWindow(
            FacetTaskNotesStore store,
            ShellViewModel viewModel,
            AppSettingsService settings,
            ILogger<MainWindow> logger,
            UiOperationQueue uiOperations,
            QuickAddViewModel quickAdd,
            TaskEditorViewModel taskEditor,
            FacetSettingsViewModel settingsViewModel,
            GlobalHotkeyViewModel globalHotkey,
            PomodoroViewModel pomodoro,
            TimeReportViewModel timeReport
        )
        {
            Store = store ?? throw new ArgumentNullException(nameof(store));
            ViewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _uiOperations = uiOperations ?? throw new ArgumentNullException(nameof(uiOperations));
            _quickAdd = quickAdd ?? throw new ArgumentNullException(nameof(quickAdd));
            _taskEditor = taskEditor ?? throw new ArgumentNullException(nameof(taskEditor));
            _settingsViewModel =
                settingsViewModel ?? throw new ArgumentNullException(nameof(settingsViewModel));
            _globalHotkey = globalHotkey ?? throw new ArgumentNullException(nameof(globalHotkey));
            _pomodoro = pomodoro ?? throw new ArgumentNullException(nameof(pomodoro));
            _timeReport = timeReport ?? throw new ArgumentNullException(nameof(timeReport));
            _reminders = new FacetReminderDelivery(Store);
            InitializeComponent();
            BoardDestination.Initialize(_uiOperations, RunUiOperationAsync);
            TaskWorkspace.Editor.Initialize(
                _uiOperations,
                RunUiOperationAsync,
                ConfirmAsync,
                ShowValidationMessage
            );
            TaskWorkspace.OpenPomodoroRequested += OpenPomodoro_Click;
            TaskWorkspace.OpenTimeReportRequested += OpenTimeReport_Click;
            TaskWorkspace.RefreshRequested += Refresh_Click;
            TaskWorkspace.SearchChanged += SearchBox_TextChanged;
            TaskWorkspace.SearchSubmitted += SearchBox_QuerySubmitted;
            TaskWorkspace.SortChanged += SortComboBox_SelectionChanged;
            TaskWorkspace.GroupChanged += GroupComboBox_SelectionChanged;
            TaskWorkspace.SaveViewRequested += SaveView_Click;
            TaskWorkspace.NewTaskRequested += NewTask_Click;
            TaskWorkspace.CompleteSelectedRequested += CompleteSelected_Click;
            TaskWorkspace.ScheduleSelectedRequested += ScheduleSelected_Click;
            TaskWorkspace.PrioritizeSelectedRequested += PrioritizeSelected_Click;
            TaskWorkspace.DeleteSelectedRequested += DeleteSelected_Click;
            TaskWorkspace.UndoRequested += Undo_Click;
            TaskWorkspace.CompletionRequested += Completion_Click;
            TaskWorkspace.TaskInvoked += TaskWorkspace_TaskInvoked;
            TaskWorkspace.EditTaskRequested += EditTask_Click;
            TaskWorkspace.DeleteTaskRequested += DeleteTask_Click;
            TaskWorkspace.MoveStatusRequested += MoveStatus_Click;
            SettingsDestination.SaveRequested += SaveSettings_Click;
            SettingsDestination.ConnectVaultRequested += ConnectVault_Click;
            SettingsDestination.SelectProfileRequested += SelectProfile_Click;
            SettingsDestination.RemoveProfileRequested += RemoveProfile_Click;
            SettingsDestination.LocalFolderRequested += LocalFolder_Click;
            SettingsDestination.SignOutRequested += SignOut_Click;
            SettingsDestination.ReauthorizeRequested += Reauthorize_Click;
            SettingsDestination.EnableRemindersRequested += EnableReminders_Click;
            SettingsDestination.DisableRemindersRequested += DisableReminders_Click;
            SettingsDestination.EnableBackgroundSyncRequested += EnableBackgroundSync_Click;
            SettingsDestination.DisableBackgroundSyncRequested += DisableBackgroundSync_Click;
            SettingsDestination.ApplyHotkeyRequested += RegisterHotkey_Click;
            SettingsDestination.ClearHotkeyRequested += ClearHotkey_Click;
            SettingsDestination.CreateSavedViewRequested += CreateSavedView_Click;
            SettingsDestination.RestoreSavedViewsRequested += RestoreSavedViews_Click;
            SettingsDestination.DuplicateSavedViewRequested += DuplicateSavedView_Click;
            SettingsDestination.MoveSavedViewRequested += MoveSavedView_Click;
            SettingsDestination.DeleteSavedViewRequested += DeleteSavedView_Click;
            SettingsDestination.RetryParkedRequested += RetryParked_Click;
            SettingsDestination.DiscardParkedRequested += DiscardParked_Click;
            SettingsDestination.ResumeActionRequested += ResumeAction_Click;
            SettingsDestination.RetireActionRequested += RetireAction_Click;
            SettingsDestination.ReviewConflictRequested += ReviewConflict_Click;
#if TASKNOTES_E2E
            Title = "TaskNotes E2E";
            AppTitleBar.Title = "TaskNotes E2E";
#endif
            ExtendsContentIntoTitleBar = true;
            SetTitleBar(AppTitleBar);
            AppWindow.SetIcon("Assets/AppIcon.ico");
            Store.StateChanged += Store_StateChanged;
            RootGrid.Loaded += RootGrid_Loaded;
            Closed += MainWindow_Closed;
        }

        /// <summary>Gets the UI-facing serialized Rust engine store.</summary>
        public FacetTaskNotesStore Store { get; }

        /// <summary>Gets the portable shell presentation model.</summary>
        public ShellViewModel ViewModel { get; }

        internal Task<bool> ConfirmCloseAsync() => TaskWorkspace.Editor.ConfirmDiscardAsync();

        /// <summary>Fence and drain owned reminder effects before the store and writer lease close.</summary>
        public async ValueTask DisposeAsync()
        {
            await _reminders.DisposeAsync().ConfigureAwait(false);
            GC.SuppressFinalize(this);
        }

        internal void DisableInteractions()
        {
            Navigation.IsEnabled = false;
            TaskWorkspace.IsEnabled = false;
            SettingsDestination.IsEnabled = false;
            _pomodoroWindow?.Close();
            _timeReportWindow?.Close();
            ReleaseResources();
        }

        /// <summary>Navigates an activated application instance to a TaskNotes protocol URI.</summary>
        public async Task ActivateRouteAsync(Uri uri)
        {
            ArgumentNullException.ThrowIfNull(uri);
            await _initialized.WaitAsync();
#if TASKNOTES_E2E
            Uri routeUri = string.Equals(uri.Scheme, "tasknotes-e2e", StringComparison.Ordinal)
                ? new Uri($"tasknotes://{uri.Host}{uri.AbsolutePath}{uri.Query}")
                : uri;
#else
            Uri routeUri = uri;
#endif
            ActivationRoute activation = ActivationRouteParser.Parse(routeUri);
            string route = activation.Action;
            switch (route)
            {
                case "inbox":
                case "today":
                case "upcoming":
                case "browse":
                case "completed":
                case "kanban":
                case "settings":
                    await NavigateAsync(route == "kanban" ? "board" : route);
                    break;
                case "search":
                    await NavigateAsync("browse");
                    TaskWorkspace.SearchText = activation.Query ?? string.Empty;
                    await ApplyQueryAsync(_query with { Search = TaskWorkspace.SearchText });
                    TaskWorkspace.FocusSearch(FocusState.Programmatic);
                    break;
                case "quick-add":
                    await ShowQuickAddAsync(activation.Query ?? string.Empty);
                    break;
                case "pomodoro":
                    await ShowPomodoroAsync();
                    break;
                case "time-report":
                    await ShowTimeReportAsync();
                    break;
                case "tasks":
                    if (!await TaskWorkspace.Editor.ConfirmDiscardAsync())
                        return;
                    string? owningProfile = QueryParameter(routeUri, "profile");
                    if (owningProfile is not null)
                    {
                        if (!Store.Profiles.Any(profile => profile.Id == owningProfile))
                        {
                            ShowValidationMessage(
                                "The reminder's vault is no longer available on this device."
                            );
                            return;
                        }
                        if (Store.SelectedProfileId != owningProfile)
                        {
                            if (
                                !await RunUiOperationAsync(() =>
                                    Store.SelectProfileAsync(owningProfile)
                                )
                            )
                                return;
                            TaskWorkspace.Editor.Clear();
                        }
                    }
                    await NavigateAsync("browse");
                    TaskItem? activatedTask = owningProfile is null
                        ? activation.Value is string taskId
                            ? FindTask(taskId)
                            : null
                        : Store.State.AllTasks.SingleOrDefault(task =>
                            task.VaultPath == activation.Value && task.ProfileId == owningProfile
                        );
                    if (activatedTask is TaskItem task)
                    {
                        TaskWorkspace.Editor.Load(task);
                    }
                    else if (owningProfile is not null)
                        ShowValidationMessage(
                            "The reminder's task has moved or is no longer available. Refresh its vault to review it."
                        );
                    break;
                case "projects":
                case "contexts":
                case "tags":
                case "saved-views":
                    if (activation.Value is string scope)
                    {
                        string prefix = route switch
                        {
                            "projects" => "project",
                            "contexts" => "context",
                            "tags" => "tag",
                            "saved-views" => "saved",
                            _ => throw new InvalidOperationException($"Unknown route {route}."),
                        };
                        await NavigateAsync($"{prefix}:{Uri.UnescapeDataString(scope)}");
                    }
                    break;
#if TASKNOTES_E2E
                case "diagnostics":
                    if (activation.Value == "reset")
                    {
                        string nonce =
                            QueryParameter(uri, "nonce")
                            ?? throw new ArgumentException(
                                "The E2E reset route requires a nonce.",
                                nameof(uri)
                            );
                        _settings.ResetForE2E();
                        await Store.ReconfigureAsync(null, null);
                        await NavigateAsync("settings");
                        await File.WriteAllTextAsync(
                            Path.Combine(
                                global::Windows.Storage.ApplicationData.Current.LocalFolder.Path,
                                "e2e-reset.txt"
                            ),
                            nonce
                        );
                    }
                    break;
#endif
                default:
                    throw new ArgumentException(
                        $"Unsupported TaskNotes route '{route}'.",
                        nameof(uri)
                    );
            }
            Activate();
        }

        private void RootGrid_Loaded(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            if (_loaded)
            {
                return;
            }
            _loaded = true;
            _uiOperations.Run("initialize-main-window", InitializeMainWindowAsync);
        }

        private async Task InitializeMainWindowAsync()
        {
            ShellPreferences shell = _settings.LoadShell();
            AppWindow.Resize(
                new SizeInt32(
                    checked((int)Math.Clamp(shell.WindowWidth, 800, 3840)),
                    checked((int)Math.Clamp(shell.WindowHeight, 600, 2160))
                )
            );
            SettingsDestination.Hotkey = shell.QuickAddHotkey;
            InitializeGlobalHotkey(shell.QuickAddHotkey);

            bool initialized = await RunUiOperationAsync(() => Store.InitializeAsync(null, null));
            if (!initialized)
            {
                _initialized.Set();
                return;
            }
            await NavigateAsync(shell.NavigationRoute);
            await _settingsViewModel.ReloadAsync();
            TaskWorkspace.InspectorVisible = shell.InspectorVisible;
            _initialized.Set();
        }

        private void MainWindow_Closed(object sender, WindowEventArgs args)
        {
            _ = sender;
            _ = args;
            _settings.Save(
                new ShellPreferences(
                    _navigationRoute,
                    TaskWorkspace.InspectorVisible,
                    SettingsDestination.Hotkey.Trim(),
                    AppWindow.Size.Width,
                    AppWindow.Size.Height
                )
            );
            ReleaseResources();
            ViewModel.Dispose();
            _settingsViewModel.Dispose();
            _pomodoroWindow?.Close();
            _timeReportWindow?.Close();
        }

        private void Store_StateChanged(object? sender, EventArgs e)
        {
            _ = sender;
            _ = e;
            if (!DispatcherQueue.HasThreadAccess)
            {
                _ = DispatcherQueue.TryEnqueue(UpdateState);
                return;
            }
            UpdateState();
        }

        private void UpdateState()
        {
            TaskNotesState state = Store.State;
            string statusMessage = ViewModel.StatusMessage;
            TaskWorkspace.SetStatus(
                statusMessage,
                ViewModel.StatusSeverity,
                state.CanUndoCompletion
            );
            SettingsDestination.ConnectionStatus = statusMessage;
            TaskWorkspace.SetSavedNotice(ViewModel.SavedNotice, ViewModel.SavedMaintenance);
            SettingsDestination.SetBackgroundStatus(FacetBackgroundRegistration.Status);
            SettingsDestination.SetReminderStatus(FacetReminderDelivery.Status);
            UpdateDynamicNavigation(state);
            TaskWorkspace.Editor.Refresh(state);
        }

        private void Navigation_ItemInvoked(
            NavigationView sender,
            NavigationViewItemInvokedEventArgs args
        )
        {
            _ = sender;
            if (args.InvokedItemContainer?.Tag is not string destination)
            {
                return;
            }
            if (destination == "pomodoro")
            {
                _uiOperations.Run("open-pomodoro", ShowPomodoroAsync);
                return;
            }
            if (destination == "time-report")
            {
                _uiOperations.Run("open-time-report", ShowTimeReportAsync);
                return;
            }
            _uiOperations.Run("navigate", () => NavigateAsync(destination));
        }

        private async Task NavigateAsync(string destination)
        {
            if (!await TaskWorkspace.Editor.ConfirmDiscardAsync())
            {
                return;
            }
            bool retainSearch = string.Equals(
                destination,
                _navigationRoute,
                StringComparison.Ordinal
            );
            await ViewModel.NavigateAsync(destination);
            _navigationRoute = destination;
            TaskWorkspace.Visibility = Visibility.Collapsed;
            BoardDestination.Visibility = Visibility.Collapsed;
            SettingsDestination.Visibility = Visibility.Collapsed;
            if (ViewModel.Route.Destination == PresentationDestination.Settings)
            {
                SettingsDestination.Visibility = Visibility.Visible;
                SettingsDestination.FocusAccount();
                return;
            }
            if (ViewModel.Route.Destination == PresentationDestination.Board)
            {
                BoardDestination.Visibility = Visibility.Visible;
                _query = ViewModel.CurrentQuery;
                return;
            }
            TaskWorkspace.Visibility = Visibility.Visible;
            _query = ViewModel.CurrentQuery with
            {
                Search = retainSearch ? TaskWorkspace.SearchText : string.Empty,
            };
            TaskWorkspace.SetDestination(ViewModel.Route.Title, ViewModel.Route.Subtitle);
            await ApplyQueryAsync(_query);
        }

        private async Task ApplyQueryAsync(TaskListQuery query)
        {
            _query = query;
            TaskWorkspace.SetQueryControls(query);
            _ = await RunUiOperationAsync(() => ViewModel.ApplyQueryAsync(query));
        }

        private void SearchBox_TextChanged(string search)
        {
            SearchCancellation?.Cancel();
            SearchCancellation?.Dispose();
            SearchCancellation = new CancellationTokenSource();
            CancellationToken cancellationToken = SearchCancellation.Token;
            _uiOperations.Run(
                "search",
                async () =>
                {
                    try
                    {
                        await Task.Delay(200, cancellationToken);
                        await ApplyQueryAsync(_query with { Search = search });
                    }
                    catch (OperationCanceledException)
                        when (cancellationToken.IsCancellationRequested)
                    {
                        return;
                    }
                }
            );
        }

        private void SearchBox_QuerySubmitted(string search)
        {
            _uiOperations.Run(
                "submit-search",
                () => ApplyQueryAsync(_query with { Search = search })
            );
        }

        private void SortComboBox_SelectionChanged(string raw)
        {
            _uiOperations.Run(
                "change-sort",
                () => ApplyQueryAsync(_query with { Sort = Enum.Parse<TaskSortChoice>(raw) })
            );
        }

        private void GroupComboBox_SelectionChanged(string raw)
        {
            _uiOperations.Run(
                "change-group",
                () => ApplyQueryAsync(_query with { Group = Enum.Parse<TaskGroupChoice>(raw) })
            );
        }

        private void NewTask_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("open-quick-add", () => ShowQuickAddAsync(string.Empty));
        }

        private async Task ShowQuickAddAsync(string initialText)
        {
            _quickAdd.SetContext(_query);
            _quickAdd.Input = initialText;
            bool addAnother;
            do
            {
                QuickAddView content = new() { ViewModel = _quickAdd };
                content.Initialize(_uiOperations, RunUiOperationAsync);
                ContentDialog dialog = new()
                {
                    XamlRoot = RootGrid.XamlRoot,
                    Title = "Quick Add",
                    Content = content,
                    PrimaryButtonText = "Save",
                    SecondaryButtonText = "Save & Add Another",
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.Primary,
                };
                AutomationProperties.SetAutomationId(dialog, "TaskNotes.QuickAdd.Dialog");
                dialog.Opened += (_, _) => content.FocusInput();
                ContentDialogResult result = await dialog.ShowAsync();
                addAnother = result == ContentDialogResult.Secondary;
                if (result is ContentDialogResult.Primary or ContentDialogResult.Secondary)
                {
                    bool modelSaved = false;
                    if (
                        !await RunUiOperationAsync(async () =>
                        {
                            modelSaved = await _quickAdd.SaveAsync(addAnother);
                        })
                    )
                    {
                        return;
                    }
                    if (!modelSaved)
                    {
                        ShowValidationMessage(
                            _quickAdd.ValidationError
                                ?? "Quick Add validation failed without a message."
                        );
                        return;
                    }
                }
            } while (addAnother);
        }

        private void Completion_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is CheckBox checkbox && checkbox.Tag is string taskId)
            {
                _uiOperations.Run(
                    "set-completion",
                    () =>
                        RunUiOperationAsync(() =>
                            Store.SetCompletionAsync(taskId, checkbox.IsChecked == true)
                        )
                );
            }
        }

        private void CompleteSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            string[] taskIds = SelectedTaskIds();
            if (taskIds.Length > 0)
            {
                _uiOperations.Run(
                    "complete-selected",
                    () => RunUiOperationAsync(() => Store.CompleteTasksAsync(taskIds))
                );
            }
        }

        private void ScheduleSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "schedule-selected",
                async () =>
                {
                    TextBox input = new()
                    {
                        Header = "Scheduled date",
                        PlaceholderText = "YYYY-MM-DD; leave empty to clear",
                    };
                    if (await ShowInputDialogAsync("Schedule selected tasks", input, "Apply"))
                    {
                        _ = await RunUiOperationAsync(() =>
                            Store.ScheduleTasksAsync(SelectedTaskIds(), NullIfBlank(input.Text))
                        );
                    }
                }
            );
        }

        private void PrioritizeSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "prioritize-selected",
                async () =>
                {
                    ComboBox input = new() { Header = "Priority", SelectedIndex = 2 };
                    foreach (
                        string priorityOption in Store.State.PriorityChoices.Select(choice =>
                            choice.Value
                        )
                    )
                    {
                        input.Items.Add(priorityOption);
                    }
                    ContentDialog dialog = Dialog("Prioritize selected tasks", input, "Apply");
                    if (
                        await dialog.ShowAsync() == ContentDialogResult.Primary
                        && input.SelectedItem is string selectedPriority
                    )
                    {
                        _ = await RunUiOperationAsync(() =>
                            Store.PrioritizeTasksAsync(SelectedTaskIds(), selectedPriority)
                        );
                    }
                }
            );
        }

        private void DeleteSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "delete-selected",
                async () =>
                {
                    string[] ids = SelectedTaskIds();
                    if (
                        ids.Length > 0
                        && await ConfirmAsync(
                            "Delete tasks?",
                            $"Delete {ids.Length} selected task(s)? This cannot be undone."
                        )
                    )
                    {
                        _ = await RunUiOperationAsync(() => Store.DeleteTasksAsync(ids));
                    }
                }
            );
        }

        private void Undo_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "undo-completion",
                () => RunUiOperationAsync(() => Store.UndoCompletionAsync())
            );
        }

        private void Refresh_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("refresh", () => RunUiOperationAsync(() => Store.RefreshAsync()));
        }

        private void TaskWorkspace_TaskInvoked(TaskItem task)
        {
            _uiOperations.Run("open-task", () => LoadTaskAsync(task));
        }

        private void EditTask_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && TaskFromElement(element) is TaskItem task)
            {
                _uiOperations.Run("open-task", () => LoadTaskAsync(task));
            }
        }

        // Both selection paths reach the editor, so both have to offer the same discard
        // prompt navigation does. Calling Load directly overwrote every edited field and
        // lost the previous task's changes without asking.
        private async Task LoadTaskAsync(TaskItem task)
        {
            if (!await TaskWorkspace.Editor.ConfirmDiscardAsync())
            {
                return;
            }
            TaskWorkspace.Editor.Load(task);
        }

        private void DeleteTask_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && TaskFromElement(element) is TaskItem task)
            {
                _uiOperations.Run(
                    "delete-task",
                    async () =>
                    {
                        if (
                            await ConfirmAsync(
                                "Delete task?",
                                "This task will be removed from its Markdown vault."
                            )
                        )
                        {
                            _ = await RunUiOperationAsync(() => Store.DeleteTaskAsync(task.Id));
                        }
                    }
                );
            }
        }

        private void MoveStatus_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && TaskFromElement(element) is TaskItem task)
            {
                _uiOperations.Run(
                    "move-status",
                    async () =>
                    {
                        ComboBox choices = new()
                        {
                            ItemsSource = Store.State.StatusChoices,
                            DisplayMemberPath = "Label",
                            SelectedValuePath = "Value",
                            SelectedValue = task.Status,
                        };
                        ContentDialog dialog = new()
                        {
                            XamlRoot = RootGrid.XamlRoot,
                            Title = "Move task to status",
                            Content = choices,
                            PrimaryButtonText = "Move",
                            CloseButtonText = "Cancel",
                        };
                        if (
                            await dialog.ShowAsync() == ContentDialogResult.Primary
                            && choices.SelectedValue is string status
                        )
                            await RunUiOperationAsync(() => Store.SetStatusAsync(task.Id, status));
                    }
                );
            }
        }

        private void SaveView_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("save-view", CreateSavedViewFromQueryAsync);
        }

        private void CreateSavedView_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("create-saved-view", CreateSavedViewFromQueryAsync);
        }

        private async Task CreateSavedViewFromQueryAsync()
        {
            TextBox name = new() { Header = "Name", PlaceholderText = "My view" };
            CheckBox favorite = new() { Content = "Favorite" };
            StackPanel content = new() { Spacing = 8 };
            content.Children.Add(name);
            content.Children.Add(favorite);
            ContentDialog dialog = Dialog("Save current query", content, "Save");
            if (
                await dialog.ShowAsync() == ContentDialogResult.Primary
                && !string.IsNullOrWhiteSpace(name.Text)
            )
            {
                _ = await RunUiOperationAsync(async () =>
                {
                    SavedViewDefinition view = await Store.CreateSavedViewAsync(
                        name.Text,
                        "Filter",
                        "Accent",
                        favorite.IsChecked == true,
                        _query
                    );
                    await NavigateAsync($"saved:{view.Id}");
                });
            }
        }

        private void DuplicateSavedView_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && element.Tag is string id)
            {
                _uiOperations.Run(
                    "duplicate-saved-view",
                    () => RunUiOperationAsync(() => Store.DuplicateSavedViewAsync(id))
                );
            }
        }

        private void MoveSavedView_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && element.Tag is string id)
            {
                SavedViewDefinition? view = Store.State.SavedViews.SingleOrDefault(item =>
                    item.Id == id
                );
                if (view is not null)
                {
                    _uiOperations.Run(
                        "move-saved-view",
                        () =>
                            RunUiOperationAsync(() =>
                                Store.MoveSavedViewAsync(id, Math.Max(0, view.Order - 1))
                            )
                    );
                }
            }
        }

        private void DeleteSavedView_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is FrameworkElement element && element.Tag is string id)
            {
                _uiOperations.Run(
                    "delete-saved-view",
                    async () =>
                    {
                        if (await ConfirmAsync("Delete saved view?", "Tasks are not deleted."))
                        {
                            _ = await RunUiOperationAsync(() => Store.DeleteSavedViewAsync(id));
                        }
                    }
                );
            }
        }

        private void RestoreSavedViews_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "restore-saved-views",
                async () =>
                {
                    if (
                        await ConfirmAsync(
                            "Restore default saved views?",
                            "This replaces portable saved-view documents in the selected vault."
                        )
                    )
                    {
                        _ = await RunUiOperationAsync(() => Store.RestoreDefaultSavedViewsAsync());
                    }
                }
            );
        }

        private void SaveSettings_Click(object sender, RoutedEventArgs e)
        {
            FacetBackgroundRegistration.Disable();
            _reminders.FenceAccountChange();
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "save-settings",
                async () =>
                {
                    try
                    {
                        await RunUiOperationAsync(() =>
                            _settingsViewModel.SignInAsync(
                                SettingsDestination.Email,
                                SettingsDestination.Password,
                                SettingsDestination.Mfa
                            )
                        );
                    }
                    finally
                    {
                        SettingsDestination.ClearAccountSecrets();
                        _reminders.AccountChangeObserved();
                    }
                }
            );
        }

        private void ConnectVault_Click(object sender, RoutedEventArgs e)
        {
            _uiOperations.Run(
                "connect-vault",
                async () =>
                {
                    if (SettingsDestination.SelectedVault is not ObsidianVaultChoice vault)
                    {
                        ShowValidationMessage("Choose an existing Sync vault.");
                        return;
                    }
                    try
                    {
                        await RunUiOperationAsync(() =>
                            _settingsViewModel.AddRemoteAsync(
                                vault,
                                SettingsDestination.VaultPassword,
                                SettingsDestination.ApproveStandard
                            )
                        );
                    }
                    finally
                    {
                        SettingsDestination.ClearVaultPassword();
                    }
                }
            );
        }

        private void SelectProfile_Click(object sender, RoutedEventArgs e)
        {
            if (SettingsDestination.SelectedProfile is FacetProfileRegistration profile)
                _uiOperations.Run(
                    "select-profile",
                    async () =>
                    {
                        if (!await TaskWorkspace.Editor.ConfirmDiscardAsync())
                            return;
                        if (
                            await RunUiOperationAsync(() =>
                                _settingsViewModel.SelectAsync(profile.Id)
                            )
                        )
                            TaskWorkspace.Editor.Clear();
                    }
                );
        }

        private void RemoveProfile_Click(object sender, RoutedEventArgs e)
        {
            if (SettingsDestination.SelectedProfile is not FacetProfileRegistration profile)
                return;
            _uiOperations.Run(
                "remove-profile",
                async () =>
                {
                    if (!await TaskWorkspace.Editor.ConfirmDiscardAsync())
                        return;
                    var confirm = Dialog(
                        $"Remove {profile.Name}?",
                        "Facet stops synchronization and removes this vault's settled app state and access key. Files remain intact. Resolve pending uploads, conflicts and saved actions first.",
                        "Remove vault"
                    );
                    if (await confirm.ShowAsync() != ContentDialogResult.Primary)
                        return;
                    FacetBackgroundRegistration.Disable();
                    _reminders.FenceAccountChange();
                    try
                    {
                        await RunUiOperationAsync(() => _settingsViewModel.RemoveAsync(profile.Id));
                    }
                    finally
                    {
                        _reminders.AccountChangeObserved();
                    }
                }
            );
        }

        private void SignOut_Click(object sender, RoutedEventArgs e)
        {
            FacetBackgroundRegistration.Disable();
            _reminders.FenceAccountChange();
            _uiOperations.Run(
                "sign-out",
                async () =>
                {
                    try
                    {
                        await RunUiOperationAsync(() => _settingsViewModel.SignOutAsync());
                    }
                    finally
                    {
                        _reminders.AccountChangeObserved();
                    }
                }
            );
        }

        private void Reauthorize_Click(object sender, RoutedEventArgs e)
        {
            FacetBackgroundRegistration.Disable();
            if (SettingsDestination.SelectedProfile is not FacetProfileRegistration profile)
                return;
            _reminders.FenceAccountChange();
            _uiOperations.Run(
                "reauthorize-profile",
                async () =>
                {
                    try
                    {
                        await RunUiOperationAsync(() =>
                            _settingsViewModel.ReauthorizeAsync(
                                profile.Id,
                                SettingsDestination.VaultPassword
                            )
                        );
                    }
                    finally
                    {
                        SettingsDestination.ClearVaultPassword();
                        _reminders.AccountChangeObserved();
                    }
                }
            );
        }

        private void EnableReminders_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            _uiOperations.Run(
                "enable-reminders",
                () =>
                {
                    _reminders.Enable();
                    SettingsDestination.SetReminderStatus(FacetReminderDelivery.Status);
                    return Task.CompletedTask;
                }
            );
        }

        private void EnableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            SetBackgroundSync(true, sender, args);

        private void DisableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            SetBackgroundSync(false, sender, args);

        private void SetBackgroundSync(bool enabled, object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            _uiOperations.Run(
                "background-sync-preference",
                () =>
                {
                    FacetBackgroundRegistration.SetSyncRequested(enabled);
                    SettingsDestination.SetBackgroundStatus(FacetBackgroundRegistration.Status);
                    return Task.CompletedTask;
                }
            );
        }

        private void DisableReminders_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            _uiOperations.Run(
                "disable-reminders",
                () =>
                {
                    _reminders.Disable();
                    SettingsDestination.SetReminderStatus(FacetReminderDelivery.Status);
                    return Task.CompletedTask;
                }
            );
        }

        private void LocalFolder_Click(object sender, RoutedEventArgs e)
        {
            _uiOperations.Run(
                "open-local-folder",
                async () =>
                {
                    global::Windows.Storage.Pickers.FolderPicker picker = new();
                    picker.FileTypeFilter.Add("*");
                    WinRT.Interop.InitializeWithWindow.Initialize(
                        picker,
                        WinRT.Interop.WindowNative.GetWindowHandle(this)
                    );
                    var folder = await picker.PickSingleFolderAsync();
                    if (folder is not null)
                        await RunUiOperationAsync(() =>
                            _settingsViewModel.AddLocalAsync(
                                folder.Name,
                                folder.Path,
                                SettingsDestination.ApproveStandard
                            )
                        );
                }
            );
        }

        private void RetryParked_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is Button button && button.Tag is string mutationId)
            {
                _uiOperations.Run(
                    "retry-parked",
                    () => ConfirmConflictAsync(mutationId, "keep_local")
                );
            }
        }

        private void ResumeAction_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is Button button && button.Tag is string id)
                _uiOperations.Run(
                    "resume-retained-action",
                    () => RunUiOperationAsync(() => _settingsViewModel.ResumeAsync(id))
                );
        }

        private void RetireAction_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is Button button && button.Tag is string id)
                _uiOperations.Run(
                    "retire-rejected-action",
                    async () =>
                    {
                        if (
                            await ConfirmAsync(
                                "Retire rejected action?",
                                "Rust must confirm this action is absent or parked. Pending/applied actions and preserved conflict versions stay retained."
                            )
                        )
                            await RunUiOperationAsync(() =>
                                _settingsViewModel.RetireRejectedAsync(id)
                            );
                    }
                );
        }

        private void DiscardParked_Click(object sender, RoutedEventArgs e)
        {
            _ = e;
            if (sender is Button button && button.Tag is string mutationId)
            {
                _uiOperations.Run(
                    "discard-parked",
                    () => ConfirmConflictAsync(mutationId, "keep_remote")
                );
            }
        }

        private async Task ConfirmConflictAsync(string id, string choice)
        {
            var conflict = _settingsViewModel.Conflicts.Single(c => c.Id == id);
            var version = choice == "keep_local" ? conflict.Local : conflict.Remote;
            string message = version is null
                ? $"Keep the deletion of {conflict.Path}?"
                : $"Keep the {(choice == "keep_local" ? "local" : "remote")} version of {conflict.Path}? Review the retained versions before choosing.";
            if (await ConfirmAsync("Resolve conflict?", message))
                _ = await RunUiOperationAsync(() => _settingsViewModel.ResolveAsync(id, choice));
        }

        private void ReviewConflict_Click(object sender, RoutedEventArgs args)
        {
            _ = args;
            if (sender is Button button && button.Tag is string id)
                _uiOperations.Run(
                    "review-conflict",
                    async () =>
                    {
                        var conflict = _settingsViewModel.Conflicts.Single(c => c.Id == id);
                        List<string> parts = [];
                        foreach (string version in ConflictVersions)
                        {
                            byte[]? bytes = await Store.ReadConflictPayloadAsync(id, version);
                            parts.Add(version.ToUpperInvariant() + "\n" + ConflictPreview(bytes));
                        }
                        TextBox preview = new()
                        {
                            Text = string.Join("\n\n", parts),
                            IsReadOnly = true,
                            AcceptsReturn = true,
                            TextWrapping = TextWrapping.Wrap,
                            MaxHeight = 480,
                        };
                        ContentDialog dialog = Dialog(
                            conflict.Path,
                            new ScrollViewer
                            {
                                Content = preview,
                                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                            },
                            "Close"
                        );
                        _ = await dialog.ShowAsync();
                    }
                );
        }

        private static string ConflictPreview(byte[]? bytes)
        {
            if (bytes is null)
                return "Deleted file";
            int count = Math.Min(bytes.Length, 65536);
            for (int omitted = 0; omitted <= 3 && count >= omitted; omitted++)
                try
                {
                    string text = new UTF8Encoding(false, true).GetString(
                        bytes,
                        0,
                        count - omitted
                    );
                    return count < bytes.Length ? text + "\n[Preview truncated]" : text;
                }
                catch (DecoderFallbackException) { }
            return "Binary file. Both immutable versions remain retained.";
        }

        private void OpenPomodoro_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("open-pomodoro", ShowPomodoroAsync);
        }

        private async Task ShowPomodoroAsync()
        {
            if (_pomodoroWindow is null)
            {
                PomodoroWindow window = new(_pomodoro, _uiOperations);
                window.AppWindow.Closing += (_, _) => _pomodoroWindow = null;
                _pomodoroWindow = window;
            }
            _pomodoroWindow.Activate();
            await _pomodoroWindow.LoadAsync();
        }

        private void OpenTimeReport_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("open-time-report", ShowTimeReportAsync);
        }

        private async Task ShowTimeReportAsync()
        {
            if (_timeReportWindow is null)
            {
                TimeReportWindow window = new(
                    _timeReport,
                    _uiOperations,
                    async (profile, path) =>
                    {
                        var task =
                            Store.State.AllTasks.SingleOrDefault(row =>
                                row.ProfileId == profile && row.VaultPath == path
                            )
                            ?? throw new ArgumentException(
                                "Refresh the vault before opening this running task."
                            );
                        await LoadTaskAsync(task);
                        Activate();
                    }
                );
                window.AppWindow.Closing += (_, _) => _timeReportWindow = null;
                _timeReportWindow = window;
            }
            _timeReportWindow.Activate();
            await _timeReportWindow.LoadAsync();
        }

        private void InitializeGlobalHotkey(string binding)
        {
            nint windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(this);
            _globalHotkey.Attach(
                new GlobalHotkeyService(
                    windowHandle,
                    () =>
                    {
                        if (
                            !DispatcherQueue.TryEnqueue(() =>
                            {
                                Activate();
                                _uiOperations.Run(
                                    "global-quick-add",
                                    () => ShowQuickAddAsync(string.Empty)
                                );
                            })
                        )
                        {
                            throw new InvalidOperationException(
                                "The UI dispatcher rejected the global Quick Add command."
                            );
                        }
                    }
                )
            );
            if (!string.IsNullOrWhiteSpace(binding))
            {
                _globalHotkey.Register(binding);
                SettingsDestination.HotkeyStatus = _globalHotkey.Status;
            }
        }

        private void RegisterHotkey_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _globalHotkey.Register(SettingsDestination.Hotkey);
            SettingsDestination.Hotkey = _globalHotkey.Binding;
            SettingsDestination.HotkeyStatus = _globalHotkey.Status;
        }

        private void ClearHotkey_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _globalHotkey.Clear();
            SettingsDestination.Hotkey = _globalHotkey.Binding;
            SettingsDestination.HotkeyStatus = _globalHotkey.Status;
        }

        private void UpdateDynamicNavigation(TaskNotesState state)
        {
            PopulateNavigationGroup(
                SavedViewsNavigationItem,
                state.SavedViews.Select(view => (view.Name, $"saved:{view.Id}"))
            );
            PopulateNavigationGroup(
                ProjectsNavigationItem,
                state.Projects.Select(project => (project, $"project:{project}"))
            );
            PopulateNavigationGroup(
                ContextsNavigationItem,
                state.Contexts.Select(context => (context, $"context:{context}"))
            );
            PopulateNavigationGroup(
                TagsNavigationItem,
                state.Tags.Select(tag => (tag, $"tag:{tag}"))
            );
        }

        private static void PopulateNavigationGroup(
            NavigationViewItem parent,
            IEnumerable<(string Label, string Route)> values
        )
        {
            (string Label, string Route)[] desired = [.. values];
            string[] current =
            [
                .. parent
                    .MenuItems.OfType<NavigationViewItem>()
                    .Select(item => item.Tag as string ?? string.Empty),
            ];
            if (current.SequenceEqual(desired.Select(item => item.Route), StringComparer.Ordinal))
            {
                return;
            }
            parent.MenuItems.Clear();
            foreach ((string label, string route) in desired)
            {
                NavigationViewItem item = new() { Content = label, Tag = route };
                AutomationProperties.SetAutomationId(item, AutomationIds.Route(route));
                parent.MenuItems.Add(item);
            }
        }

        private void NewAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            _uiOperations.Run("new-accelerator", () => ShowQuickAddAsync(string.Empty));
        }

        private void RefreshAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            _uiOperations.Run(
                "refresh-accelerator",
                () => RunUiOperationAsync(() => ViewModel.RefreshCommand.ExecuteAsync(null))
            );
        }

        private void SearchAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            TaskWorkspace.FocusSearch(FocusState.Keyboard);
        }

        private void UndoAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            _uiOperations.Run(
                "undo-accelerator",
                () => RunUiOperationAsync(() => ViewModel.UndoCompletionCommand.ExecuteAsync(null))
            );
        }

        private void PomodoroAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            _uiOperations.Run("pomodoro-accelerator", ShowPomodoroAsync);
        }

        private void TimeReportAccelerator_Invoked(
            KeyboardAccelerator sender,
            KeyboardAcceleratorInvokedEventArgs args
        )
        {
            _ = sender;
            args.Handled = true;
            _uiOperations.Run("time-report-accelerator", ShowTimeReportAsync);
        }

        private async Task<bool> RunUiOperationAsync(Func<Task> operation)
        {
            try
            {
                await operation();
                return true;
            }
            catch (Exception exception)
            {
                string? message = TaskNotesExceptionPolicy.UserFacingMessage(exception);
                if (message is null)
                {
                    LogUnexpectedUiOperation(_logger, exception);
                    throw;
                }
                LogExpectedUiOperationFailure(_logger);
                SettingsDestination.ConnectionStatus = message;
                TaskWorkspace.ShowError(message);
                return false;
            }
        }

        private void ShowValidationMessage(string message)
        {
            SettingsDestination.ConnectionStatus = message;
            TaskWorkspace.ShowError(message);
        }

        [LoggerMessage(
            EventId = 1100,
            Level = LogLevel.Critical,
            Message = "Unexpected TaskNotes UI operation failure."
        )]
        private static partial void LogUnexpectedUiOperation(ILogger logger, Exception exception);

        [LoggerMessage(
            EventId = 1101,
            Level = LogLevel.Warning,
            Message = "TaskNotes UI operation returned an expected boundary failure."
        )]
        private static partial void LogExpectedUiOperationFailure(ILogger logger);

        private void ReleaseResources()
        {
            SearchCancellation?.Cancel();
            SearchCancellation?.Dispose();
            SearchCancellation = null;
            _globalHotkey.Dispose();
        }

        private ContentDialog Dialog(string title, object content, string primaryButton)
        {
            return new ContentDialog
            {
                XamlRoot = RootGrid.XamlRoot,
                Title = title,
                Content = content,
                PrimaryButtonText = primaryButton,
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
            };
        }

        private async Task<bool> ShowInputDialogAsync(
            string title,
            Control input,
            string primaryButton
        )
        {
            return await Dialog(title, input, primaryButton).ShowAsync()
                == ContentDialogResult.Primary;
        }

        private async Task<bool> ConfirmAsync(string title, string message)
        {
            ContentDialog dialog = Dialog(
                title,
                new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap },
                "Continue"
            );
            return await dialog.ShowAsync() == ContentDialogResult.Primary;
        }

        private TaskItem? FindTask(string taskId)
        {
            return Store.State.AllTasks.SingleOrDefault(task => task.Id == taskId);
        }

        private TaskItem? TaskFromElement(FrameworkElement element)
        {
            return element.Tag is string taskId
                ? FindTask(taskId)
                : element.DataContext as TaskItem;
        }

        private string[] SelectedTaskIds()
        {
            return TaskWorkspace.SelectedTaskIds();
        }

        private static string? NullIfBlank(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static string[] SplitValues(string value)
        {
            return
            [
                .. value
                    .Split(
                        ',',
                        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                    )
                    .Distinct(StringComparer.Ordinal),
            ];
        }

        private static string? QueryParameter(Uri uri, string name)
        {
            foreach (
                string component in uri
                    .Query.TrimStart('?')
                    .Split('&', StringSplitOptions.RemoveEmptyEntries)
            )
            {
                string[] pair = component.Split('=', 2);
                if (
                    pair.Length > 0
                    && Uri.UnescapeDataString(pair[0])
                        .Equals(name, StringComparison.OrdinalIgnoreCase)
                )
                {
                    return pair.Length == 2
                        ? Uri.UnescapeDataString(pair[1].Replace('+', ' '))
                        : string.Empty;
                }
            }
            return null;
        }
    }
}
