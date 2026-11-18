using System.Net;
using System.Text;
using System.Text.Json;
using TaskNotes.Protocol;
using ProtocolTask = TaskNotes.Protocol.Task;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Tests;

internal sealed class ManualClock : TimeProvider
{
    private DateTimeOffset _utcNow = new(2026, 10, 8, 12, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

    internal void SetUtc(DateTimeOffset value) => _utcNow = value;

    internal void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}

internal sealed class RecordingHttpHandler : HttpMessageHandler
{
    internal List<CapturedHttpRequest> Requests { get; } = [];

    internal Func<
        CapturedHttpRequest,
        CancellationToken,
        Task<HttpResponseMessage>
    > Responder { get; set; } =
        static (_, _) =>
            Task.FromResult(
                JsonResponse(
                    HttpStatusCode.OK,
                    JsonSerializer.Serialize(
                        new SyncResponse(
                            SyncToken: "seq:1",
                            FullSync: true,
                            TempIdMapping: new Dictionary<string, string>(StringComparer.Ordinal),
                            SyncStatus: new Dictionary<string, string>(StringComparer.Ordinal),
                            Tasks: [],
                            Projects: [],
                            Sections: [],
                            Labels: [],
                            Reminders: [],
                            Filters: []
                        ),
                        FacetProtocolJson.Options
                    )
                )
            );

    internal bool Disposed { get; private set; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken
    )
    {
        string body = request.Content is null
            ? string.Empty
            : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        CapturedHttpRequest captured = new(
            request.Method,
            request.RequestUri!,
            request.Headers.Authorization?.Scheme,
            request.Headers.Authorization?.Parameter,
            body
        );
        Requests.Add(captured);
        return await Responder(captured, cancellationToken).ConfigureAwait(false);
    }

    protected override void Dispose(bool disposing)
    {
        Disposed = true;
        base.Dispose(disposing);
    }

    internal static HttpResponseMessage JsonResponse(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

internal sealed record CapturedHttpRequest(
    HttpMethod Method,
    Uri Uri,
    string? AuthScheme,
    string? AuthParameter,
    string Body
)
{
    internal SyncRequest DeserializeSyncRequest() =>
        JsonSerializer.Deserialize<SyncRequest>(Body, FacetProtocolJson.Options)
        ?? throw new InvalidOperationException("SyncRequest body was null.");
}

internal static class ProtocolTestFactory
{
    internal const string UserId = "00000000-0000-0000-0000-000000000000";
    internal const string Stamp = "2026-10-08T12:00:00Z";

    internal static Project MakeProject(
        string id,
        string name,
        bool isInbox = false,
        bool isDeleted = false
    ) =>
        new(
            Id: id,
            UserId: UserId,
            Name: name,
            Color: "#808080",
            ParentId: null,
            ChildOrder: 0,
            IsInbox: isInbox,
            IsFavorite: false,
            IsArchived: false,
            IsDeleted: isDeleted,
            CreatedAt: Stamp,
            UpdatedAt: Stamp
        );

    internal static Section MakeSection(
        string id,
        string projectId,
        string name,
        double order = 0,
        bool isDeleted = false
    ) =>
        new(
            Id: id,
            ProjectId: projectId,
            UserId: UserId,
            Name: name,
            SectionOrder: order,
            IsArchived: false,
            IsDeleted: isDeleted,
            CreatedAt: Stamp,
            UpdatedAt: Stamp
        );

    internal static Label MakeLabel(
        string id,
        string name,
        string color = "#246FE0",
        bool isDeleted = false
    ) =>
        new(
            Id: id,
            UserId: UserId,
            Name: name,
            Color: color,
            ItemOrder: 0,
            IsFavorite: false,
            IsDeleted: isDeleted
        );

    internal static ProtocolTask MakeTask(
        string id,
        string projectId,
        string title,
        Priority priority = Priority.P4,
        string? dueDate = null,
        string? sectionId = null,
        string? recurrenceRule = null,
        IReadOnlyList<string>? labelIds = null,
        bool completed = false,
        bool isDeleted = false
    ) =>
        new(
            Id: id,
            UserId: UserId,
            ProjectId: projectId,
            SectionId: sectionId,
            ParentId: null,
            Title: title,
            Description: string.Empty,
            Priority: priority,
            ChildOrder: 0,
            DueDate: dueDate,
            DueDatetime: null,
            DueTimezone: null,
            DueString: null,
            IsRecurring: !string.IsNullOrEmpty(recurrenceRule),
            RecurrenceRule: recurrenceRule,
            LabelIds: labelIds ?? [],
            Completed: completed,
            CompletedAt: completed ? Stamp : null,
            IsDeleted: isDeleted,
            CreatedAt: Stamp,
            UpdatedAt: Stamp
        );

    internal static SyncResponse EmptySyncResponse(
        string syncToken = "seq:1",
        bool fullSync = false,
        IReadOnlyDictionary<string, string>? tempIdMapping = null,
        IReadOnlyDictionary<string, string>? syncStatus = null,
        IReadOnlyList<ProtocolTask>? tasks = null,
        IReadOnlyList<Project>? projects = null,
        IReadOnlyList<Section>? sections = null,
        IReadOnlyList<Label>? labels = null,
        IReadOnlyList<Reminder>? reminders = null,
        IReadOnlyList<Filter>? filters = null
    ) =>
        new(
            SyncToken: syncToken,
            FullSync: fullSync,
            TempIdMapping: tempIdMapping ?? new Dictionary<string, string>(StringComparer.Ordinal),
            SyncStatus: syncStatus ?? new Dictionary<string, string>(StringComparer.Ordinal),
            Tasks: tasks ?? [],
            Projects: projects ?? [],
            Sections: sections ?? [],
            Labels: labels ?? [],
            Reminders: reminders ?? [],
            Filters: filters ?? []
        );
}
