using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.App.Views;

namespace TaskNotes.Windows.App;

public sealed partial class MainWindow
{
    private bool _showingQuickAdd;

    private async Task ShowQuickAddAsync(string initialText)
    {
        if (_showingQuickAdd)
            return;
        _showingQuickAdd = true;
        try
        {
            if (_quickAdd.CanDismissAfterSave)
                _ = _quickAdd.DiscardDraft();
            if (!_quickAdd.HasDraft)
            {
                _quickAdd.SetContext(_query);
                _quickAdd.Input = initialText;
            }
            QuickAddView content = new() { ViewModel = _quickAdd };
            content.Initialize(_uiOperations, RunUiOperationAsync);
            ContentDialog dialog = new()
            {
                XamlRoot = RootGrid.XamlRoot,
                Title = "Add task",
                Content = new ScrollViewer { Content = content, MaxHeight = 600 },
                PrimaryButtonText = "Add task",
                SecondaryButtonText = "Add & add another",
                CloseButtonText = "Keep draft",
                DefaultButton = ContentDialogButton.Primary,
            };
            AutomationProperties.SetAutomationId(dialog, "TaskNotes.QuickAdd.Dialog");
            dialog.Opened += (_, _) => content.FocusInput();
            dialog.Closing += (_, args) => args.Cancel = _quickAdd.IsSubmitting;

            void Submit(bool another, ContentDialogButtonClickEventArgs? args)
            {
                if (args is not null)
                    args.Cancel = true;
                if (_quickAdd.IsSubmitting)
                    return;
                var deferral = args?.GetDeferral();
                content.CommitTokens();
                dialog.IsPrimaryButtonEnabled = false;
                dialog.IsSecondaryButtonEnabled = false;
                _uiOperations.Run(
                    "submit-capture-dialog",
                    async () =>
                    {
                        bool saved = false;
                        try
                        {
                            _ = await RunUiOperationAsync(async () =>
                                saved = await _quickAdd.SaveAsync(another)
                            );
                        }
                        finally
                        {
                            dialog.IsPrimaryButtonEnabled = _quickAdd.CanSubmit;
                            dialog.IsSecondaryButtonEnabled = _quickAdd.CanSubmit;
                            deferral?.Complete();
                        }
                        if (saved && !another && _quickAdd.CanDismissAfterSave)
                            dialog.Hide();
                        else
                            content.FocusInput();
                    }
                );
            }

            dialog.PrimaryButtonClick += (_, args) => Submit(false, args);
            dialog.SecondaryButtonClick += (_, args) => Submit(true, args);
            content.SubmitRequested += (_, _) => Submit(false, null);
            _quickAdd.PropertyChanged += UpdateButtons;
            UpdateButtons(null, new(null));
            try
            {
                await dialog.ShowAsync();
            }
            finally
            {
                _quickAdd.PropertyChanged -= UpdateButtons;
            }

            void UpdateButtons(object? sender, System.ComponentModel.PropertyChangedEventArgs args)
            {
                _ = sender;
                _ = args;
                dialog.IsPrimaryButtonEnabled = _quickAdd.CanSubmit;
                dialog.IsSecondaryButtonEnabled = _quickAdd.CanSubmit;
            }
        }
        finally
        {
            _showingQuickAdd = false;
        }
    }
}
