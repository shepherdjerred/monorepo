using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>One dependency record; editing a known field retains every other JSON value.</summary>
public sealed class DependencyEditorRow : ObservableObject
{
    private readonly JsonElement? _original;
    private readonly string _initialUid;
    private readonly string _initialRelation;
    private readonly string _initialGap;
    private string _uid;
    private string _relationType;
    private string _gap;
    private IReadOnlyList<WorkflowChoice> _choices;
    private bool _metadataReady;

    /// <summary>Loads a record or creates a draft requiring an explicit relationship choice.</summary>
    public DependencyEditorRow(JsonElement? original, IReadOnlyList<WorkflowChoice> choices)
    {
        _choices = choices;
        _metadataReady = choices.Count > 0;
        _original = original?.Clone();
        _uid = _initialUid = Read("uid");
        _relationType = _initialRelation = Read("reltype");
        _gap = _initialGap = Read("gap");
    }

    private string Read(string name) =>
        _original is JsonElement { ValueKind: JsonValueKind.Object } value
        && value.TryGetProperty(name, out var field)
        && field.ValueKind == JsonValueKind.String
            ? field.GetString()!
            : "";

    /// <summary>Exact dependency identifier or Markdown reference; Rust validates its identity.</summary>
    public string Uid
    {
        get => _uid;
        set => SetProperty(ref _uid, value);
    }

    /// <summary>Explicit relationship wire value, with no platform default.</summary>
    public string RelationType
    {
        get => _relationType;
        set => SetProperty(ref _relationType, value);
    }

    /// <summary>Optional signed ISO 8601 duration; Rust validates its grammar.</summary>
    public string Gap
    {
        get => _gap;
        set => SetProperty(ref _gap, value);
    }

    /// <summary>Shared contract choices; a new row has no selected relationship.</summary>
    public IReadOnlyList<WorkflowChoice> RelationChoices => _choices;

    internal void SetChoices(IReadOnlyList<WorkflowChoice> choices)
    {
        if (!_choices.SequenceEqual(choices))
        {
            _choices = choices;
            OnPropertyChanged(nameof(RelationChoices));
        }
        _metadataReady = choices.Count > 0;
        NotifyMetadataReadiness();
    }

    internal void MetadataPending()
    {
        _metadataReady = false;
        NotifyMetadataReadiness();
    }

    private void NotifyMetadataReadiness()
    {
        OnPropertyChanged(nameof(IsEditable));
        OnPropertyChanged(nameof(ExistingValueWarning));
        OnPropertyChanged(nameof(ExistingValueText));
    }

    /// <summary>Unsupported existing entries remain visible and unchanged.</summary>
    public bool IsEditable =>
        _metadataReady
        && RelationChoices.Count > 0
        && (
            _original is null
            || (
                _original is JsonElement { ValueKind: JsonValueKind.Object } value
                && value.TryGetProperty("uid", out var uid)
                && uid.ValueKind == JsonValueKind.String
                && value.TryGetProperty("reltype", out var relation)
                && relation.ValueKind == JsonValueKind.String
                && RelationChoices.Any(choice => choice.Value == relation.GetString())
                && (
                    !value.TryGetProperty("gap", out var gap)
                    || gap.ValueKind == JsonValueKind.String
                )
            )
        );

    /// <summary>Names opaque entries without discarding their original value.</summary>
    public string ExistingValueWarning =>
        !_metadataReady ? "Loading dependency relationships."
        : IsEditable ? ""
        : "Unsupported existing dependency is preserved read-only.";

    /// <summary>Displays the exact unsupported value without coercing it into an editable record.</summary>
    public string ExistingValueText =>
        _metadataReady && !IsEditable ? _original?.GetRawText() ?? "" : "";

    internal JsonElement Snapshot() =>
        JsonSerializer.SerializeToElement(
            new
            {
                original = _original,
                uid = Uid,
                relation = RelationType,
                gap = Gap,
            }
        );

    internal static DependencyEditorRow Restore(
        JsonElement value,
        IReadOnlyList<WorkflowChoice> choices
    ) =>
        new(
            value.GetProperty("original").ValueKind == JsonValueKind.Null
                ? null
                : value.GetProperty("original"),
            choices
        )
        {
            Uid = value.GetProperty("uid").GetString()!,
            RelationType = value.GetProperty("relation").GetString()!,
            Gap = value.GetProperty("gap").GetString()!,
        };

    internal JsonElement Document()
    {
        if (
            _original is JsonElement unchanged
            && Uid == _initialUid
            && RelationType == _initialRelation
            && Gap == _initialGap
        )
            return unchanged.Clone();
        if (!IsEditable)
            throw new ArgumentException("This existing dependency is read-only.");
        if (string.IsNullOrWhiteSpace(Uid) || string.IsNullOrWhiteSpace(RelationType))
            throw new ArgumentException(
                "Enter a dependency reference and choose its relationship."
            );
        var fields = _original is JsonElement original
            ? original
                .EnumerateObject()
                .ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal)
            : new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        void Put(string name, string value, string before)
        {
            if (_original is null || value != before)
                fields[name] = JsonSerializer.SerializeToElement(value);
        }
        Put("uid", Uid, _initialUid);
        Put("reltype", RelationType, _initialRelation);
        if (Gap != _initialGap)
        {
            if (Gap.Length == 0)
                fields.Remove("gap");
            else
                fields["gap"] = JsonSerializer.SerializeToElement(Gap);
        }
        return JsonSerializer.SerializeToElement(fields);
    }
}
