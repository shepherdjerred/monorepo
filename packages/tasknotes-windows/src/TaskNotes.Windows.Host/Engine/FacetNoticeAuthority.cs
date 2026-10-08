namespace TaskNotes.Windows.Host;

/// <summary>An immutable admission ticket is captured before validation or queueing.</summary>
public sealed record FacetNoticeAdmission(long RequestGeneration, long EngineGeneration);

/// <summary>Admission ownership prevents retained or queued Saved notices surviving a new request.</summary>
public sealed class FacetNoticeAuthority
{
    private readonly object _gate = new();
    private long _request;
    private long _engine = 1;
    private bool _closed;
    private FacetNoticeOwner? _owner;

    /// <summary>Invalidate the previous notice and capture this request's immutable ticket.</summary>
    public FacetNoticeAdmission Begin(Action? clear = null)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_closed, this);
            _owner = null;
            clear?.Invoke();
            return new(++_request, _engine);
        }
    }

    /// <summary>Bind a mutation to its original admission without reviving an older queued request.</summary>
    public FacetNoticeOwner Capture(
        FacetNoticeAdmission admission,
        string profileId,
        string mutationId
    )
    {
        ArgumentNullException.ThrowIfNull(admission);
        ArgumentException.ThrowIfNullOrEmpty(profileId);
        ArgumentException.ThrowIfNullOrEmpty(mutationId);
        var owner = new FacetNoticeOwner(
            profileId,
            mutationId,
            admission.RequestGeneration,
            admission.EngineGeneration
        );
        lock (_gate)
        {
            if (
                !_closed
                && admission.RequestGeneration == _request
                && admission.EngineGeneration == _engine
            )
                _owner = owner;
        }
        return owner;
    }

    /// <summary>Check current request, profile and engine ownership at the point of presentation.</summary>
    public bool Owns(FacetNoticeOwner owner, string? selectedProfileId)
    {
        lock (_gate)
            return !_closed
                && owner == _owner
                && owner.RequestGeneration == _request
                && owner.EngineGeneration == _engine
                && owner.ProfileId == selectedProfileId;
    }

    /// <summary>Publish synchronous state only while this original owner remains admitted.</summary>
    public bool PublishIfOwned(FacetNoticeOwner owner, string? selectedProfileId, Action publish)
    {
        ArgumentNullException.ThrowIfNull(publish);
        lock (_gate)
        {
            if (!Owns(owner, selectedProfileId))
                return false;
            publish();
            return true;
        }
    }

    /// <summary>Apply a synchronous observation with ownership checked atomically with admission.</summary>
    public void Observe(string? selectedProfileId, Action<FacetNoticeOwner?> publish)
    {
        ArgumentNullException.ThrowIfNull(publish);
        lock (_gate)
            publish(_owner is { } owner && Owns(owner, selectedProfileId) ? owner : null);
    }

    /// <summary>Invalidate all tickets when the engine owner closes; repeated closure is harmless.</summary>
    public void Close(Action? clear = null)
    {
        lock (_gate)
        {
            if (_closed)
                return;
            _closed = true;
            _owner = null;
            _request++;
            _engine++;
            clear?.Invoke();
        }
    }
}
