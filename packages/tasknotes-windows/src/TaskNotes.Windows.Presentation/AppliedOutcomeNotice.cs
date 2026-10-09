using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>At least six seconds of confirmation, paused for native keyboard focus or pointer hover.</summary>
public sealed class AppliedOutcomeNotice(TimeProvider? time = null)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private long _last;
    private bool _paused;
    private TimeSpan _remaining;

    /// <summary>The immutable receipt represented by this confirmation.</summary>
    public FacetAppliedFeedback? Outcome { get; private set; }

    /// <summary>Action-specific confirmation without inferred task state.</summary>
    public string Title =>
        Outcome?.Event switch
        {
            "created" => "Task added",
            "completed" => "Task completed",
            "reopened" => "Task reopened",
            "deleted" => "Task deleted",
            "undone" => "Change undone",
            _ => "Saved",
        };

    /// <summary>Present an applied receipt with a fresh six-second interval.</summary>
    public void Show(FacetAppliedFeedback outcome, TimeSpan? duration = null)
    {
        Outcome = outcome;
        _remaining =
            duration is { } preferred && preferred > TimeSpan.FromSeconds(6)
                ? preferred
                : TimeSpan.FromSeconds(6);
        _last = _time.GetTimestamp();
        _paused = false;
    }

    /// <summary>Advance visible time; ownership loss clears permanently.</summary>
    public bool Advance(bool focused, bool owns)
    {
        long now = _time.GetTimestamp();
        if (!_paused && !focused)
            _remaining -= _time.GetElapsedTime(_last, now);
        _last = now;
        _paused = focused;
        if (!owns || _remaining <= TimeSpan.Zero)
            Outcome = null;
        return Outcome is not null;
    }
}
