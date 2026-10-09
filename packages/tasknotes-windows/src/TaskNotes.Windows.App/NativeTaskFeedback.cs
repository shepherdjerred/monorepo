using TaskNotes.Windows.Presentation;
using Windows.Media.Core;
using Windows.Media.Playback;

namespace TaskNotes.Windows.App;

/// <summary>Short bundled effects without transport controls or background playback.</summary>
internal sealed class NativeTaskFeedback : IDisposable
{
    private readonly Dictionary<string, MediaPlayer> _players = new(StringComparer.Ordinal);
    private readonly HashSet<string> _ready = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    internal NativeTaskFeedback(FeedbackPolicy policy, Action<string> failed)
    {
        foreach (string cue in new[] { "create", "complete", "delete", "reverse" })
        {
            string path = Path.Combine(
                AppContext.BaseDirectory,
                "Assets",
                "Feedback",
                cue + ".wav"
            );
            policy.ValidateAsset(cue, File.ReadAllBytes(path));
            var player = new MediaPlayer
            {
                AutoPlay = false,
                AudioCategory = MediaPlayerAudioCategory.SoundEffects,
            };
            player.CommandManager.IsEnabled = false;
            player.MediaOpened += (_, _) =>
            {
                lock (_gate)
                    _ready.Add(cue);
            };
            player.MediaFailed += (_, _) =>
            {
                lock (_gate)
                    _ready.Remove(cue);
                failed(
                    "Windows could not load a task feedback sound. Check sound output or disable task sounds in Settings."
                );
            };
            _players.Add(cue, player);
            player.Source = MediaSource.CreateFromUri(
                new Uri($"ms-appx:///Assets/Feedback/{cue}.wav")
            );
        }
    }

    internal void TryPlay(string cue, Func<bool> claim)
    {
        lock (_gate)
        {
            // Unready effects are consumed without scheduling a late playback.
            if (!_ready.Contains(cue) || !claim())
                return;
            var player = _players[cue];
            player.PlaybackSession.Position = TimeSpan.Zero;
            player.Play();
        }
    }

    public void Dispose()
    {
        foreach (var player in _players.Values)
            player.Dispose();
        _players.Clear();
        lock (_gate)
            _ready.Clear();
    }

    internal void Stop()
    {
        foreach (var player in _players.Values)
            player.Pause();
    }
}
