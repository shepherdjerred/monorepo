namespace TaskNotes.Windows.Presentation
{
    /// <summary>Server configuration with the secret kept behind a platform store.</summary>
    public sealed record ServerConfiguration(string? ServerUrl, string? Token);

    /// <summary>Device-local shell preferences that contain no credentials.</summary>
    public sealed record ShellPreferences(
        string NavigationRoute,
        bool InspectorVisible,
        string QuickAddHotkey,
        double WindowWidth,
        double WindowHeight
    );

    /// <summary>Loads and saves server configuration through platform-secure storage.</summary>
    public interface IServerConfigurationStore
    {
        /// <summary>Loads the configured URL and token.</summary>
        ServerConfiguration Load();

        /// <summary>Saves the URL and token after successful validation.</summary>
        void Save(string serverUrl, string? token);
    }

    /// <summary>Loads and saves non-secret shell preferences.</summary>
    public interface IShellPreferencesStore
    {
        /// <summary>Loads validated shell preferences.</summary>
        ShellPreferences Load();

        /// <summary>Saves validated shell preferences.</summary>
        void Save(ShellPreferences preferences);
    }

    /// <summary>Registers a platform-global Quick Add binding.</summary>
    public interface IGlobalHotkeyRegistrar : IDisposable
    {
        /// <summary>Registers a binding, returning false for a collision.</summary>
        bool Register(string binding);

        /// <summary>Clears the current registration.</summary>
        void Clear();
    }

    /// <summary>Dispatches work to the presentation thread.</summary>
    public interface IUiDispatcher
    {
        /// <summary>Gets whether the caller already has presentation-thread access.</summary>
        bool HasThreadAccess { get; }

        /// <summary>Enqueues work for the presentation thread.</summary>
        void Enqueue(Action action);
    }
}
