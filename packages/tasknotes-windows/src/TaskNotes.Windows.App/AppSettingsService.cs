using System.Runtime.InteropServices;
using System.Text.Json;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Security.Credentials;
using Windows.Storage;

namespace TaskNotes.Windows.App;

internal sealed class AppSettingsService
    : IFacetSecretStore,
        IServerConfigurationStore,
        IShellPreferencesStore
{
#if TASKNOTES_E2E
    private const string CredentialResource = "red.sjer.Facet.E2E";
#else
    private const string CredentialResource = "red.sjer.Facet";
#endif
    private const string ServerUrlKey = "server-url";
    private const string ServerTokenIdentity = "server-token";

    private readonly ApplicationDataContainer? _packagedSettings;
    private readonly string? _unpackagedSettingsPath;
    private readonly Dictionary<string, object>? _unpackagedValues;
    private readonly string _credentialResource = CredentialResource;
    private readonly object _gate = new();

    public AppSettingsService()
    {
        if (PackageIdentity.IsPackaged)
        {
            _packagedSettings = ApplicationData.Current.LocalSettings;
        }
        else
        {
            _unpackagedSettingsPath = Path.Combine(PackageIdentity.LocalDataRoot, "settings.json");
            _unpackagedValues = LoadUnpackagedValues(_unpackagedSettingsPath);
        }
    }

#if TASKNOTES_E2E
    internal AppSettingsService(string runId)
    {
        if (!Guid.TryParseExact(runId, "D", out Guid parsed) || parsed.ToString("D") != runId)
            throw new ArgumentException(
                "Invalid standalone acceptance settings owner.",
                nameof(runId)
            );
        _credentialResource = CredentialResource + "." + runId;
        if (PackageIdentity.IsPackaged)
        {
            _packagedSettings = ApplicationData.Current.LocalSettings.CreateContainer(
                "FacetAcceptance." + runId,
                ApplicationDataCreateDisposition.Always
            );
        }
        else
        {
            _unpackagedSettingsPath = Path.Combine(
                PackageIdentity.LocalDataRoot,
                $"settings.{runId}.json"
            );
            _unpackagedValues = LoadUnpackagedValues(_unpackagedSettingsPath);
        }
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
                _ = exception;
                return null;
            }
        }
    }

    void IFacetSecretStore.Save(string identity, string value) => SaveSecret(identity, value);

    private void SaveSecret(string identity, string value)
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
            {
                _ = exception;
            }
        }
    }

    public ServerConfiguration Load()
    {
        lock (_gate)
        {
            IDictionary<string, object> values = ActiveValues();
            string? serverUrl =
                values.TryGetValue(ServerUrlKey, out object? rawUrl) && rawUrl is string savedUrl
                    ? savedUrl
                    : null;
            string? token = Read(ServerTokenIdentity);
            return new ServerConfiguration(serverUrl, token);
        }
    }

    public void Save(string serverUrl, string? token)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serverUrl);
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(token))
                Remove(ServerTokenIdentity);
            else
                SaveSecret(ServerTokenIdentity, token.Trim());

            IDictionary<string, object> values = ActiveValues();
            values[ServerUrlKey] = serverUrl.Trim();
            FlushUnpackagedIfNeeded();
        }
    }

    ShellPreferences IShellPreferencesStore.Load() => LoadShell();

    public ShellPreferences LoadShell()
    {
        lock (_gate)
            return ShellPreferencesCodec.Load(ActiveValues());
    }

    internal bool TaskSoundsNeedsRecovery
    {
        get
        {
            lock (_gate)
            {
                return ActiveValues().TryGetValue("task-sounds", out object? value)
                    && value is not bool;
            }
        }
    }

    internal void SaveTaskSounds(bool enabled)
    {
        lock (_gate)
        {
            ActiveValues()["task-sounds"] = enabled;
            FlushUnpackagedIfNeeded();
        }
    }

    public void Save(ShellPreferences preferences)
    {
        lock (_gate)
        {
            ShellPreferencesCodec.Save(ActiveValues(), preferences);
            FlushUnpackagedIfNeeded();
        }
    }

#if TASKNOTES_E2E
    internal void ResetForE2E()
    {
        lock (_gate)
        {
            ActiveValues().Clear();
            FlushUnpackagedIfNeeded();
            PasswordVault vault = new();
            try
            {
                foreach (var credential in vault.FindAllByResource(_credentialResource))
                    vault.Remove(credential);
            }
            catch (COMException exception) when (exception.HResult == unchecked((int)0x80070490))
            {
                _ = exception;
            }
        }
    }
#endif

    private IDictionary<string, object> ActiveValues() =>
        _packagedSettings is not null ? _packagedSettings.Values : _unpackagedValues!;

    private void FlushUnpackagedIfNeeded()
    {
        if (_unpackagedSettingsPath is null || _unpackagedValues is null)
            return;
        string directory = Path.GetDirectoryName(_unpackagedSettingsPath)!;
        Directory.CreateDirectory(directory);
        string tempPath = _unpackagedSettingsPath + ".tmp";
        string json = JsonSerializer.Serialize(_unpackagedValues);
        File.WriteAllText(tempPath, json);
        File.Move(tempPath, _unpackagedSettingsPath, overwrite: true);
    }

    private static Dictionary<string, object> LoadUnpackagedValues(string path)
    {
        Dictionary<string, object> values = new(StringComparer.Ordinal);
        if (!File.Exists(path))
            return values;
        using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path));
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Unpackaged settings file root must be a JSON object.");
        foreach (JsonProperty prop in doc.RootElement.EnumerateObject())
        {
            object? decoded = prop.Value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String => prop.Value.GetString()!,
                JsonValueKind.Number when prop.Value.TryGetInt32(out int intVal) => prop.Name
                == "settings-schema-version"
                    ? (object)intVal
                    : (double)intVal,
                JsonValueKind.Number => prop.Value.GetDouble(),
                _ => null,
            };
            if (decoded is not null)
                values[prop.Name] = decoded;
        }
        return values;
    }
}
