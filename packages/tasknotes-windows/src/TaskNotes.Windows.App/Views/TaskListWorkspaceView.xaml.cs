using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Animation;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.UI.ViewManagement;

namespace TaskNotes.Windows.App.Views;

/// <summary>Native compact desktop list, query menus and responsive persistent inspector.</summary>
public sealed partial class TaskListWorkspaceView : UserControl
{
    /// <summary>Shell presentation dependency.</summary>
    public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
        nameof(ViewModel),
        typeof(ShellViewModel),
        typeof(TaskListWorkspaceView),
        new PropertyMetadata(null)
    );

    /// <summary>Inspector presentation dependency.</summary>
    public static readonly DependencyProperty EditorViewModelProperty = DependencyProperty.Register(
        nameof(EditorViewModel),
        typeof(TaskEditorViewModel),
        typeof(TaskListWorkspaceView),
        new PropertyMetadata(null)
    );

    /// <summary>Inline compose owns its own draft, independent from the Quick Add dialog.</summary>
    public static readonly DependencyProperty QuickAddViewModelProperty =
        DependencyProperty.Register(
            nameof(QuickAddViewModel),
            typeof(QuickAddViewModel),
            typeof(TaskListWorkspaceView),
            new PropertyMetadata(null)
        );
    private readonly HashSet<string> _selection = new(StringComparer.Ordinal);
    private readonly PresentationTokens _tokens = PresentationTokens.Bundled();
    private TaskListQuery _query = TaskListQuery.Today;
    private bool _restoringSelection;

    /// <summary>Initialize the compiled native surface.</summary>
    public TaskListWorkspaceView()
    {
        InitializeComponent();
        Composer.SubmitRequested += InlineAdd_Click;
    }

    /// <summary>Portable shell.</summary>
    public ShellViewModel? ViewModel
    {
        get => GetValue(ViewModelProperty) as ShellViewModel;
        set => SetValue(ViewModelProperty, value);
    }

    /// <summary>Portable editor.</summary>
    public TaskEditorViewModel? EditorViewModel
    {
        get => GetValue(EditorViewModelProperty) as TaskEditorViewModel;
        set => SetValue(EditorViewModelProperty, value);
    }

    /// <summary>Independent contextual capture draft.</summary>
    public QuickAddViewModel? QuickAddViewModel
    {
        get => GetValue(QuickAddViewModelProperty) as QuickAddViewModel;
        set => SetValue(QuickAddViewModelProperty, value);
    }

    internal event RoutedEventHandler? RefreshRequested;
    internal event Action<string>? SearchChanged;
    internal event Action<string>? SearchSubmitted;
    internal event Action<string>? SortChanged;
    internal event Action<string>? GroupChanged;
    internal event Action<TaskListQuery>? QueryChanged;
    internal event RoutedEventHandler? SaveViewRequested;
    internal event RoutedEventHandler? NewTaskRequested;
    internal event RoutedEventHandler? InlineAddRequested;
    internal event RoutedEventHandler? InspectorRequested;
    internal event RoutedEventHandler? CompleteSelectedRequested;
    internal event RoutedEventHandler? ScheduleSelectedRequested;
    internal event RoutedEventHandler? PrioritizeSelectedRequested;
    internal event RoutedEventHandler? DeleteSelectedRequested;
    internal event RoutedEventHandler? UndoRequested;
    internal event RoutedEventHandler? CompletionRequested;
    internal event RoutedEventHandler? EditTaskRequested;
    internal event RoutedEventHandler? ScheduleTaskRequested;
    internal event RoutedEventHandler? DeleteTaskRequested;
    internal event RoutedEventHandler? MoveStatusRequested;
    internal event Action<TaskItem>? TaskInvoked;
    internal TaskEditorView Editor => InspectorPane;
    internal QuickAddView Composer => InlineComposer;
    internal string SearchText
    {
        get => SearchBox.Text;
        set => SearchBox.Text = value;
    }
    internal bool InspectorVisible
    {
        get => InspectorPane.Visibility == Visibility.Visible;
        set
        {
            InspectorPane.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
            UpdatePaneLayout();
        }
    }

    internal void SetDestination(string title, string subtitle)
    {
        DestinationTitle.Text = title;
        ToolTipService.SetToolTip(DestinationTitle, subtitle);
        _selection.Clear();
    }

    internal void SetQueryControls(TaskListQuery query)
    {
        _query = query;
        foreach (var item in SortMenu.Items.OfType<RadioMenuFlyoutItem>())
            item.IsChecked = item.Tag as string == query.Sort.ToString();
        foreach (var item in GroupMenu.Items.OfType<RadioMenuFlyoutItem>())
            item.IsChecked = item.Tag as string == query.Group.ToString();
        DescendingMenuItem.IsChecked = query.Descending;
    }

    internal void SetStatus(string message, PresentationStatusSeverity severity, bool canUndo)
    {
        StatusText.Text = message;
        UndoButton.IsEnabled = canUndo;
        StatusBar.IsOpen =
            severity != PresentationStatusSeverity.Success || ViewModel?.State.PendingCount > 0;
        StatusBar.Severity = severity switch
        {
            PresentationStatusSeverity.Error => InfoBarSeverity.Error,
            PresentationStatusSeverity.Warning => InfoBarSeverity.Warning,
            PresentationStatusSeverity.Success => InfoBarSeverity.Success,
            PresentationStatusSeverity.Information => InfoBarSeverity.Informational,
            _ => throw new InvalidOperationException($"Unknown presentation severity {severity}."),
        };
        EmptyState.Visibility =
            ViewModel?.VisibleTasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        _ = DispatcherQueue.TryEnqueue(RestoreSelection);
        RaiseLiveRegionChanged(StatusText);
    }

    internal void ShowError(string message)
    {
        StatusText.Text = message;
        StatusBar.IsOpen = true;
        StatusBar.Severity = InfoBarSeverity.Error;
        RaiseLiveRegionChanged(StatusText);
    }

    internal void SetSavedNotice(FacetSavedNotice? notice, string? maintenance)
    {
        SavedText.Text = string.Join(
            Environment.NewLine,
            (notice?.Messages ?? []).Concat(maintenance is null ? [] : [maintenance])
        );
        SavedBar.IsOpen = notice is not null || maintenance is not null;
        if (SavedBar.IsOpen)
            RaiseLiveRegionChanged(SavedText);
    }

    internal void FocusSearch(FocusState state) => _ = SearchBox.Focus(state);

    internal TaskItem[] SelectedTaskRows() =>
        TaskList.SelectedItems.OfType<TaskRowPresentation>().Select(row => row.Task).ToArray();

    private void TaskList_SelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        _ = sender;
        if (!_restoringSelection)
        {
            foreach (var row in args.AddedItems.OfType<TaskRowPresentation>())
                _selection.Add(RowKey(row.Task));
            // Replacing an immutable projection removes the old row object; retain its selection
            // until the new revision arrives. A user deselection still has a live item.
            foreach (var row in args.RemovedItems.OfType<TaskRowPresentation>())
                if (TaskList.Items.Contains(row))
                    _selection.Remove(RowKey(row.Task));
        }
        bool enabled = TaskList.SelectedItems.Count > 0;
        CompleteSelectedButton.IsEnabled =
            ScheduleSelectedButton.IsEnabled =
            PrioritizeSelectedButton.IsEnabled =
            DeleteSelectedButton.IsEnabled =
                enabled;
    }

    private void RestoreSelection()
    {
        _restoringSelection = true;
        try
        {
            var rows = TaskList.Items.OfType<TaskRowPresentation>().ToArray();
            _selection.IntersectWith(rows.Select(row => RowKey(row.Task)));
            foreach (var row in rows.Where(row => _selection.Contains(RowKey(row.Task))))
                if (!TaskList.SelectedItems.Contains(row))
                    TaskList.SelectedItems.Add(row);
        }
        finally
        {
            _restoringSelection = false;
        }
    }

    private static string RowKey(TaskItem task) =>
        string.Join("\u001f", task.ProfileId, task.Id, task.OccurrenceDate);

    private void TaskList_ItemClick(object sender, ItemClickEventArgs args)
    {
        _ = sender;
        if (args.ClickedItem is TaskRowPresentation row)
            TaskInvoked?.Invoke(row.Task);
    }

    private void FilterMenu_Opening(object sender, object args)
    {
        _ = sender;
        _ = args;
        FilterMenu.Items.Clear();
        if (ViewModel is not { } model)
            return;
        AddFilters(
            "Status",
            model.State.StatusChoices,
            _query.Statuses,
            values => _query with { Statuses = values }
        );
        AddFilters(
            "Priority",
            model.State.PriorityChoices,
            _query.Priorities,
            values => _query with { Priorities = values }
        );
        AddFilters(
            "Projects",
            model.State.Projects.Select(value => new WorkflowChoice(value, value)),
            _query.Projects,
            values => _query with { Projects = values }
        );
        AddFilters(
            "Contexts",
            model.State.Contexts.Select(value => new WorkflowChoice(value, value)),
            _query.Contexts,
            values => _query with { Contexts = values }
        );
        AddFilters(
            "Tags",
            model.State.Tags.Select(value => new WorkflowChoice(value, value)),
            _query.Tags,
            values => _query with { Tags = values }
        );
        var noDue = new ToggleMenuFlyoutItem
        {
            Text = "Without a due date",
            IsChecked = _query.HasNoDueDate,
        };
        noDue.Click += (_, _) =>
            QueryChanged?.Invoke(_query with { HasNoDueDate = noDue.IsChecked });
        FilterMenu.Items.Add(noDue);
        FilterMenu.Items.Add(new MenuFlyoutSeparator());
        var clear = new MenuFlyoutItem { Text = "Clear filters" };
        clear.Click += (_, _) =>
            QueryChanged?.Invoke(
                _query with
                {
                    Statuses = [],
                    Priorities = [],
                    Projects = [],
                    Contexts = [],
                    Tags = [],
                    HasNoDueDate = false,
                }
            );
        FilterMenu.Items.Add(clear);
    }

    private void AddFilters(
        string label,
        IEnumerable<WorkflowChoice> choices,
        IReadOnlyList<string> selected,
        Func<IReadOnlyList<string>, TaskListQuery> update
    )
    {
        var submenu = new MenuFlyoutSubItem { Text = label };
        foreach (var choice in choices)
        {
            var item = new ToggleMenuFlyoutItem
            {
                Text = choice.Label,
                IsChecked = selected.Contains(choice.Value, StringComparer.Ordinal),
            };
            item.Click += (_, _) =>
                QueryChanged?.Invoke(
                    update(
                        item.IsChecked
                            ? [.. selected, choice.Value]
                            : selected.Where(value => value != choice.Value).ToArray()
                    )
                );
            submenu.Items.Add(item);
        }
        if (submenu.Items.Count > 0)
            FilterMenu.Items.Add(submenu);
    }

    private void Workspace_SizeChanged(object sender, SizeChangedEventArgs args)
    {
        _ = sender;
        _ = args;
        UpdatePaneLayout();
    }

    private void UpdatePaneLayout()
    {
        double width = _tokens.Number("desktop", "inspector", "ideal");
        bool narrow = ActualWidth < width + 360;
        InspectorPane.Width = Math.Min(width, Math.Max(0, ActualWidth));
        Grid.SetColumn(InspectorPane, narrow ? 0 : 1);
        Grid.SetColumnSpan(InspectorPane, narrow ? 2 : 1);
        InspectorPane.HorizontalAlignment = HorizontalAlignment.Right;
        InspectorColumn.Width = narrow ? new GridLength(0) : GridLength.Auto;
    }

    private void Row_PointerEntered(object sender, PointerRoutedEventArgs args)
    {
        _ = args;
        SetRowActions((Grid)sender, true);
    }

    private void Row_PointerExited(object sender, PointerRoutedEventArgs args)
    {
        _ = args;
        var row = (Grid)sender;
        if (!ContainsFocus(row))
            SetRowActions(row, false);
    }

    private void Row_GotFocus(object sender, RoutedEventArgs args)
    {
        _ = args;
        SetRowActions((Grid)sender, true);
    }

    private void Row_LostFocus(object sender, RoutedEventArgs args)
    {
        _ = args;
        var row = (Grid)sender;
        if (!ContainsFocus(row))
            SetRowActions(row, false);
    }

    private bool ContainsFocus(Grid row)
    {
        DependencyObject? focused = FocusManager.GetFocusedElement(XamlRoot) as DependencyObject;
        while (focused is not null)
        {
            if (ReferenceEquals(focused, row))
                return true;
            focused = Microsoft.UI.Xaml.Media.VisualTreeHelper.GetParent(focused);
        }
        return false;
    }

    private void SetRowActions(Grid row, bool visible)
    {
        if (row.FindName("RowActions") is not FrameworkElement actions)
            throw new InvalidOperationException("The row action area is missing.");
        if (!new UISettings().AnimationsEnabled)
        {
            actions.Opacity = visible ? 1 : 0;
            return;
        }
        var animation = new DoubleAnimation
        {
            To = visible ? 1 : 0,
            Duration = TimeSpan.FromMilliseconds(_tokens.Number("motion", "milliseconds", "hover")),
        };
        Storyboard.SetTarget(animation, actions);
        Storyboard.SetTargetProperty(animation, "Opacity");
        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Begin();
    }

    private void Refresh_Click(object sender, RoutedEventArgs args) =>
        RefreshRequested?.Invoke(sender, args);

    private void SearchBox_TextChanged(
        AutoSuggestBox sender,
        AutoSuggestBoxTextChangedEventArgs args
    )
    {
        if (args.Reason == AutoSuggestionBoxTextChangeReason.UserInput)
            SearchChanged?.Invoke(sender.Text);
    }

    private void SearchBox_QuerySubmitted(
        AutoSuggestBox sender,
        AutoSuggestBoxQuerySubmittedEventArgs args
    )
    {
        _ = args;
        SearchSubmitted?.Invoke(sender.Text);
    }

    private void SortMenu_Click(object sender, RoutedEventArgs args)
    {
        _ = args;
        SortChanged?.Invoke((string)((RadioMenuFlyoutItem)sender).Tag);
    }

    private void GroupMenu_Click(object sender, RoutedEventArgs args)
    {
        _ = args;
        GroupChanged?.Invoke((string)((RadioMenuFlyoutItem)sender).Tag);
    }

    private void Descending_Click(object sender, RoutedEventArgs args)
    {
        _ = sender;
        _ = args;
        QueryChanged?.Invoke(_query with { Descending = DescendingMenuItem.IsChecked });
    }

    private void SaveView_Click(object sender, RoutedEventArgs args) =>
        SaveViewRequested?.Invoke(sender, args);

    private void NewTask_Click(object sender, RoutedEventArgs args) =>
        NewTaskRequested?.Invoke(sender, args);

    private void InlineAdd_Click(object sender, RoutedEventArgs args) =>
        InlineAddRequested?.Invoke(sender, args);

    private void CompleteSelected_Click(object sender, RoutedEventArgs args) =>
        CompleteSelectedRequested?.Invoke(sender, args);

    private void ScheduleSelected_Click(object sender, RoutedEventArgs args) =>
        ScheduleSelectedRequested?.Invoke(sender, args);

    private void PrioritizeSelected_Click(object sender, RoutedEventArgs args) =>
        PrioritizeSelectedRequested?.Invoke(sender, args);

    private void DeleteSelected_Click(object sender, RoutedEventArgs args) =>
        DeleteSelectedRequested?.Invoke(sender, args);

    private void Undo_Click(object sender, RoutedEventArgs args) =>
        UndoRequested?.Invoke(sender, args);

    private void Inspector_Click(object sender, RoutedEventArgs args) =>
        InspectorRequested?.Invoke(sender, args);

    private void Completion_Click(object sender, RoutedEventArgs args) =>
        CompletionRequested?.Invoke(sender, args);

    private void EditTask_Click(object sender, RoutedEventArgs args) =>
        EditTaskRequested?.Invoke(sender, args);

    private void ScheduleTask_Click(object sender, RoutedEventArgs args) =>
        ScheduleTaskRequested?.Invoke(sender, args);

    private void DeleteTask_Click(object sender, RoutedEventArgs args) =>
        DeleteTaskRequested?.Invoke(sender, args);

    private void MoveStatus_Click(object sender, RoutedEventArgs args) =>
        MoveStatusRequested?.Invoke(sender, args);

    private static void RaiseLiveRegionChanged(FrameworkElement element)
    {
        var peer =
            FrameworkElementAutomationPeer.FromElement(element) as FrameworkElementAutomationPeer
            ?? new FrameworkElementAutomationPeer(element);
        peer.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
    }
}
