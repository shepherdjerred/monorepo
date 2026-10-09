using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.UI.ViewManagement;

namespace TaskNotes.Windows.App.Views;

public sealed partial class TaskListWorkspaceView
{
    private readonly AppliedOutcomeNotice _outcomeNotice = new();
    private DispatcherTimer? _outcomeTimer;
    private Func<bool>? _outcomeOwns;
    private Func<bool>? _outcomeCanUndo;
    private IReadOnlyList<string> _savedWarnings = [];
    private string? _savedMaintenance;
    private bool _outcomeHovered;

    internal void ShowAppliedOutcome(
        FacetAppliedFeedback feedback,
        Func<bool> owns,
        Func<bool> canUndo
    )
    {
        _outcomeNotice.Show(feedback, NativeFeedbackAccessibility.ConfirmationDuration());
        _outcomeOwns = owns;
        _outcomeCanUndo = canUndo;
        _outcomeTimer ??= CreateOutcomeTimer();
        _outcomeTimer.Start();
        RenderOutcomeNotice();
        AnimateAppliedRows(feedback);
    }

    private DispatcherTimer CreateOutcomeTimer()
    {
        SavedBar.PointerEntered += (_, _) => _outcomeHovered = true;
        SavedBar.PointerExited += (_, _) => _outcomeHovered = false;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (_, _) =>
        {
            if (
                !_outcomeNotice.Advance(
                    OutcomeHasFocus() || _outcomeHovered,
                    _outcomeOwns?.Invoke() == true
                )
            )
                timer.Stop();
            RenderOutcomeNotice();
        };
        Unloaded += (_, _) => timer.Stop();
        return timer;
    }

    private bool OutcomeHasFocus()
    {
        var focused =
            Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(XamlRoot) as DependencyObject;
        while (focused is not null)
        {
            if (ReferenceEquals(focused, SavedBar))
                return true;
            focused = VisualTreeHelper.GetParent(focused);
        }
        return false;
    }

    private void RenderOutcomeNotice()
    {
        string previousTitle = SavedBar.Title;
        string previousText = SavedText.Text;
        bool wasOpen = SavedBar.IsOpen;
        SavedBar.Title = _outcomeNotice.Outcome is null ? "Saved" : _outcomeNotice.Title;
        SavedText.Text = string.Join(
            Environment.NewLine,
            _savedWarnings.Concat(_savedMaintenance is null ? [] : [_savedMaintenance])
        );
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(
            SavedText,
            string.Join(
                ". ",
                new[] { SavedBar.Title, SavedText.Text }.Where(value => value.Length > 0)
            )
        );
        SavedBar.IsOpen =
            _outcomeNotice.Outcome is not null
            || _savedWarnings.Count > 0
            || _savedMaintenance is not null;
        SavedUndoButton.Tag = _outcomeNotice.Outcome?.Owner.MutationId;
        SavedUndoButton.Visibility =
            _outcomeNotice.Outcome is not null && _outcomeCanUndo?.Invoke() == true
                ? Visibility.Visible
                : Visibility.Collapsed;
        if (
            SavedBar.IsOpen
            && (!wasOpen || previousText != SavedText.Text || previousTitle != SavedBar.Title)
        )
            RaiseLiveRegionChanged(SavedText);
    }

    private void AnimateAppliedRows(FacetAppliedFeedback feedback)
    {
        if (
            !new UISettings().AnimationsEnabled
            || feedback.Event is not ("completed" or "reopened" or "deleted")
        )
            return;
        TaskList.ItemContainerTransitions =
        [
            new AddDeleteThemeTransition(),
            new RepositionThemeTransition(),
        ];
        foreach (var item in TaskList.Items.OfType<TaskRowPresentation>())
        {
            if (
                feedback.Paths?.Contains(item.Task.VaultPath, StringComparer.Ordinal) != true
                || TaskList.ContainerFromItem(item) is not ListViewItem container
            )
                continue;
            var animation = new DoubleAnimation
            {
                From = 0.65,
                To = 1,
                Duration = TimeSpan.FromMilliseconds(
                    _tokens.Number("motion", "milliseconds", "rowChange")
                ),
            };
            Storyboard.SetTarget(animation, container);
            Storyboard.SetTargetProperty(animation, "Opacity");
            var storyboard = new Storyboard();
            storyboard.Children.Add(animation);
            storyboard.Begin();
        }
        var reset = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(
                _tokens.Number("motion", "milliseconds", "rowChange")
            ),
        };
        reset.Tick += (_, _) =>
        {
            TaskList.ItemContainerTransitions = [];
            reset.Stop();
        };
        reset.Start();
    }
}
