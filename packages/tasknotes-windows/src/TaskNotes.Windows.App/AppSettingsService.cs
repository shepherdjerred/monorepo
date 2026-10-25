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
    private readonly string _credentialResource = CredentialResource;
    private readonly object _gate = new();

    public AppSettingsService() { }

#if TASKNOTES_E2E
    internal AppSettingsService(string runId)
    {
        if (!Guid.TryParseExact(runId, "D", out Guid parsed) || parsed.ToString("D") != runId)
            throw new ArgumentException(
                "Invalid standalone acceptance settings owner.",
                nameof(runId)
            );
        _localSettings = ApplicationData.Current.LocalSettings.CreateContainer(
            "FacetAcceptance." + runId,
            ApplicationDataCreateDisposition.Always
        );
        _credentialResource = CredentialResource + "." + runId;
    }
#endif

    public string? Read(string identity)
    {
        lock (_gate)
        {
            try
            {
                PasswordCredential credential = new PasswordVault().Retrieve(
                    _credentialResource,
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
            vault.Add(new PasswordCredential(_credentialResource, identity, value));
        }
    }

    public void Remove(string identity)
    {
        lock (_gate)
        {
            PasswordVault vault = new();
            try
            {
                vault.Remove(vault.Retrieve(_credentialResource, identity));
            }
            catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490))
            { }
        }
    }

    ShellPreferences IShellPreferencesStore.Load() => LoadShell();

    public ShellPreferences LoadShell() => ShellPreferencesCodec.Load(_localSettings.Values);

    internal bool TaskSoundsNeedsRecovery =>
        _localSettings.Values.TryGetValue("task-sounds", out object? value) && value is not bool;

    internal void SaveTaskSounds(bool enabled) => _localSettings.Values["task-sounds"] = enabled;

    public void Save(ShellPreferences preferences) =>
        ShellPreferencesCodec.Save(_localSettings.Values, preferences);

#if TASKNOTES_E2E
    internal void ResetForE2E()
    {
        _localSettings.Values.Clear();
        PasswordVault vault = new();
        try
        {
            foreach (var credential in vault.FindAllByResource(_credentialResource))
                vault.Remove(credential);
        }
        catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490)) { }
    }
#endif
}
