using System.Text.Json;

namespace TaskNotes.Windows.Host;

public sealed partial class FacetTaskNotesStore
{
    private void ReplanAutomaticOccurrences(string profile, long capturedGeneration)
    {
        if (!_occurrenceRequests.RequestReplan(profile, capturedGeneration))
            _occurrenceMaintenanceErrors[profile] =
                "This series changed again during generation. Refresh to review its current state.";
    }

    private async Task<bool> RetireObservedRejectedAutomaticAsync(
        FacetMutationJournal.Entry envelope,
        Func<bool> owns,
        CancellationToken cancellation
    )
    {
        using var observed = JsonDocument.Parse(
            await _engine
                .FeaturesAsync(
                    envelope.Profile,
                    JsonSerializer.Serialize(
                        new { kind = "mutation_receipt", mutationId = envelope.Id }
                    ),
                    cancellation
                )
                .ConfigureAwait(false)
        );
        if (!owns())
            return false;
        var status = observed.RootElement;
        if (status.GetProperty("mutationId").GetString() != envelope.Id)
            throw new InvalidDataException(
                "Automatic recovery observed a different mutation identity."
            );
        var receipt = status.GetProperty("receipt");
        if (
            receipt.ValueKind != JsonValueKind.Null
            && receipt.GetProperty("mutationId").GetString() != envelope.Id
        )
            throw new InvalidDataException("Automatic recovery received another action's receipt.");
        string state = status.GetProperty("state").GetString()!;
        if (state is "pending" or "applied")
            return false;
        if (state is not ("absent" or "parked"))
            throw new InvalidDataException("Unknown automatic recovery state.");
        _journal.RetireRejected(envelope);
        return true;
    }

    private async Task<(bool Replan, HashSet<string> Blocked)> ReconcileAutomaticOccurrencesAsync(
        string profile,
        IReadOnlyList<JsonElement> targets,
        Func<bool> owns,
        CancellationToken cancellation
    )
    {
        bool replan = false;
        HashSet<string> blocked = new(StringComparer.Ordinal);
        foreach (var envelope in _journal.PendingEntries.Where(entry => entry.Profile == profile))
        {
            using var document = JsonDocument.Parse(envelope.Document);
            var command = document.RootElement.GetProperty("command");
            if (!IsAutomaticOccurrence(command))
                continue;
            string parent = command.GetProperty("parentPath").GetString()!;
            var matching = targets
                .Where(target => target.GetProperty("parentPath").GetString() == parent)
                .ToArray();
            if (matching.Length > 1)
                throw new InvalidDataException(
                    "Automatic recovery received duplicate current targets."
                );
            bool current =
                matching.Length == 1
                && matching[0].GetProperty("expectedParentRevision").GetString()
                    == command.GetProperty("expectedParentRevision").GetString()
                && matching[0].GetProperty("referenceDate").GetString()
                    == command.GetProperty("referenceDate").GetString();
            if (current)
                continue;
            if (!owns())
                break;
            if (
                await RetireObservedRejectedAutomaticAsync(envelope, owns, cancellation)
                    .ConfigureAwait(false)
            )
                replan = true;
            else
            {
                blocked.Add(parent);
                _occurrenceMaintenanceErrors[profile] =
                    "An earlier automatic generation action still needs observation. Resume its original saved action; its decision was not replaced.";
            }
        }
        return (replan, blocked);
    }
}
