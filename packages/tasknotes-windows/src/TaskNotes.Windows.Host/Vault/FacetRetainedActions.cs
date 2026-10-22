using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Historical private drafts can be reviewed without restoring removed public commands.</summary>
internal static class FacetRetainedActions
{
    internal static bool CanResume(JsonElement mutation) =>
        Supported(mutation.GetProperty("command"));

    private static bool Supported(JsonElement command) =>
        command.GetProperty("kind").GetString() switch
        {
            "start_time" or "stop_time" or "set_time_entries" or "pomodoro" => false,
            "batch" or "batch_partial" => command
                .GetProperty("commands")
                .EnumerateArray()
                .All(Supported),
            _ => true,
        };
}
