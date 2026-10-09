namespace TaskNotes.Windows.Host;

public sealed partial class FacetTaskNotesStore
{
    /// <summary>The journal's currently observed Undo authority must match this exact receipt.</summary>
    public bool CanUndoOutcome(FacetAppliedFeedback outcome) =>
        OwnsFeedback(outcome) && _undoReceiptId == outcome.Owner.MutationId;

    /// <summary>Undo the exact reviewed current receipt; queueing cannot select a newer change.</summary>
    public Task UndoCurrentSavedAsync(
        string? expectedReceipt = null,
        CancellationToken cancellationToken = default
    )
    {
        string? profile = SelectedProfileId;
        string? receiptId = expectedReceipt ?? _undoReceiptId;
        long generation = Interlocked.Read(ref _feedbackGeneration);
        return SerializedAsync(
            async () =>
            {
                if (
                    profile != SelectedProfileId
                    || generation != Interlocked.Read(ref _feedbackGeneration)
                )
                    throw new ArgumentException(
                        "Return to the change's original vault before Undo."
                    );
                if (receiptId is null)
                    throw new ArgumentException("No saved change is currently available to undo.");
                var available = await FeatureAsync(
                        new { kind = "undo_available" },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                if (available.GetProperty("receiptId").GetString() != receiptId)
                    throw new ArgumentException(
                        "A newer saved change owns Undo. Review that change before continuing."
                    );
                if (
                    _journal.PendingEntries.Any(entry =>
                        entry.Profile == profile
                        && System
                            .Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                                entry.Document
                            )
                            .GetProperty("command")
                            .GetProperty("kind")
                            .GetString() == "undo"
                    )
                )
                    throw new ArgumentException(
                        "Resume or retire the submitted Undo action in Settings recovery first."
                    );
                await MutateAsync(
                        new { kind = "undo", receiptId },
                        false,
                        cancellationToken,
                        undoReceiptId: _journal.UndoHead(Selected) == receiptId ? receiptId : null
                    )
                    .ConfigureAwait(false);
            },
            cancellationToken
        );
    }
}
