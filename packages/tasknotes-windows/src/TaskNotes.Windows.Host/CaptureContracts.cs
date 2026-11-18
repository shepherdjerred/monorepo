using System.Text.Json.Serialization;

namespace TaskNotes.Windows.Host;

/// <summary>Absent means inherit; present null/empty means an explicit clear.</summary>
public sealed record FacetCaptureField<T>(T Value);

/// <summary>Absent controls inherit the parse; wrapped null or empty values explicitly clear it.</summary>
public sealed record FacetCaptureOptions(
    FacetCaptureField<string>? Body = null,
    FacetCaptureField<string?>? Due = null,
    FacetCaptureField<string?>? Priority = null,
    FacetCaptureField<IReadOnlyList<string>>? Projects = null,
    FacetCaptureField<IReadOnlyList<string>>? Contexts = null,
    FacetCaptureField<IReadOnlyList<string>>? Tags = null,
    FacetCaptureField<string?>? Scheduled = null,
    FacetCaptureField<string?>? Recurrence = null
)
{
    /// <summary>Capture's original activation lease is presentation identity, never mutation JSON.</summary>
    [JsonIgnore]
    public FacetFeedbackLease? FeedbackLease { get; init; }

    /// <summary>Only explicit fields alter semantic retry identity; scene leases never do.</summary>
    [JsonIgnore]
    public bool HasOverrides =>
        Body is not null
        || Due is not null
        || Priority is not null
        || Projects is not null
        || Contexts is not null
        || Tags is not null
        || Scheduled is not null
        || Recurrence is not null;

    /// <summary>Copy collections before preview or mutation admission.</summary>
    public FacetCaptureOptions Freeze() =>
        this with
        {
            Projects = Projects is null ? null : new(Projects.Value.ToArray()),
            Contexts = Contexts is null ? null : new(Contexts.Value.ToArray()),
            Tags = Tags is null ? null : new(Tags.Value.ToArray()),
        };
}

/// <summary>One store-prepared capture command; callers can inspect its preview before submission.</summary>
public sealed class FacetPreparedCapture
{
    internal FacetPreparedCapture(
        string? profile,
        string session,
        long generation,
        QuickAddPreview preview,
        string? body,
        FacetCaptureOptions options
    )
    {
        Profile = profile;
        Session = session;
        Generation = generation;
        Preview = preview;
        Body = body;
        Options = options.Freeze();
    }

    /// <summary>The canonical projection of the exact command to be admitted.</summary>
    public QuickAddPreview Preview { get; }

    internal string? Profile { get; }
    internal string Session { get; }
    internal long Generation { get; }
    internal string? Body { get; }
    internal FacetCaptureOptions Options { get; }
    internal string? AdmittedActionId { get; private set; }

    internal void RecordAdmission(string id) => AdmittedActionId = id;
}

/// <summary>Capture store contract consumed by Windows Quick Add presentation.</summary>
public interface IFacetCaptureStore
{
    /// <summary>The owning profile or workspace scope captured before preview.</summary>
    string? SelectedProfileId { get; }

    /// <summary>Submit one frozen capture and report its durable mutation identity.</summary>
    Task AddCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        Action<string> actionAdmitted,
        CancellationToken cancellationToken = default
    );
}

/// <summary>Rich capture contract behind the serialized store boundary.</summary>
public interface IFacetDetailedCaptureStore : IFacetCaptureStore
{
    /// <summary>Capture the original window before preview starts.</summary>
    FacetFeedbackLease? CaptureFeedbackLease();

    /// <summary>Freeze the full create payload once, before durable admission.</summary>
    Task<FacetPreparedCapture> PrepareCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    );

    /// <summary>Submit the exact prepared payload under its original store session.</summary>
    Task SubmitPreparedCaptureAsync(
        FacetPreparedCapture capture,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    );

    /// <summary>Preview parsed input in its original query context.</summary>
    Task<QuickAddPreview> PreviewCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    );

    /// <summary>Submit immutable explicit fields without a second parser.</summary>
    Task AddDetailedCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    );
}

/// <summary>Task editor store contract returning the authoritative post-save task projection.</summary>
public interface IFacetTaskEditorStore
{
    /// <summary>Apply one frozen edit and return its resulting task projection.</summary>
    Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    );

    /// <summary>Capture the durable admission identity before an uncertain submitted action can fail.</summary>
    Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        Action<string> actionAdmitted,
        CancellationToken cancellationToken = default
    ) => SaveTaskEditAsync(input, cancellationToken);
}

/// <summary>Dependency relationship choices and optional default relationship type.</summary>
public sealed record DependencyEditorMetadata(
    IReadOnlyList<string> RelationshipTypes,
    string? DefaultReltype
);

/// <summary>Reads dependency editor metadata for the loaded workspace.</summary>
public interface IFacetDependencyEditorStore
{
    /// <summary>Returns validated dependency relationship metadata.</summary>
    Task<DependencyEditorMetadata> ReadDependencyEditorMetadataAsync(
        string profileId,
        CancellationToken cancellationToken = default
    );
}

/// <summary>The edit was saved, but refreshing its resulting task projection failed.</summary>
public sealed class FacetSavedObservationException : Exception
{
    /// <summary>Initializes an applied edit whose resulting projection is unavailable.</summary>
    public FacetSavedObservationException()
        : base("Saved. Refresh to update the list.") { }

    /// <summary>Initializes an applied edit with an observation message.</summary>
    public FacetSavedObservationException(string message)
        : base(message) { }

    /// <summary>Initializes an applied edit with the expected observation failure.</summary>
    public FacetSavedObservationException(string message, Exception innerException)
        : base(message, innerException) { }
}
