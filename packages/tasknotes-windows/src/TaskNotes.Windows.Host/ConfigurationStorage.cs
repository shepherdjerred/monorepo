namespace TaskNotes.Windows.Host
{
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
