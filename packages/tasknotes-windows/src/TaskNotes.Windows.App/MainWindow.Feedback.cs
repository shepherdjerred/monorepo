using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App;

public sealed partial class MainWindow
{
    private readonly FeedbackPolicy _feedbackPolicy = FeedbackPolicy.Bundled();
    private NativeTaskFeedback? _nativeFeedback;
    private volatile bool _foreground;
    private volatile bool _taskSounds = true;
    private volatile bool _feedbackClosed;
    private FacetAppliedFeedback? _playingFeedback;
    private readonly FacetFeedbackScene _feedbackScene = new();

    private void InitializeFeedback()
    {
        Store.FeedbackScene = _feedbackScene;
        Activated += (_, args) =>
        {
            _foreground = args.WindowActivationState != WindowActivationState.Deactivated;
            _feedbackScene.SetForeground(_foreground);
            if (!_foreground)
                _nativeFeedback?.Stop();
        };
        Store.StateChanged += Feedback_StateChanged;
        Store.AppliedFeedback += Store_AppliedFeedback;
        SettingsDestination.TaskSoundsChanged += enabled =>
        {
            _settings.SaveTaskSounds(enabled);
            _taskSounds = enabled;
            if (!enabled)
                _nativeFeedback?.Stop();
            else
                PrepareNativeFeedback();
        };
    }

    private void Store_AppliedFeedback(FacetAppliedFeedback feedback)
    {
        var delivery = _feedbackPolicy.Observe(
            feedback,
            Store.SelectedProfileId,
            !_feedbackClosed && _foreground && Store.OwnsFeedback(feedback),
            _taskSounds
        );
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            if (
                delivery is null
                || _feedbackClosed
                || !_foreground
                || !Store.OwnsFeedback(feedback)
            )
                return;
            TaskWorkspace.ShowAppliedOutcome(
                feedback,
                () => Store.OwnsFeedback(feedback),
                () => Store.CanUndoOutcome(feedback)
            );
            string? cue = delivery.Sound;
            if (cue is null)
                return;
            try
            {
                PrepareNativeFeedback();
                _nativeFeedback!.TryPlay(
                    cue,
                    () =>
                        _foreground
                        && _taskSounds
                        && Store.OwnsFeedback(feedback)
                        && _feedbackPolicy.TryBeginPlayback(cue)
                );
                _playingFeedback = feedback;
            }
            catch (Exception error)
                when (error
                        is IOException
                            or UnauthorizedAccessException
                            or System.Runtime.InteropServices.COMException
                )
            {
                TaskWorkspace.ShowError(
                    "Task saved. Its feedback sound could not play. Check sound output or disable task sounds in Settings."
                );
            }
        });
    }

    private void PrepareNativeFeedback() =>
        _nativeFeedback ??= new NativeTaskFeedback(
            _feedbackPolicy,
            message => _ = DispatcherQueue.TryEnqueue(() => TaskWorkspace.ShowError(message))
        );

    private void Feedback_StateChanged(object? sender, EventArgs args)
    {
        _ = sender;
        _ = args;
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            if (_playingFeedback is { } playing && !Store.OwnsFeedback(playing))
                _nativeFeedback?.Stop();
        });
    }

    private async Task<ShellPreferences?> LoadShellWithRecoveryAsync()
    {
        if (_settings.TaskSoundsNeedsRecovery)
        {
            var recovery = Dialog(
                "Repair task sound preference",
                "The saved sound preference is malformed. Choose its value explicitly; other settings will be preserved.",
                "Enable task sounds"
            );
            recovery.SecondaryButtonText = "Disable task sounds";
            recovery.CloseButtonText = "Quit app";
            var result = await recovery.ShowAsync();
            if (result == ContentDialogResult.None)
                return null;
            _settings.SaveTaskSounds(result == ContentDialogResult.Primary);
        }
        return _settings.LoadShell();
    }

    private void ReleaseFeedback()
    {
        if (_feedbackClosed)
            return;
        _feedbackClosed = true;
        _feedbackScene.Close();
        _foreground = false;
        Store.AppliedFeedback -= Store_AppliedFeedback;
        Store.StateChanged -= Feedback_StateChanged;
        _nativeFeedback?.Dispose();
    }
}
