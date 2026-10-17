namespace TaskNotes.Windows.Host;

/// <summary>An originating window's activation lifetime, independent of query/notice requests.</summary>
public sealed class FacetFeedbackScene
{
    private readonly object _gate = new();
    private long _generation;
    private bool _foreground;
    private bool _closed;

    /// <summary>Every deactivation invalidates already admitted actions, including focus-away-and-back.</summary>
    public void SetForeground(bool foreground)
    {
        lock (_gate)
        {
            if (!foreground)
                _generation++;
            _foreground = foreground && !_closed;
        }
    }

    /// <summary>Capture synchronously before the local action's first asynchronous wait.</summary>
    public FacetFeedbackLease Capture()
    {
        lock (_gate)
            return new(this, _generation, _foreground);
    }

    /// <summary>Closing never permits a captured lease to become active again.</summary>
    public void Close()
    {
        lock (_gate)
        {
            _closed = true;
            _foreground = false;
            _generation++;
        }
    }

    internal bool Owns(long generation, bool admittedForeground)
    {
        lock (_gate)
            return admittedForeground && !_closed && _foreground && generation == _generation;
    }
}

/// <summary>Immutable scene lease; a new activation cannot resurrect an older local action.</summary>
public sealed class FacetFeedbackLease
{
    private readonly FacetFeedbackScene _scene;
    private readonly long _generation;
    private readonly bool _foreground;

    internal FacetFeedbackLease(FacetFeedbackScene scene, long generation, bool foreground)
    {
        _scene = scene;
        _generation = generation;
        _foreground = foreground;
    }

    /// <summary>The originating scene has remained foreground throughout the admitted action.</summary>
    public bool IsCurrent => _scene.Owns(_generation, _foreground);
}
