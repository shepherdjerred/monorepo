using System.Globalization;
using Microsoft.UI.Xaml.Controls;

namespace TaskNotes.Windows.App;

public sealed partial class MainWindow
{
    private void GenerateOccurrences(bool rollingWindow)
    {
        var source = _taskEditor.GenerationSource;
        if (source is null)
            return;
        _uiOperations.Run(
            "generate-occurrences",
            async () =>
            {
                if (_taskEditor.TaskId != source.Id || _taskEditor.ProfileId != source.ProfileId)
                    throw new ArgumentException(
                        "Return to the original series before generating occurrences."
                    );
                if (!await TaskWorkspace.Editor.FlushAsync())
                    return;
                var parent =
                    Store.State.AllTasks.SingleOrDefault(task =>
                        task.ProfileId == source.ProfileId && task.VaultPath == source.VaultPath
                    )
                    ?? throw new ArgumentException(
                        "Reopen the series after its latest edit before generating occurrences."
                    );
                if (rollingWindow)
                {
                    _ = await RunUiOperationAsync(() =>
                        Store.GenerateOccurrenceWindowAsync(parent)
                    );
                    return;
                }
                TextBox date = new()
                {
                    Header = "Occurrence date",
                    Text = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    PlaceholderText = "YYYY-MM-DD",
                };
                var dialog = Dialog("Generate occurrence", date, "Generate");
                if (await dialog.ShowAsync() == ContentDialogResult.Primary)
                    _ = await RunUiOperationAsync(() =>
                        Store.GenerateOccurrenceAsync(parent, date.Text)
                    );
            }
        );
    }
}
