namespace TaskNotes.Windows.Host
{
    /// <summary>Platform-secure credential store backed by Windows Credential Locker in production.</summary>
    public interface IFacetSecretStore
    {
        /// <summary>Reads the stored secret for an account key, or null when absent.</summary>
        string? Read(string key);

        /// <summary>Persists a secret for an account key.</summary>
        void Save(string key, string value);

        /// <summary>Removes any stored secret for an account key.</summary>
        void Remove(string key);
    }

    internal interface IServerUrlSettings
    {
        string? Load();

        void Save(string serverUrl);
    }

    internal interface ITokenSettings
    {
        string? Load();

        void Save(string? token);
    }

    internal sealed record TaskNotesConfiguration(string? ServerUrl, string? Token);

    internal sealed class TaskNotesConfigurationStorage(
        IServerUrlSettings serverUrlSettings,
        ITokenSettings tokenSettings
    )
    {
        internal TaskNotesConfiguration Load()
        {
            return new TaskNotesConfiguration(serverUrlSettings.Load(), tokenSettings.Load());
        }

        internal void Save(string serverUrl, string? token)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(serverUrl);
            tokenSettings.Save(token);
            serverUrlSettings.Save(serverUrl);
        }
    }
}
