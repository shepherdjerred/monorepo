using System.Runtime.InteropServices;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Security.Credentials;
using Windows.Storage;

namespace TaskNotes.Windows.App;

internal sealed class AppSettingsService : IFacetSecretStore, IShellPreferencesStore
{
#if TASKNOTES_E2E
    private const string CredentialResource = "red.sjer.Facet.E2E";
#else
    private const string CredentialResource = "red.sjer.Facet";
#endif
    private readonly ApplicationDataContainer _localSettings = ApplicationData
        .Current
        .LocalSettings;
    private readonly object _gate = new();

    public string? Read(string identity)
    {
        lock (_gate)
        {
            try
            {
                PasswordCredential credential = new PasswordVault().Retrieve(
                    CredentialResource,
                    identity
                );
                credential.RetrievePassword();
                return credential.Password;
            }
            catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490))
            {
                return null;
            }
        }
    }

    public void Save(string identity, string value)
    {
        ArgumentException.ThrowIfNullOrEmpty(value);
        lock (_gate)
        {
            PasswordVault vault = new();
            Remove(identity);
            vault.Add(new PasswordCredential(CredentialResource, identity, value));
        }
    }

    public void Remove(string identity)
    {
        lock (_gate)
        {
            PasswordVault vault = new();
            try
            {
                vault.Remove(vault.Retrieve(CredentialResource, identity));
            }
            catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490))
            { }
        }
    }

    ShellPreferences IShellPreferencesStore.Load() => LoadShell();

    public ShellPreferences LoadShell() => ShellPreferencesCodec.Load(_localSettings.Values);

    public void Save(ShellPreferences preferences) =>
        ShellPreferencesCodec.Save(_localSettings.Values, preferences);

#if TASKNOTES_E2E
    internal void ResetForE2E()
    {
        _localSettings.Values.Clear();
        PasswordVault vault = new();
        try
        {
            foreach (var credential in vault.FindAllByResource(CredentialResource))
                vault.Remove(credential);
        }
        catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490)) { }
    }
#endif
}
