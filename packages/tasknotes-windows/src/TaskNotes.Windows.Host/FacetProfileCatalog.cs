using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Device capability and remote selection, without credentials.</summary>
public sealed record FacetProfileRegistration(
    string Id,
    string Name,
    string RootPath,
    bool PrivateReplica,
    bool ApproveStandard,
    string? AccountOwner,
    ObsidianVaultChoice? Vault
);

/// <summary>Persisted vault selection; shell selection does not control background synchronization.</summary>
public sealed class FacetProfileCatalog
{
    private readonly string _path;
    private readonly object _gate = new();
    private Catalog _catalog;
    private readonly HashSet<string> _observedRemoved = new(StringComparer.Ordinal);
    private static readonly JsonSerializerOptions MetadataOptions = new()
    {
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
    };

    /// <summary>Restore the exact versioned local capability envelope.</summary>
    public FacetProfileCatalog(string directory)
    {
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, "profiles.json");
        _catalog = File.Exists(_path)
            ? ReadCatalog(_path)
            : new Catalog(1, null, Guid.NewGuid().ToString("N"), []);
        if (
            _catalog.SchemaVersion != 1
            || _catalog.Profiles.Select(p => p.Id).Distinct(StringComparer.Ordinal).Count()
                != _catalog.Profiles.Length
            || (
                _catalog.SelectedId is not null
                && !_catalog.Profiles.Any(p => p.Id == _catalog.SelectedId)
            )
        )
            throw new InvalidDataException("The profile catalog version or selection is invalid.");
    }

    /// <summary>Stable device identity for local timers.</summary>
    public string DeviceId
    {
        get
        {
            lock (_gate)
                return _catalog.DeviceId;
        }
    }

    /// <summary>Registered capabilities.</summary>
    public IReadOnlyList<FacetProfileRegistration> Profiles
    {
        get
        {
            lock (_gate)
                return _catalog.Profiles.Where(p => !_observedRemoved.Contains(p.Id)).ToArray();
        }
    }

    /// <summary>Visible profile, when configured.</summary>
    public string? SelectedId
    {
        get
        {
            lock (_gate)
                return _catalog.SelectedId is { } selected && !_observedRemoved.Contains(selected)
                    ? selected
                    : _catalog.Profiles.FirstOrDefault(p => !_observedRemoved.Contains(p.Id))?.Id;
        }
    }

    /// <summary>Removal intents retained until native state and profile-only rights cleanup both complete.</summary>
    internal IReadOnlyList<FacetProfileRegistration> PendingRemovals
    {
        get
        {
            lock (_gate)
                return (_catalog.RemovingProfiles ?? []).ToArray();
        }
    }

    internal void BeginRemoval(string id)
    {
        lock (_gate)
        {
            var profile = _catalog.Profiles.Single(p => p.Id == id);
            if ((_catalog.RemovingProfiles ?? []).Any(p => p.Id == id))
                return;
            Save(
                _catalog with
                {
                    RemovingProfiles = [.. _catalog.RemovingProfiles ?? [], profile],
                }
            );
        }
    }

    internal void CommitRemoval(string id)
    {
        lock (_gate)
        {
            if (!(_catalog.RemovingProfiles ?? []).Any(p => p.Id == id))
                throw new InvalidDataException(
                    "Profile removal requires its durable owning intent."
                );
            var remaining = _catalog.Profiles.Where(p => p.Id != id).ToArray();
            Save(
                _catalog with
                {
                    Profiles = remaining,
                    SelectedId =
                        _catalog.SelectedId == id
                            ? remaining.FirstOrDefault()?.Id
                            : _catalog.SelectedId,
                }
            );
        }
    }

    /// <summary>Authoritative core success fences presentation even if subsequent metadata/credential I/O fails.</summary>
    internal void ObserveRemoval(string id)
    {
        lock (_gate)
            _observedRemoved.Add(id);
    }

    internal void FinishRemoval(string id)
    {
        lock (_gate)
            Save(
                _catalog with
                {
                    RemovingProfiles = (_catalog.RemovingProfiles ?? [])
                        .Where(p => p.Id != id)
                        .ToArray(),
                }
            );
    }

    /// <summary>Commit a validated new capability after Rust registration.</summary>
    public void Add(FacetProfileRegistration profile)
    {
        lock (_gate)
        {
            if (_catalog.Profiles.Any(p => p.Id == profile.Id))
                throw new InvalidOperationException("The profile is already registered.");
            Save(
                _catalog with
                {
                    Profiles = [.. _catalog.Profiles, profile],
                    SelectedId = profile.Id,
                }
            );
        }
    }

    /// <summary>Change only the visible vault.</summary>
    public void Select(string id)
    {
        lock (_gate)
        {
            if (!_catalog.Profiles.Any(p => p.Id == id))
                throw new ArgumentException("Unknown profile.", nameof(id));
            Save(_catalog with { SelectedId = id });
        }
    }

    /// <summary>Replace remote authorization ownership while retaining the same private replica.</summary>
    public void Reauthorize(string id, string owner, ObsidianVaultChoice vault)
    {
        lock (_gate)
        {
            var profile = _catalog.Profiles.Single(p => p.Id == id);
            if (!profile.PrivateReplica || profile.Vault?.Id != vault.Id)
                throw new ArgumentException(
                    "The remote vault identity does not match this replica.",
                    nameof(vault)
                );
            Save(
                _catalog with
                {
                    Profiles = _catalog
                        .Profiles.Select(p =>
                            p.Id == id ? p with { AccountOwner = owner, Vault = vault } : p
                        )
                        .ToArray(),
                }
            );
        }
    }

    private void Save(Catalog next)
    {
        next = next with { RemovingProfiles = next.RemovingProfiles ?? [] };
        FacetDurableJson.Write(_path, next);
        _catalog = next;
    }

    private static Catalog ReadCatalog(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = document.RootElement;
        if (
            root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("SchemaVersion", out var version)
            || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out _)
            || !root.TryGetProperty(nameof(SelectedId), out var selected)
            || selected.ValueKind is not (JsonValueKind.String or JsonValueKind.Null)
            || !ValidText(root, "DeviceId")
            || !root.TryGetProperty(nameof(Profiles), out var profiles)
            || profiles.ValueKind != JsonValueKind.Array
            || root.TryGetProperty("RemovingProfiles", out var removing)
                && removing.ValueKind != JsonValueKind.Array
        )
            throw new InvalidDataException("The profile catalog shape is invalid.");
        Catalog result;
        try
        {
            result =
                root.Deserialize<Catalog>(MetadataOptions)
                ?? throw new InvalidDataException("The profile catalog is corrupt.");
        }
        catch (JsonException error)
        {
            throw new InvalidDataException(
                "The profile catalog violates its stored contract.",
                error
            );
        }
        if (string.IsNullOrEmpty(result.DeviceId))
            throw new InvalidDataException("The device identity is missing.");
        ValidateEntries(root.GetProperty(nameof(Profiles)));
        if (root.TryGetProperty("RemovingProfiles", out removing))
            ValidateEntries(removing);
        var pending = result.RemovingProfiles ?? [];
        if (
            pending.Select(p => p.Id).Distinct(StringComparer.Ordinal).Count() != pending.Length
            || pending.Any(p =>
                result.Profiles.FirstOrDefault(current => current.Id == p.Id) is { } owner
                && owner != p
            )
        )
            throw new InvalidDataException("The removal owner or identity is inconsistent.");
        return result;
    }

    private static void ValidateEntries(JsonElement entries)
    {
        foreach (var entry in entries.EnumerateArray())
        {
            if (
                entry.ValueKind != JsonValueKind.Object
                || entry.EnumerateObject().Count() != 7
                || !ValidText(entry, "Id")
                || !ValidText(entry, "Name")
                || !ValidText(entry, "RootPath")
                || !entry.TryGetProperty("PrivateReplica", out var privateReplica)
                || privateReplica.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !entry.TryGetProperty("ApproveStandard", out var approved)
                || approved.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !entry.TryGetProperty("AccountOwner", out var owner)
                || owner.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)
                || !entry.TryGetProperty("Vault", out var vault)
                || vault.ValueKind is not (JsonValueKind.Null or JsonValueKind.Object)
                || (owner.ValueKind == JsonValueKind.Null)
                    != (vault.ValueKind == JsonValueKind.Null)
                || owner.ValueKind == JsonValueKind.String
                    && string.IsNullOrEmpty(owner.GetString())
                || vault.ValueKind == JsonValueKind.Object
                    && (privateReplica.ValueKind != JsonValueKind.True || !ValidVault(vault))
            )
                throw new InvalidDataException("The profile capability record is invalid.");
        }
    }

    private static bool ValidVault(JsonElement vault) =>
        vault.EnumerateObject().Count() == 8
        && ValidText(vault, "Id")
        && ValidText(vault, "Name")
        && ValidText(vault, "Host")
        && vault.TryGetProperty("Region", out var region)
        && region.ValueKind == JsonValueKind.String
        && vault.TryGetProperty("Salt", out var salt)
        && salt.ValueKind == JsonValueKind.String
        && vault.TryGetProperty("EncryptionVersion", out var version)
        && version.ValueKind == JsonValueKind.Number
        && version.TryGetByte(out _)
        && vault.TryGetProperty("Managed", out var managed)
        && managed.ValueKind is JsonValueKind.True or JsonValueKind.False
        && vault.TryGetProperty("Shared", out var shared)
        && shared.ValueKind is JsonValueKind.True or JsonValueKind.False;

    private static bool ValidText(JsonElement value, string field) =>
        value.TryGetProperty(field, out var text)
        && text.ValueKind == JsonValueKind.String
        && !string.IsNullOrEmpty(text.GetString());

    private sealed record Catalog(
        int SchemaVersion,
        string? SelectedId,
        string DeviceId,
        FacetProfileRegistration[] Profiles,
        FacetProfileRegistration[]? RemovingProfiles = null
    );
}

/// <summary>Standalone onboarding and vault selection consumed by presentation.</summary>
public interface IFacetProfileStore
{
    /// <summary>Available local capabilities.</summary>
    IReadOnlyList<FacetProfileRegistration> Profiles { get; }

    /// <summary>The visible vault.</summary>
    string? SelectedProfileId { get; }

    /// <summary>Explicitly resume the original retained action in its owning selected profile.</summary>
    Task ResumeMutationAsync(string mutationId, CancellationToken cancellationToken = default);

    /// <summary>Retire a private envelope only after the native engine observes absent or parked state.</summary>
    Task RetireRejectedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    );

    /// <summary>Authorize the account without retaining input passwords.</summary>
    Task<ObsidianSignInOutcome> SignInAsync(
        string email,
        string password,
        string mfa,
        CancellationToken cancellationToken = default
    );

    /// <summary>Discover existing remote vaults.</summary>
    Task<IReadOnlyList<ObsidianVaultChoice>> ListVaultsAsync(
        CancellationToken cancellationToken = default
    );

    /// <summary>Create a private replica for an existing authorized remote vault.</summary>
    Task AddRemoteProfileAsync(
        ObsidianVaultChoice vault,
        string? password,
        bool approveStandard,
        CancellationToken cancellationToken = default
    );

    /// <summary>Register a read-only external folder.</summary>
    Task AddLocalProfileAsync(
        string name,
        string path,
        bool approveStandard,
        CancellationToken cancellationToken = default
    );

    /// <summary>Select a profile while preserving other sessions.</summary>
    Task SelectProfileAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Remove settled private state and this profile's rights after session drain; vault files remain intact.</summary>
    Task RemoveProfileAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Restore secure authorization for the same existing private replica.</summary>
    Task ReauthorizeProfileAsync(
        string id,
        string? password,
        CancellationToken cancellationToken = default
    );

    /// <summary>Stop sessions before removing secure account values.</summary>
    Task SignOutAsync(CancellationToken cancellationToken = default);

    /// <summary>Read durable competing versions for the selected profile.</summary>
    Task<IReadOnlyList<FacetConflict>> ConflictsAsync(
        CancellationToken cancellationToken = default
    );

    /// <summary>Choose one retained side with an explicit Rust resolution.</summary>
    Task ResolveConflictAsync(
        string id,
        string choice,
        CancellationToken cancellationToken = default
    );

    /// <summary>Load one retained conflict side explicitly for inspection.</summary>
    Task<byte[]?> ReadConflictPayloadAsync(
        string id,
        string version,
        CancellationToken cancellationToken = default
    );
}

/// <summary>Immutable version metadata; content is loaded separately and never enters diagnostics.</summary>
public sealed record FacetConflictVersion(ulong Size, string Revision);

/// <summary>Nonsecret presentation identity for a complete retained action envelope.</summary>
public sealed record FacetPendingAction(
    string Id,
    string ProfileId,
    string ProfileName,
    string Kind
);

/// <summary>Conflict identity and immutable version metadata; values never enter diagnostics.</summary>
public sealed record FacetConflict(
    string Id,
    string Path,
    FacetConflictVersion? Base,
    FacetConflictVersion? Local,
    FacetConflictVersion? Remote,
    string? CurrentRevision
);
