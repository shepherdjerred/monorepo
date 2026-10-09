using System.Collections.ObjectModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>A removable preview field with exact token identity.</summary>
public sealed record CaptureChip(string Kind, string? Value, string Label);

public sealed partial class QuickAddViewModel
{
    private string? _draftProfile;
    private bool _hasDraftOwner;
    private string _body = "";
    private DateTimeOffset? _due;
    private DateTimeOffset? _scheduled;
    private WorkflowChoice? _priority;
    private string _projectEntry = "";
    private string _contextEntry = "";
    private string _tagEntry = "";
    private FacetCaptureOptions _overrides = new();

    private void ResetEmptyDraftOwner()
    {
        if (HasDraft)
            return;
        _hasDraftOwner = false;
        _draftProfile = null;
    }

    /// <summary>The first draft owns its profile until discard or confirmed reset.</summary>
    public string? OwningProfile
    {
        get
        {
            if (!_hasDraftOwner)
            {
                _draftProfile = (_store as IFacetCaptureStore)?.SelectedProfileId;
                _hasDraftOwner = true;
            }
            return _draftProfile;
        }
    }

    /// <summary>Opening capture preserves unsaved or retained input.</summary>
    public bool HasDraft =>
        IsSubmitting
        || RecoveryActionId is not null
        || NeedsObservation
        || _confirmedGeneration != _inputGeneration
            && (
                !string.IsNullOrWhiteSpace(Input)
                || _overrides.HasOverrides
                || ProjectEntry.Length > 0
                || ContextEntry.Length > 0
                || TagEntry.Length > 0
            );

    /// <summary>Uncommitted project text participates in draft ownership and close guards.</summary>
    public string ProjectEntry
    {
        get => _projectEntry;
        set => Entry(ref _projectEntry, value, nameof(ProjectEntry));
    }

    /// <summary>Uncommitted context text is retained when capture closes.</summary>
    public string ContextEntry
    {
        get => _contextEntry;
        set => Entry(ref _contextEntry, value, nameof(ContextEntry));
    }

    /// <summary>Uncommitted tag text is retained when capture closes.</summary>
    public string TagEntry
    {
        get => _tagEntry;
        set => Entry(ref _tagEntry, value, nameof(TagEntry));
    }

    private void Entry(ref string field, string value, string property)
    {
        if (field == value)
            return;
        ResetEmptyDraftOwner();
        field = value;
        Changed(property);
    }

    /// <summary>Save closes only if no newer draft replaced its submitted generation.</summary>
    public bool CanDismissAfterSave =>
        _confirmedGeneration == _inputGeneration
        && !IsSubmitting
        && RecoveryActionId is null
        && !NeedsObservation;

    /// <summary>Explicit Markdown body, including an intentional empty body.</summary>
    public string Body
    {
        get => _body;
        set
        {
            if (_body == value)
                return;
            ResetEmptyDraftOwner();
            _body = value;
            _overrides = _overrides with { Body = new(value) };
            Changed(nameof(Body));
        }
    }

    /// <summary>Null deliberately clears a parsed due date.</summary>
    public DateTimeOffset? Due
    {
        get => _due;
        set
        {
            if (_due == value)
                return;
            ResetEmptyDraftOwner();
            _due = value;
            _overrides = _overrides with { Due = new(Date(value)) };
            Changed(nameof(Due));
        }
    }

    /// <summary>Explicit planned date override.</summary>
    public DateTimeOffset? Scheduled
    {
        get => _scheduled;
        set
        {
            if (_scheduled == value)
                return;
            ResetEmptyDraftOwner();
            _scheduled = value;
            _overrides = _overrides with { Scheduled = new(Date(value)) };
            Changed(nameof(Scheduled));
        }
    }

    /// <summary>A configured priority override, or explicit clear.</summary>
    public WorkflowChoice? Priority
    {
        get => _priority;
        set
        {
            if (_priority == value)
                return;
            ResetEmptyDraftOwner();
            _priority = value;
            _overrides = _overrides with { Priority = new(value?.Value) };
            Changed(nameof(Priority));
        }
    }

    /// <summary>Exact project tokens, including punctuation.</summary>
    public ObservableCollection<string> Projects { get; } = [];

    /// <summary>Exact context tokens.</summary>
    public ObservableCollection<string> Contexts { get; } = [];

    /// <summary>Exact tag tokens.</summary>
    public ObservableCollection<string> Tags { get; } = [];

    /// <summary>Configured native priority choices.</summary>
    public IReadOnlyList<WorkflowChoice> PriorityChoices => _store.State.PriorityChoices;

    /// <summary>Whole-vault project suggestions.</summary>
    public IReadOnlyList<string> ProjectChoices => _store.State.Projects;

    /// <summary>Whole-vault context suggestions.</summary>
    public IReadOnlyList<string> ContextChoices => _store.State.Contexts;

    /// <summary>Whole-vault tag suggestions.</summary>
    public IReadOnlyList<string> TagChoices => _store.State.Tags;

    /// <summary>Removable fields from the core parse and deliberate overrides.</summary>
    public IReadOnlyList<CaptureChip> CaptureChips =>
        Preview is not { } preview
            ? []
            :
            [
                .. preview.Due is null
                    ? Array.Empty<CaptureChip>()
                    : [new("due", preview.Due, $"Due {preview.Due}")],
                .. preview.Scheduled is null
                    ? Array.Empty<CaptureChip>()
                    : [new("scheduled", preview.Scheduled, $"Planned {preview.Scheduled}")],
                .. string.IsNullOrEmpty(preview.Priority)
                    ? Array.Empty<CaptureChip>()
                    : [new("priority", preview.Priority, preview.Priority)],
                .. preview.Projects.Select(value => new CaptureChip("projects", value, value)),
                .. preview.Contexts.Select(value => new CaptureChip(
                    "contexts",
                    value,
                    "@" + value
                )),
                .. preview.Tags.Select(value => new CaptureChip("tags", value, "#" + value)),
                .. preview.Recurrence is null
                    ? Array.Empty<CaptureChip>()
                    : [new("recurrence", preview.Recurrence, preview.Recurrence)],
            ];

    /// <summary>Add one exact token; punctuation never becomes a delimiter.</summary>
    public void AddToken(string kind, string value)
    {
        value = value.Trim();
        if (value.Length == 0)
            return;
        var existing = kind switch
        {
            "projects" => _overrides.Projects?.Value ?? Preview?.Projects ?? [],
            "contexts" => _overrides.Contexts?.Value ?? Preview?.Contexts ?? [],
            "tags" => _overrides.Tags?.Value ?? Preview?.Tags ?? [],
            _ => throw new ArgumentException("Unknown token kind.", nameof(kind)),
        };
        SetTokens(
            kind,
            existing.Contains(value, StringComparer.Ordinal) ? existing : [.. existing, value]
        );
    }

    /// <summary>Removing parsed fields writes canonical null or an exact remaining array.</summary>
    public void RemoveChip(CaptureChip chip)
    {
        ResetEmptyDraftOwner();
        switch (chip.Kind)
        {
            case "due":
                _due = null;
                _overrides = _overrides with { Due = new(null) };
                Changed(nameof(Due));
                break;
            case "scheduled":
                _scheduled = null;
                _overrides = _overrides with { Scheduled = new(null) };
                Changed(nameof(Scheduled));
                break;
            case "priority":
                _priority = null;
                _overrides = _overrides with { Priority = new(null) };
                Changed(nameof(Priority));
                break;
            case "recurrence":
                _overrides = _overrides with { Recurrence = new(null) };
                Changed(nameof(CaptureChips));
                break;
            case "projects":
                SetTokens(
                    chip.Kind,
                    (_overrides.Projects?.Value ?? Preview?.Projects ?? [])
                        .Where(value => value != chip.Value)
                        .ToArray()
                );
                break;
            case "contexts":
                SetTokens(
                    chip.Kind,
                    (_overrides.Contexts?.Value ?? Preview?.Contexts ?? [])
                        .Where(value => value != chip.Value)
                        .ToArray()
                );
                break;
            case "tags":
                SetTokens(
                    chip.Kind,
                    (_overrides.Tags?.Value ?? Preview?.Tags ?? [])
                        .Where(value => value != chip.Value)
                        .ToArray()
                );
                break;
            default:
                throw new ArgumentException("Unknown capture chip.", nameof(chip));
        }
    }

    /// <summary>Deliberately clear even a body supplied by natural-language parsing.</summary>
    public void ClearBody()
    {
        ResetEmptyDraftOwner();
        _body = "";
        _overrides = _overrides with { Body = new("") };
        Changed(nameof(Body));
    }

    private void SetTokens(string kind, IReadOnlyList<string> tokens)
    {
        ResetEmptyDraftOwner();
        var collection = kind switch
        {
            "projects" => Projects,
            "contexts" => Contexts,
            "tags" => Tags,
            _ => throw new ArgumentException("Unknown token kind.", nameof(kind)),
        };
        collection.Clear();
        foreach (string token in tokens)
            collection.Add(token);
        _overrides = kind switch
        {
            "projects" => _overrides with { Projects = new(tokens.ToArray()) },
            "contexts" => _overrides with { Contexts = new(tokens.ToArray()) },
            "tags" => _overrides with { Tags = new(tokens.ToArray()) },
            _ => throw new ArgumentException("Unknown token kind.", nameof(kind)),
        };
        Changed(kind);
    }

    private void Changed(string property)
    {
        _ = OwningProfile;
        _inputGeneration++;
        OnPropertyChanged(property);
        OnPropertyChanged(nameof(HasDraft));
        OnPropertyChanged(nameof(CanSubmit));
    }

    private static string? Date(DateTimeOffset? value) =>
        value?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private FacetCaptureOptions CaptureOptions() => _overrides.Freeze();

    private void ClearDetails()
    {
        _body = "";
        _due = null;
        _scheduled = null;
        _priority = null;
        _projectEntry = "";
        _contextEntry = "";
        _tagEntry = "";
        Projects.Clear();
        Contexts.Clear();
        Tags.Clear();
        _overrides = new();
        _hasDraftOwner = false;
        _draftProfile = null;
        foreach (
            string name in new[]
            {
                nameof(Body),
                nameof(Due),
                nameof(Scheduled),
                nameof(Priority),
                nameof(ProjectEntry),
                nameof(ContextEntry),
                nameof(TagEntry),
                nameof(HasDraft),
            }
        )
            OnPropertyChanged(name);
    }
}
