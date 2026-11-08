using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>A consumed local outcome with optional sound independent of visual confirmation.</summary>
public sealed record FeedbackDelivery(string Event, string? Sound);

/// <summary>Strict shared feedback policy and scene-local, at-most-once physical delivery.</summary>
public sealed class FeedbackPolicy
{
    private readonly JsonElement _policy;
    private readonly JsonElement _palette;
    private readonly HashSet<(string Engine, string Profile, string Mutation)> _consumed = [];
    private readonly object _gate = new();
    private readonly TimeProvider _time;
    private long? _lastAttempt;
    private TimeSpan _lastDuration;

    /// <summary>Reject drift, unknown values and incomplete shared contracts.</summary>
    public FeedbackPolicy(string policy, string palette, string schema, TimeProvider? time = null)
    {
        _time = time ?? TimeProvider.System;
        var validator = new FacetSchema(schema);
        validator.Validate(policy, "feedback");
        validator.Validate(palette, "palette");
        using var document = JsonDocument.Parse(policy);
        _policy = document.RootElement.Clone();
        using var paletteDocument = JsonDocument.Parse(palette);
        _palette = paletteDocument.RootElement.Clone();
    }

    /// <summary>Use the language-neutral resources bundled with the portable assembly.</summary>
    public static FeedbackPolicy Bundled() =>
        new(Read("FeedbackPolicy.json"), Read("FeedbackPalette.json"), Read("FeedbackSchema.json"));

    /// <summary>Fresh installs enable sounds independently of platform haptic availability.</summary>
    public bool DefaultSounds => _policy.GetProperty("defaults").GetProperty("sounds").GetBoolean();

    /// <summary>Validate packaged bytes against the strict first-party manifest.</summary>
    public void ValidateAsset(string cue, byte[] bytes)
    {
        string expected = _palette
            .GetProperty("cues")
            .GetProperty(cue)
            .GetProperty("sha256")
            .GetString()!;
        string actual = Convert.ToHexStringLower(
            System.Security.Cryptography.SHA256.HashData(bytes)
        );
        if (actual != expected)
            throw new InvalidDataException(
                $"The bundled {cue} feedback sound is missing or corrupt."
            );
    }

    /// <summary>Consume even suppressed outcomes; foreground restoration never replays them.</summary>
    public FeedbackDelivery? Observe(
        FacetAppliedFeedback feedback,
        string? profile,
        bool foreground,
        bool sounds
    )
    {
        lock (_gate)
        {
            if (
                !_consumed.Add(
                    (feedback.EngineSessionId, feedback.Owner.ProfileId, feedback.Owner.MutationId)
                )
            )
                return null;
            var outcome = _policy.GetProperty("events").GetProperty(feedback.Event);
            if (
                !feedback.Changed
                || !feedback.OwnsAdmission
                || feedback.Origin?.IsCurrent == false
                || feedback.Owner.ProfileId != profile
                || !foreground
            )
                return null;
            return new(feedback.Event, sounds ? outcome.GetProperty("sound").GetString() : null);
        }
    }

    /// <summary>Claim the physical duration immediately before playback, never on a producer thread.</summary>
    public bool TryBeginPlayback(string cue)
    {
        lock (_gate)
        {
            long now = _time.GetTimestamp();
            if (
                _lastAttempt is long previous
                && _time.GetElapsedTime(previous, now) < _lastDuration
            )
                return false;
            _lastAttempt = now;
            _lastDuration = TimeSpan.FromMilliseconds(
                _palette
                    .GetProperty("cues")
                    .GetProperty(cue)
                    .GetProperty("milliseconds")
                    .GetDouble()
            );
            return true;
        }
    }

    private static string Read(string name)
    {
        using var stream =
            typeof(FeedbackPolicy).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidDataException("The shared feedback contract is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
