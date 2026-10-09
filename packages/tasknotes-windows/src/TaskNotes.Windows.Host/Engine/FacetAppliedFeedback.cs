using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>A local outcome, qualified by its original engine, admission and applied receipt.</summary>
public sealed record FacetAppliedFeedback(
    string EngineSessionId,
    FacetNoticeOwner Owner,
    string Event,
    bool Changed,
    bool OwnsAdmission,
    long LifecycleGeneration = 0,
    FacetFeedbackLease? Origin = null,
    IReadOnlyList<string>? Paths = null
);

/// <summary>Maps immutable commands to presentation events, without interpreting task semantics.</summary>
public static class FacetFeedbackEvents
{
    /// <summary>One aggregate event for a homogeneous batch; ordinary edits remain silent.</summary>
    public static string Classify(JsonElement command)
    {
        return command.GetProperty("kind").GetString() switch
        {
            "create" => "created",
            "delete" => "deleted",
            "undo" => "undone",
            "set_completion" => command.GetProperty("completed").GetBoolean()
                ? "completed"
                : "reopened",
            "batch" => Aggregate(command.GetProperty("commands")),
            _ => "saved",
        };
    }

    private static string Aggregate(JsonElement commands)
    {
        string[] events = commands.EnumerateArray().Select(Classify).Distinct().ToArray();
        return events.Length == 1 ? events[0] : "saved";
    }
}
