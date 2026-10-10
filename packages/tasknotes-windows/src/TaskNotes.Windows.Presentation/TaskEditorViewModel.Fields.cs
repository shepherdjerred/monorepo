using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

public sealed partial class TaskEditorViewModel
{
    private string _blockedBy = string.Empty;
    private string _completedDate = string.Empty;
    private string _dateCreated = string.Empty;
    private string _completeInstances = string.Empty;
    private string _skippedInstances = string.Empty;
    private string _attachments = string.Empty;
    private IReadOnlyList<WorkflowChoice> _statusChoices = [];
    private IReadOnlyList<WorkflowChoice> _priorityChoices = [];
    private string _reminderBaseline = "";

    /// <summary>Comma-separated dependency identifiers or references.</summary>
    public string BlockedBy
    {
        get => _blockedBy;
        set => SetEditorProperty(ref _blockedBy, value);
    }

    /// <summary>Completion civil date.</summary>
    public string CompletedDate
    {
        get => _completedDate;
        set => SetEditorProperty(ref _completedDate, value);
    }

    /// <summary>Explicit user-chosen creation timestamp for metadata repair.</summary>
    public string DateCreated
    {
        get => _dateCreated;
        set => SetEditorProperty(ref _dateCreated, value);
    }

    /// <summary>Comma-separated completed occurrence dates.</summary>
    public string CompleteInstances
    {
        get => _completeInstances;
        set => SetEditorProperty(ref _completeInstances, value);
    }

    /// <summary>Comma-separated skipped occurrence dates.</summary>
    public string SkippedInstances
    {
        get => _skippedInstances;
        set => SetEditorProperty(ref _skippedInstances, value);
    }

    /// <summary>Ordered attachment references, one per line.</summary>
    public string Attachments
    {
        get => _attachments;
        set => SetEditorProperty(ref _attachments, value);
    }

    /// <summary>Typed reminder rows retaining unknown publisher fields.</summary>
    public ObservableCollection<ReminderEditorRow> Reminders { get; } = [];

    /// <summary>Adds a relative reminder whose stable ID is retained while editing.</summary>
    public void AddReminder()
    {
        var row = new ReminderEditorRow(null);
        Observe(row);
        Reminders.Add(row);
        _draftGeneration++;
        IsDirty = true;
    }

    /// <summary>Removes only the chosen reminder row.</summary>
    public void RemoveReminder(ReminderEditorRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (Reminders.Remove(row))
        {
            _draftGeneration++;
            IsDirty = true;
        }
    }

    private void Observe(ReminderEditorRow row) =>
        row.PropertyChanged += (_, _) =>
        {
            if (!_loading)
            {
                _draftGeneration++;
                IsDirty = true;
            }
        };

    private void LoadAdditionalFields(TaskItem task)
    {
        _statusChoices = _store.State.StatusChoices.ToArray();
        _priorityChoices = _store.State.PriorityChoices.ToArray();
        if (!_statusChoices.Any(choice => choice.Value == task.Status))
            _statusChoices = [.. _statusChoices, new(task.Status, task.Status)];
        if (!_priorityChoices.Any(choice => choice.Value == task.Priority))
            _priorityChoices = [.. _priorityChoices, new(task.Priority, task.Priority)];
        BlockedBy = List(task, "blockedBy");
        CompletedDate = Scalar(task, "completedDate");
        DateCreated = Scalar(task, "dateCreated");
        CompleteInstances = List(task, "completeInstances");
        SkippedInstances = List(task, "skippedInstances");
        Attachments = List(task, "attachments", "\n");
        Reminders.Clear();
        if (
            task.Properties is JsonElement properties
            && properties.TryGetProperty("reminders", out var reminders)
            && reminders.ValueKind == JsonValueKind.Array
        )
            foreach (var reminder in reminders.EnumerateArray())
            {
                var row = new ReminderEditorRow(reminder.Clone());
                Observe(row);
                Reminders.Add(row);
            }
        _reminderBaseline = ReminderFingerprint();
    }

    private void ClearAdditionalFields()
    {
        BlockedBy =
            CompletedDate =
            CompleteInstances =
            SkippedInstances =
            Attachments =
                string.Empty;
        Reminders.Clear();
        _statusChoices = _priorityChoices = [];
        DateCreated = string.Empty;
    }

    private Dictionary<string, JsonElement> ChangedFields(
        TaskItem original,
        string title,
        bool includeReminders = true
    )
    {
        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        void Put(string name, object? value) =>
            fields.Add(name, JsonSerializer.SerializeToElement(value));
        void Text(string name, string? value, string? before)
        {
            if (!string.Equals(value, before, StringComparison.Ordinal))
                Put(name, BlankAsNull(value));
        }
        void Values(string name, string value, string before)
        {
            if (value != before)
                Put(name, SplitValues(value));
        }
        if (title != original.Title)
            Put("title", title);
        if (Status != original.Status)
            Put("status", Status);
        Text("priority", Priority, original.Priority);
        Text("due", Due, original.Due);
        Text("scheduled", Scheduled, original.Scheduled);
        Text("recurrence", Recurrence, original.Recurrence);
        Text("recurrenceAnchor", RecurrenceAnchor, original.RecurrenceAnchor);
        Values("projects", Projects, string.Join(", ", original.Projects));
        Values("contexts", Contexts, string.Join(", ", original.Contexts));
        Values("tags", Tags, string.Join(", ", original.Tags));
        Text("completedDate", CompletedDate, Scalar(original, "completedDate"));
        Text("dateCreated", DateCreated, Scalar(original, "dateCreated"));
        Values("blockedBy", BlockedBy, List(original, "blockedBy"));
        Values("completeInstances", CompleteInstances, List(original, "completeInstances"));
        Values("skippedInstances", SkippedInstances, List(original, "skippedInstances"));
        if (Attachments != List(original, "attachments", "\n"))
            Put(
                "attachments",
                Attachments.Split(
                    '\n',
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries
                )
            );
        if (!includeReminders)
            return fields;
        var currentReminders = Reminders.Select(row => row.Document()).ToArray();
        string beforeReminders =
            original.Properties is JsonElement p
            && p.TryGetProperty("reminders", out var before)
            && before.ValueKind == JsonValueKind.Array
                ? before.GetRawText()
                : "[]";
        if (
            JsonSerializer.Serialize(currentReminders)
            != JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(beforeReminders))
        )
            Put("reminders", currentReminders);
        return fields;
    }

    private string ReminderFingerprint() =>
        JsonSerializer.Serialize(
            Reminders.Select(row => new
            {
                row.Id,
                row.Type,
                row.RelatedTo,
                row.Offset,
                row.AbsoluteTime,
            })
        );

    private Dictionary<string, string?> Buffers() =>
        new(StringComparer.Ordinal)
        {
            ["title"] = Title,
            ["body"] = Details,
            ["status"] = Status,
            ["priority"] = Priority,
            ["due"] = Due,
            ["scheduled"] = Scheduled,
            ["recurrence"] = Recurrence,
            ["recurrenceAnchor"] = RecurrenceAnchor,
            ["projects"] = Projects,
            ["contexts"] = Contexts,
            ["tags"] = Tags,
            ["blockedBy"] = BlockedBy,
            ["completedDate"] = CompletedDate,
            ["dateCreated"] = DateCreated,
            ["completeInstances"] = CompleteInstances,
            ["skippedInstances"] = SkippedInstances,
            ["attachments"] = Attachments,
        };

    private static Dictionary<string, string?> Baseline(TaskItem task) =>
        new(StringComparer.Ordinal)
        {
            ["title"] = task.Title,
            ["body"] = task.Details,
            ["status"] = task.Status,
            ["priority"] = task.Priority,
            ["due"] = task.Due,
            ["scheduled"] = task.Scheduled,
            ["recurrence"] = task.Recurrence,
            ["recurrenceAnchor"] = task.RecurrenceAnchor,
            ["projects"] = string.Join(", ", task.Projects),
            ["contexts"] = string.Join(", ", task.Contexts),
            ["tags"] = string.Join(", ", task.Tags),
            ["blockedBy"] = List(task, "blockedBy"),
            ["completedDate"] = Scalar(task, "completedDate"),
            ["dateCreated"] = Scalar(task, "dateCreated"),
            ["completeInstances"] = List(task, "completeInstances"),
            ["skippedInstances"] = List(task, "skippedInstances"),
            ["attachments"] = List(task, "attachments", "\n"),
        };

    private void RestoreBuffer(string field, string? value)
    {
        switch (field)
        {
            case "title":
                Title = value!;
                break;
            case "body":
                Details = value;
                break;
            case "status":
                Status = value!;
                break;
            case "priority":
                Priority = value!;
                break;
            case "due":
                Due = value;
                break;
            case "scheduled":
                Scheduled = value;
                break;
            case "recurrence":
                Recurrence = value;
                break;
            case "recurrenceAnchor":
                RecurrenceAnchor = value;
                break;
            case "projects":
                Projects = value!;
                break;
            case "contexts":
                Contexts = value!;
                break;
            case "tags":
                Tags = value!;
                break;
            case "blockedBy":
                BlockedBy = value!;
                break;
            case "completedDate":
                CompletedDate = value!;
                break;
            case "dateCreated":
                DateCreated = value!;
                break;
            case "completeInstances":
                CompleteInstances = value!;
                break;
            case "skippedInstances":
                SkippedInstances = value!;
                break;
            case "attachments":
                Attachments = value!;
                break;
            default:
                throw new InvalidOperationException($"Unknown editor buffer {field}.");
        }
    }

    private static string Scalar(TaskItem task, string key, string missing = "") =>
        task.Properties is JsonElement properties
        && properties.TryGetProperty(key, out var value)
        && value.ValueKind != JsonValueKind.Null
            ? value.ValueKind == JsonValueKind.String
                ? value.GetString()!
                : value.GetRawText()
            : missing;

    private static string List(TaskItem task, string key, string separator = ", ") =>
        task.Properties is JsonElement properties
        && properties.TryGetProperty(key, out var value)
        && value.ValueKind != JsonValueKind.Null
            ? value.ValueKind == JsonValueKind.Array
                ? string.Join(
                    separator,
                    value
                        .EnumerateArray()
                        .Select(item =>
                            item.ValueKind == JsonValueKind.String
                                ? item.GetString()
                                : item.GetRawText()
                        )
                )
                : value.ValueKind == JsonValueKind.String
                    ? value.GetString()!
                    : value.GetRawText()
            : "";
}

/// <summary>Absolute or relative reminder controls with preserved original JSON extensions.</summary>
public sealed class ReminderEditorRow : ObservableObject
{
    private readonly JsonElement? _original;
    private string _type;
    private string _relatedTo;
    private string _offset;
    private string _absoluteTime;
    private bool _changed;
    private readonly Dictionary<string, string> _initial;

    /// <summary>Loads a reminder or creates a stable, new relative reminder.</summary>
    public ReminderEditorRow(JsonElement? original)
    {
        _original = original;
        string Read(string name, string missing) =>
            original is JsonElement { ValueKind: JsonValueKind.Object } p
            && p.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()!
                : missing;
        Id = Read("id", Guid.NewGuid().ToString("D"));
        _type = Read("type", "relative");
        _relatedTo = Read("relatedTo", "due");
        _offset = Read("offset", "-PT15M");
        _absoluteTime = Read("absoluteTime", "");
        _initial = new(StringComparer.Ordinal)
        {
            ["id"] = Id,
            ["type"] = _type,
            ["relatedTo"] = _relatedTo,
            ["offset"] = _offset,
            ["absoluteTime"] = _absoluteTime,
        };
        PropertyChanged += (_, _) => _changed = true;
    }

    /// <summary>Stable reminder ID.</summary>
    public string Id { get; }

    /// <summary>Whether this existing row supports typed reminder editing.</summary>
    public bool IsEditable =>
        _original is null || _original.Value.ValueKind == JsonValueKind.Object;

    /// <summary>Displays unsupported existing values without replacing their data.</summary>
    public string ExistingValueWarning =>
        IsEditable ? string.Empty : "Unsupported existing reminder is preserved.";

    /// <summary>Known choices and the exact existing raw type.</summary>
    public IReadOnlyList<WorkflowChoice> TypeChoices =>
        Type is "relative" or "absolute"
            ? [new("relative", "Relative"), new("absolute", "Absolute")]
            : [new("relative", "Relative"), new("absolute", "Absolute"), new(Type, Type)];

    /// <summary>Known choices and the exact existing relative base.</summary>
    public IReadOnlyList<WorkflowChoice> RelatedToChoices =>
        RelatedTo is "due" or "scheduled"
            ? [new("due", "Due date"), new("scheduled", "Scheduled date")]
            :
            [
                new("due", "Due date"),
                new("scheduled", "Scheduled date"),
                new(RelatedTo, RelatedTo),
            ];

    /// <summary>Absolute or relative reminder kind.</summary>
    public string Type
    {
        get => _type;
        set => SetProperty(ref _type, value);
    }

    /// <summary>Due or scheduled base for a relative reminder.</summary>
    public string RelatedTo
    {
        get => _relatedTo;
        set => SetProperty(ref _relatedTo, value);
    }

    /// <summary>ISO8601 relative duration.</summary>
    public string Offset
    {
        get => _offset;
        set => SetProperty(ref _offset, value);
    }

    /// <summary>RFC3339 absolute timestamp.</summary>
    public string AbsoluteTime
    {
        get => _absoluteTime;
        set => SetProperty(ref _absoluteTime, value);
    }

    internal JsonElement Document()
    {
        if (!_changed && _original is JsonElement unchanged)
            return unchanged.Clone();
        var fields = _original is JsonElement original
            ? original
                .EnumerateObject()
                .ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal)
            : new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        void Put(string key, string value)
        {
            if (_original is not null && _initial[key] == value)
                return;
            if (
                !fields.TryGetValue(key, out var before)
                || before.ValueKind != JsonValueKind.String
                || before.GetString() != value
            )
                fields[key] = JsonSerializer.SerializeToElement(value);
        }
        Put("id", Id);
        Put("type", Type);
        if (Type == "relative")
        {
            Put("relatedTo", RelatedTo);
            Put("offset", Offset);
        }
        else if (Type == "absolute")
            Put("absoluteTime", AbsoluteTime);
        else
            throw new ArgumentException("Choose an absolute or relative reminder.");
        return JsonSerializer.SerializeToElement(fields);
    }
}
