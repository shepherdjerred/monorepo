using System.Text.Json;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Explicit user-owned generation and fresh revision-fenced repair through the production mutation coordinator.</summary>
public interface IFacetOccurrenceStore
{
    /// <summary>Generate one explicitly selected occurrence date without host recurrence calculations.</summary>
    Task GenerateOccurrenceAsync(
        TaskItem parent,
        string occurrenceDate,
        CancellationToken cancellationToken = default
    );

    /// <summary>Generate the series' configured rolling window as an Undo-eligible user action.</summary>
    Task GenerateOccurrenceWindowAsync(
        TaskItem parent,
        CancellationToken cancellationToken = default
    );

    /// <summary>Refresh the core failure plan before admitting a new explicit repair.</summary>
    Task RepairGenerationAsync(
        string profile,
        string primaryMutationId,
        string successorId,
        CancellationToken cancellationToken = default
    );
}

public sealed partial class FacetTaskNotesStore : IFacetOccurrenceStore
{
    private readonly FacetOccurrenceRequests _occurrenceRequests = new();
    private readonly Dictionary<string, string> _occurrenceMaintenanceErrors = new(
        StringComparer.Ordinal
    );
    private readonly Dictionary<string, IReadOnlyList<FacetOccurrenceProblem>> _occurrenceProblems =
        new(StringComparer.Ordinal);

    /// <inheritdoc/>
    public Task GenerateOccurrenceAsync(
        TaskItem parent,
        string occurrenceDate,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(parent);
        string profile =
            parent.ProfileId
            ?? throw new ArgumentException(
                "Load a standalone series before generating an occurrence.",
                nameof(parent)
            );
        var command = JsonSerializer.SerializeToElement(
            new
            {
                kind = "materialize_occurrence",
                parentPath = parent.VaultPath,
                expectedParentRevision = parent.ExpectedRevision,
                occurrenceDate,
                properties = new Dictionary<string, object>(),
            }
        );
        return ExecuteGenerationAsync(profile, command, cancellationToken);
    }

    /// <inheritdoc/>
    public Task GenerateOccurrenceWindowAsync(
        TaskItem parent,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(parent);
        string profile =
            parent.ProfileId
            ?? throw new ArgumentException(
                "Load a standalone series before generating its window.",
                nameof(parent)
            );
        var command = JsonSerializer.SerializeToElement(
            new
            {
                kind = "materialize_occurrence_window",
                origin = "user",
                parentPath = parent.VaultPath,
                expectedParentRevision = parent.ExpectedRevision,
                referenceDate = Today(),
            }
        );
        return ExecuteGenerationAsync(profile, command, cancellationToken);
    }

    private Task ExecuteGenerationAsync(
        string profile,
        JsonElement command,
        CancellationToken cancellation
    ) =>
        SerializedAsync(
            async () =>
            {
                if (SelectedProfileId != profile)
                    throw new ArgumentException(
                        "Return to the series' original vault before generating occurrences."
                    );
                FacetSchema.Bundled().Validate(command.GetRawText(), "command");
                await MutateAsync(command, false, cancellation).ConfigureAwait(false);
            },
            cancellation
        );

    /// <inheritdoc/>
    public Task RepairGenerationAsync(
        string profile,
        string primaryMutationId,
        string successorId,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                if (SelectedProfileId != profile)
                    throw new ArgumentException(
                        "Select the generation outcome's original vault before repairing it."
                    );
                var failures = await ReadGenerationFailuresAsync(profile, cancellationToken)
                    .ConfigureAwait(false);
                var failure =
                    failures.SingleOrDefault(row =>
                        row.PrimaryMutationId == primaryMutationId && row.SuccessorId == successorId
                    )
                    ?? throw new ArgumentException(
                        "This generation outcome changed. Refresh its series before starting another repair."
                    );
                var command = failure.RepairCommand ?? throw new ArgumentException(failure.Status);
                // This is a new user action with fresh core-authored parent/child revisions.
                // The original progression and every existing retry envelope remain immutable.
                FacetSchema.Bundled().Validate(command.GetRawText(), "command");
                await MutateAsync(command, false, cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    private Task<IReadOnlyList<FacetGenerationFailure>> ReadGenerationFailuresAsync(
        string profile,
        CancellationToken cancellation
    ) =>
        FacetOccurrencePlans.FailuresAsync(
            profile,
            (request, token) => _engine.FeaturesAsync(profile, request, token),
            cancellation
        );

    private void MarkOccurrenceMaintenance(string profile)
    {
        _occurrenceRequests.Request(profile);
    }

    private void AcknowledgeOccurrenceRequest(string profile, long generation)
    {
        _occurrenceRequests.Acknowledge(profile, generation);
    }

    private bool OwnsOccurrenceOwner(
        FacetProfileRegistration profile,
        long lifecycle,
        long authority
    ) =>
        !_disposed
        && lifecycle == Volatile.Read(ref _sessionGeneration)
        && Profiles.Any(current => current == profile)
        && (
            profile.Vault is null
            || profile.AccountOwner is not null
                && _account.HasAuthorization(
                    authority,
                    profile.AccountOwner,
                    profile.Id,
                    profile.Vault.Id
                )
        );

    private static bool IsAutomaticOccurrence(JsonElement command) =>
        command.GetProperty("kind").GetString() == "materialize_occurrence_window"
        && command.TryGetProperty("origin", out var origin)
        && origin.GetString() == "automatic_maintenance";

    private FacetMutationJournal.Entry AdmitAutomaticOccurrence(
        string profile,
        object command,
        string parent
    )
    {
        var retained = _journal
            .PendingEntries.Where(entry =>
            {
                if (entry.Profile != profile)
                    return false;
                using var document = JsonDocument.Parse(entry.Document);
                var old = document.RootElement.GetProperty("command");
                return IsAutomaticOccurrence(old)
                    && old.GetProperty("parentPath").GetString() == parent;
            })
            .ToArray();
        if (retained.Length > 1)
            throw new InvalidDataException(
                "A series has more than one retained automatic window decision."
            );
        return retained.SingleOrDefault() ?? _journal.Prepare(profile, command);
    }

    private async Task MaintainOccurrencesAsync(CancellationToken cancellation)
    {
        var requests = _occurrenceRequests.Snapshot();
        string referenceDate = Today();
        foreach (var (id, generation) in requests)
        {
            cancellation.ThrowIfCancellationRequested();
            var profile = Profiles.SingleOrDefault(candidate => candidate.Id == id);
            if (profile is null || !profile.PrivateReplica)
            {
                AcknowledgeOccurrenceRequest(id, generation);
                continue;
            }
            long lifecycle = Volatile.Read(ref _sessionGeneration);
            long authority = _account.AuthorizationEpoch;
            try
            {
                _occurrenceMaintenanceErrors.Remove(id);
                if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                    throw new FacetAuthorizationRequiredException(
                        "Authorize this vault before automatic generation."
                    );
                await _engine.RefreshAsync(id, cancellation).ConfigureAwait(false);
                using var discovery = JsonDocument.Parse(
                    await _engine
                        .FeaturesAsync(id, "{\"kind\":\"discovery\"}", cancellation)
                        .ConfigureAwait(false)
                );
                if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                {
                    AcknowledgeOccurrenceRequest(id, generation);
                    continue;
                }
                // Every currently supported writable Windows profile is a Direct Sync replica.
                // Consent/Sync switches never substitute for configuration and the core's initial barrier.
                if (
                    discovery.RootElement.GetProperty("configurationAvailable").GetBoolean()
                    && discovery.RootElement.GetProperty("initialSyncComplete").GetBoolean()
                )
                {
                    var plan = await FacetOccurrencePlans
                        .MaintenanceAsync(
                            id,
                            referenceDate,
                            (request, token) => _engine.FeaturesAsync(id, request, token),
                            cancellation
                        )
                        .ConfigureAwait(false);
                    if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                    {
                        AcknowledgeOccurrenceRequest(id, generation);
                        continue;
                    }
                    _occurrenceProblems[id] = plan
                        .Problems.Select(problem => new FacetOccurrenceProblem(
                            id,
                            problem.GetProperty("taskPath").GetString()!,
                            problem.GetProperty("code").GetString()!
                        ))
                        .ToArray();
                    var reconciled = await ReconcileAutomaticOccurrencesAsync(
                            id,
                            plan.Targets,
                            () => OwnsOccurrenceOwner(profile, lifecycle, authority),
                            cancellation
                        )
                        .ConfigureAwait(false);
                    if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                    {
                        AcknowledgeOccurrenceRequest(id, generation);
                        continue;
                    }
                    if (reconciled.Replan)
                    {
                        ReplanAutomaticOccurrences(id, generation);
                        AcknowledgeOccurrenceRequest(id, generation);
                        continue;
                    }
                    foreach (var target in plan.Targets)
                    {
                        if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                            break;
                        if (
                            reconciled.Blocked.Contains(
                                target.GetProperty("parentPath").GetString()!
                            )
                        )
                            continue;
                        var command = new
                        {
                            kind = "materialize_occurrence_window",
                            origin = "automatic_maintenance",
                            parentPath = target.GetProperty("parentPath").GetString(),
                            expectedParentRevision = target
                                .GetProperty("expectedParentRevision")
                                .GetString(),
                            referenceDate = target.GetProperty("referenceDate").GetString(),
                        };
                        var envelope = AdmitAutomaticOccurrence(
                            id,
                            command,
                            target.GetProperty("parentPath").GetString()!
                        );
                        string rawReceipt;
                        try
                        {
                            rawReceipt = await _engine
                                .ExecuteOwnedMaintenanceAsync(
                                    id,
                                    envelope.Document,
                                    () => OwnsOccurrenceOwner(profile, lifecycle, authority),
                                    cancellation
                                )
                                .ConfigureAwait(false);
                        }
                        catch (Exception error)
                            when (error
                                    is Core.FacetEngineException.Conflict
                                        or Core.FacetEngineException.NotFound
                            )
                        {
                            if (
                                await RetireObservedRejectedAutomaticAsync(
                                        envelope,
                                        () => OwnsOccurrenceOwner(profile, lifecycle, authority),
                                        cancellation
                                    )
                                    .ConfigureAwait(false)
                            )
                                ReplanAutomaticOccurrences(id, generation);
                            else
                                _occurrenceMaintenanceErrors[id] =
                                    "An automatic generation decision remains retained. Resume or review its exact saved action.";
                            break;
                        }
                        using var receipt = JsonDocument.Parse(rawReceipt);
                        if (!OwnsOccurrenceOwner(profile, lifecycle, authority))
                            break;
                        if (
                            receipt.RootElement.GetProperty("mutationId").GetString() != envelope.Id
                        )
                            throw new InvalidDataException(
                                "Automatic generation returned another action's receipt."
                            );
                        if (!receipt.RootElement.GetProperty("applied").GetBoolean())
                        {
                            if (
                                await RetireObservedRejectedAutomaticAsync(
                                        envelope,
                                        () => OwnsOccurrenceOwner(profile, lifecycle, authority),
                                        cancellation
                                    )
                                    .ConfigureAwait(false)
                            )
                                ReplanAutomaticOccurrences(id, generation);
                            else
                                _occurrenceMaintenanceErrors[id] =
                                    "Automatic generation needs review. Resume or retire its original saved action in Settings.";
                            break;
                        }
                        _journal.Complete(envelope, false);
                        using var submitted = JsonDocument.Parse(envelope.Document);
                        if (
                            submitted.RootElement.GetProperty("command").GetRawText()
                            != JsonSerializer.Serialize(command)
                        )
                            ReplanAutomaticOccurrences(id, generation);
                    }
                }
                AcknowledgeOccurrenceRequest(id, generation);
            }
            catch (OperationCanceledException)
                when (!cancellation.IsCancellationRequested
                    && !OwnsOccurrenceOwner(profile, lifecycle, authority)
                )
            {
                AcknowledgeOccurrenceRequest(id, generation);
            }
            catch (FacetOccurrenceNotReadyException)
            {
                AcknowledgeOccurrenceRequest(id, generation);
                _occurrenceMaintenanceErrors[id] =
                    "Occurrence generation is waiting for vault configuration and initial Sync.";
            }
            catch (Exception error)
                when (error
                        is FacetAuthorizationRequiredException
                            or Core.FacetEngineException.Configuration
                            or Core.FacetEngineException.Host
                            or Core.FacetEngineException.Conflict
                            or Core.FacetHostException
                    || IsExpectedObservationFailure(error)
                )
            {
                AcknowledgeOccurrenceRequest(id, generation);
                _occurrenceMaintenanceErrors[id] =
                    error is FacetAuthorizationRequiredException
                        ? "Authorize this vault before automatic occurrence generation."
                        : "Occurrence generation could not finish. Restore vault access or refresh to review the retained action.";
            }
        }
        if (_occurrenceRequests.HasPending)
            _updates.Request();
    }
}
