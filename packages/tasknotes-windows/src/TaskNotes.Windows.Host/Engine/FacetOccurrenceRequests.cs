namespace TaskNotes.Windows.Host;

/// <summary>Coalesces profile requests while retaining external input that arrives during a captured traversal/drain.</summary>
internal sealed class FacetOccurrenceRequests
{
    private readonly object _gate = new();
    private readonly Dictionary<string, long> _pending = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _replans = new(StringComparer.Ordinal);
    private long _generation;

    internal void Request(string profile)
    {
        lock (_gate)
        {
            _pending[profile] = checked(++_generation);
            _replans[profile] = 1;
        }
    }

    internal bool RequestReplan(string profile, long capturedGeneration)
    {
        lock (_gate)
        {
            if (!_pending.TryGetValue(profile, out long current))
                return false;
            if (current != capturedGeneration)
                return true; // A newer external request already owns the next pass.
            if (_replans[profile] == 0)
                return false;
            _replans[profile]--;
            _pending[profile] = checked(++_generation);
            return true;
        }
    }

    internal KeyValuePair<string, long>[] Snapshot()
    {
        lock (_gate)
            return _pending.ToArray();
    }

    internal void Acknowledge(string profile, long generation)
    {
        lock (_gate)
            if (_pending.GetValueOrDefault(profile) == generation)
            {
                _pending.Remove(profile);
                _replans.Remove(profile);
            }
    }

    internal bool HasPending
    {
        get
        {
            lock (_gate)
                return _pending.Count != 0;
        }
    }
}
