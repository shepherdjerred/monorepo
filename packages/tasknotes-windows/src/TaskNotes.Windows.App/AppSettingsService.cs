using System.Runtime.InteropServices;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Security.Credentials;
using Windows.Storage;

namespace TaskNotes.Windows.App
{
    internal sealed class AppSettingsService : IServerConfigurationStore, IShellPreferencesStore
    {
        private const string ServerUrlKey = "server-url";
#if TASKNOTES_E2E
        private const string CredentialResource = "red.sjer.TaskNotes.E2E";
#else
        private const string CredentialResource = "red.sjer.TaskNotes";
#endif
        private const string CredentialUser = "sync-token";

        private readonly TaskNotesConfigurationStorage _storage = new(
            new LocalServerUrlSettings(),
            new CredentialTokenSettings()
        );
        private readonly ApplicationDataContainer _localSettings = ApplicationData
            .Current
            .LocalSettings;

        public ServerConfiguration Load()
        {
            TaskNotesConfiguration configuration = _storage.Load();
            return new ServerConfiguration(configuration.ServerUrl, configuration.Token);
        }

        ShellPreferences IShellPreferencesStore.Load()
        {
            return LoadShell();
        }

        public void Save(string serverUrl, string? token)
        {
            _storage.Save(serverUrl, token);
        }

        public ShellPreferences LoadShell()
        {
            return ShellPreferencesCodec.Load(_localSettings.Values);
        }

        public void Save(ShellPreferences preferences)
        {
            ShellPreferencesCodec.Save(_localSettings.Values, preferences);
        }

#if TASKNOTES_E2E
        internal void ResetForE2E()
        {
            _localSettings.Values.Clear();
            PasswordVault vault = new();
            PasswordCredential? previous = CredentialTokenSettings.FindCredential(vault);
            if (previous is not null)
            {
                vault.Remove(previous);
            }
        }
#endif

        private sealed class LocalServerUrlSettings : IServerUrlSettings
        {
            public string? Load()
            {
                object? stored = ApplicationData.Current.LocalSettings.Values[ServerUrlKey];
                return stored is string serverUrl ? serverUrl
                    : stored is null ? null
                    : throw new InvalidDataException(
                        "The TaskNotes server URL setting has the wrong value type."
                    );
            }

            public void Save(string serverUrl)
            {
                ApplicationData.Current.LocalSettings.Values[ServerUrlKey] = serverUrl;
            }
        }

        private sealed class CredentialTokenSettings : ITokenSettings
        {
            public string? Load()
            {
                try
                {
                    PasswordCredential credential = new PasswordVault().Retrieve(
                        CredentialResource,
                        CredentialUser
                    );
                    credential.RetrievePassword();
                    return credential.Password;
                }
                catch (COMException exception)
                    when (exception.HResult == unchecked((int)0x80070490))
                {
                    return null;
                }
            }

            public void Save(string? token)
            {
                PasswordVault vault = new();
                PasswordCredential? previous = FindCredential(vault);
                if (previous is not null)
                {
                    vault.Remove(previous);
                }

                if (!string.IsNullOrWhiteSpace(token))
                {
                    vault.Add(new PasswordCredential(CredentialResource, CredentialUser, token));
                }
            }

            internal static PasswordCredential? FindCredential(PasswordVault vault)
            {
                try
                {
                    return vault.Retrieve(CredentialResource, CredentialUser);
                }
                catch (COMException exception)
                    when (exception.HResult == unchecked((int)0x80070490))
                {
                    return null;
                }
            }
        }
    }
}
