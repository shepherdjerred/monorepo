using System.Text.Json;

namespace TaskNotes.Windows.Host;

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
    [System.Text.Json.Serialization.JsonIgnore]
    public FacetFeedbackLease? FeedbackLease { get; init; }

    /// <summary>Only explicit fields alter semantic retry identity; scene leases never do.</summary>
    [System.Text.Json.Serialization.JsonIgnore]
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

    internal void Apply(Dictionary<string, JsonElement> properties)
    {
        if (Due is not null)
            properties["due"] = JsonSerializer.SerializeToElement(Due.Value);
        if (Scheduled is not null)
            properties["scheduled"] = JsonSerializer.SerializeToElement(Scheduled.Value);
        if (Priority is not null)
            properties["priority"] = JsonSerializer.SerializeToElement(Priority.Value);
        if (Recurrence is not null)
            properties["recurrence"] = JsonSerializer.SerializeToElement(Recurrence.Value);
        if (Projects is not null)
            properties["projects"] = JsonSerializer.SerializeToElement(Projects.Value);
        if (Contexts is not null)
            properties["contexts"] = JsonSerializer.SerializeToElement(Contexts.Value);
        if (Tags is not null)
            properties["tags"] = JsonSerializer.SerializeToElement(Tags.Value);
    }
}

/// <summary>Absent means inherit; present null/empty means an explicit clear.</summary>
public sealed record FacetCaptureField<T>(T Value);

/// <summary>One core-produced command; callers can inspect its preview but cannot rebuild its domain payload.</summary>
public sealed class FacetPreparedCapture
{
    internal FacetPreparedCapture(
        string profile,
        string session,
        long generation,
        QuickAddPreview preview,
        JsonElement command,
        string requestKey,
        FacetCaptureOptions options
    )
    {
        Profile = profile;
        Session = session;
        Generation = generation;
        Preview = preview;
        Command = command.Clone();
        RequestKey = requestKey;
        Options = options.Freeze();
    }

    /// <summary>The canonical projection of the exact command to be admitted.</summary>
    public QuickAddPreview Preview { get; }
    internal string Profile { get; }
    internal string Session { get; }
    internal long Generation { get; }
    internal JsonElement Command { get; }
    internal string RequestKey { get; }
    internal FacetCaptureOptions Options { get; }
    internal string? AdmittedActionId { get; private set; }

    internal void RecordAdmission(string id) => AdmittedActionId = id;
}

/// <summary>Rich capture stays behind the same serialized core boundary.</summary>
public interface IFacetDetailedCaptureStore : IFacetCaptureStore
{
    /// <summary>Capture the original window before preview starts.</summary>
    FacetFeedbackLease? CaptureFeedbackLease();

    /// <summary>Freeze the full core-produced create payload once, before durable admission.</summary>
    Task<FacetPreparedCapture> PrepareCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    );

    /// <summary>Submit the exact prepared payload under its original engine/profile.</summary>
    Task SubmitPreparedCaptureAsync(
        FacetPreparedCapture capture,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    );

    /// <summary>Preview parsed input in its original query/profile.</summary>
    Task<QuickAddPreview> PreviewCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    );

    /// <summary>Submit immutable explicit fields without a second journal or parser.</summary>
    Task AddDetailedCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    );
}

public sealed partial class FacetTaskNotesStore : IFacetDetailedCaptureStore
{
    /// <inheritdoc/>
    public FacetFeedbackLease? CaptureFeedbackLease() => FeedbackScene?.Capture();

    /// <inheritdoc/>
    public Task SubmitPreparedCaptureAsync(
        FacetPreparedCapture capture,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                if (
                    capture.Session != _feedbackSessionId
                    || capture.Profile != SelectedProfileId
                    || capture.Generation != Interlocked.Read(ref _feedbackGeneration)
                )
                    throw new ArgumentException(
                        "This prepared capture belongs to its original vault session. Review and preview it there again."
                    );
                if (capture.AdmittedActionId is string actionId)
                    throw new ArgumentException(
                        $"This capture was already submitted as {actionId}. Review that exact action in Settings recovery; do not submit it again."
                    );
                if (_journal.Pending(capture.Profile, capture.RequestKey) is { } retained)
                {
                    capture.RecordAdmission(retained.Id);
                    admitted(retained.Id);
                    throw new ArgumentException(
                        $"This capture already has saved action {retained.Id}. Resume or retire that exact action in Settings recovery before preparing another capture."
                    );
                }
                if (string.IsNullOrWhiteSpace(capture.Preview.Title))
                    throw new ArgumentException("Add a task title.");
                _operationFeedbackLease = capture.Options.FeedbackLease ?? _operationFeedbackLease;
                await MutateAsync(
                        capture.Command,
                        false,
                        cancellationToken,
                        capture.RequestKey,
                        requireTaskResult: true,
                        actionAdmitted: id =>
                        {
                            capture.RecordAdmission(id);
                            admitted(id);
                        }
                    )
                    .ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task AddDetailedCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    ) =>
        AddCaptureCoreAsync(
            input,
            context,
            profile,
            admitted,
            true,
            cancellationToken,
            options.Freeze()
        );

    /// <inheritdoc/>
    public async Task<QuickAddPreview> PreviewCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    ) =>
        (
            await PrepareCaptureAsync(input, context, profile, options, cancellationToken)
                .ConfigureAwait(false)
        ).Preview;

    /// <inheritdoc/>
    public Task<FacetPreparedCapture> PrepareCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    )
    {
        var frozen = options.Freeze() with
        {
            FeedbackLease = options.FeedbackLease ?? CaptureFeedbackLease(),
        };
        return SerializedAsync(
            async () =>
            {
                if (SelectedProfileId != profile)
                    throw new ArgumentException(
                        "Return to this capture's original vault before previewing it."
                    );
                DateTimeOffset instant = _time.GetUtcNow();
                string today = TimeZoneInfo
                    .ConvertTime(instant, _time.LocalTimeZone)
                    .ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
                JsonElement preview = await FeatureAsync(
                        new
                        {
                            schemaVersion = 1,
                            kind = "capture_preview",
                            input,
                            at = instant.ToString(
                                "O",
                                System.Globalization.CultureInfo.InvariantCulture
                            ),
                            today,
                            context = CaptureContext(
                                context,
                                context.Kind == TaskListKind.Today ? today : null
                            ),
                        },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                var properties = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                    preview.GetProperty("properties").GetRawText()
                )!;
                frozen.Apply(properties);
                var values = JsonSerializer.SerializeToElement(properties);
                var model = new QuickAddPreview(
                    Text(values, "title") ?? "",
                    Text(values, "due"),
                    Text(values, "priority") ?? "",
                    Strings(values, "projects"),
                    Strings(values, "contexts"),
                    Strings(values, "tags"),
                    Text(values, "recurrence")
                )
                {
                    Scheduled = Text(values, "scheduled"),
                };
                var command = JsonSerializer.SerializeToElement(
                    new
                    {
                        kind = "create",
                        properties,
                        body = frozen.Body?.Value ?? preview.GetProperty("body").GetString(),
                    }
                );
                string requestKey = frozen.HasOverrides
                    ? JsonSerializer
                        .SerializeToElement(
                            new
                            {
                                input,
                                context,
                                options = frozen,
                            }
                        )
                        .GetRawText()
                    : JsonSerializer.SerializeToElement(new { input, context }).GetRawText();
                return new FacetPreparedCapture(
                    profile!,
                    _feedbackSessionId,
                    _operationFeedbackGeneration,
                    model,
                    command,
                    requestKey,
                    frozen
                );
            },
            cancellationToken
        );
    }

    private static object CaptureContext(TaskListQuery query, string? scheduled) =>
        new
        {
            projects = query.Kind == TaskListKind.Project && query.Scope is not null
                ? new[] { query.Scope }
                : null,
            contexts = query.Kind == TaskListKind.Context && query.Scope is not null
                ? new[] { query.Scope }
                : null,
            tags = query.Kind == TaskListKind.Tag && query.Scope is not null
                ? new[] { query.Scope }
                : null,
            scheduled,
        };
}
