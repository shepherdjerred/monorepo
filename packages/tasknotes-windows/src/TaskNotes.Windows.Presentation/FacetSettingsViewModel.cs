using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>Standalone account discovery, profile selection, and retained conflicts.</summary>
public sealed class FacetSettingsViewModel : ObservableObject, IDisposable
{
    private readonly IFacetProfileStore _profiles;
    private readonly ITaskNotesStore _store;
    private readonly IUiDispatcher _dispatcher;
    private IReadOnlyList<ObsidianVaultChoice> _vaults = [];
    private IReadOnlyList<FacetConflict> _conflicts = [];
    private string? _status;

    /// <summary>Observe the standalone host through portable contracts.</summary>
    public FacetSettingsViewModel(
        ITaskNotesStore store,
        IFacetProfileStore profiles,
        IUiDispatcher dispatcher
    )
    {
        _store = store;
        _profiles = profiles;
        _dispatcher = dispatcher;
        _store.StateChanged += Changed;
    }

    /// <summary>Local profiles without credentials.</summary>
    public IReadOnlyList<FacetProfileRegistration> Profiles => _profiles.Profiles;

    /// <summary>Saved immutable actions, including their original owning vault.</summary>
    public IReadOnlyList<FacetPendingAction> PendingActions => _store.State.FacetPendingActions;

    /// <summary>Resume the retained action; no ID, timestamp or command is reconstructed.</summary>
    public async Task ResumeAsync(string id, CancellationToken cancellationToken = default)
    {
        await _profiles.ResumeMutationAsync(id, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Request retirement only after native absence or durable parking is observed.</summary>
    public async Task RetireRejectedAsync(string id, CancellationToken cancellationToken = default)
    {
        await _profiles.RetireRejectedMutationAsync(id, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Existing owned/shared remote vaults.</summary>
    public IReadOnlyList<ObsidianVaultChoice> Vaults
    {
        get => _vaults;
        private set => SetProperty(ref _vaults, value);
    }

    /// <summary>Durably retained competing versions.</summary>
    public IReadOnlyList<FacetConflict> Conflicts
    {
        get => _conflicts;
        private set => SetProperty(ref _conflicts, value);
    }

    /// <summary>Actionable account or capability state.</summary>
    public string? Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    /// <summary>Sign in with transient input, then discover existing vaults.</summary>
    public async Task SignInAsync(
        string email,
        string password,
        string mfa,
        CancellationToken cancellationToken = default
    )
    {
        var result = await _profiles.SignInAsync(email, password, mfa, cancellationToken);
        if (result != ObsidianSignInOutcome.SignedIn)
        {
            Status =
                result == ObsidianSignInOutcome.MfaRequired
                    ? "Enter your Obsidian one-time code, then sign in again."
                    : "The one-time code was rejected. Enter a new code.";
            return;
        }
        Vaults = await _profiles.ListVaultsAsync(cancellationToken);
        Status = "Choose an existing Obsidian Sync vault.";
    }

    /// <summary>Authorize and open an existing remote vault.</summary>
    public async Task AddRemoteAsync(
        ObsidianVaultChoice vault,
        string? password,
        bool approveStandard,
        CancellationToken cancellationToken = default
    )
    {
        await _profiles.AddRemoteProfileAsync(vault, password, approveStandard, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Open a read-only external folder capability.</summary>
    public async Task AddLocalAsync(
        string name,
        string path,
        bool approveStandard,
        CancellationToken cancellationToken = default
    )
    {
        await _profiles.AddLocalProfileAsync(name, path, approveStandard, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Change the visible vault without stopping other sessions.</summary>
    public async Task SelectAsync(string id, CancellationToken cancellationToken = default)
    {
        await _profiles.SelectProfileAsync(id, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Remove settled profile state while leaving source/private vault files and other account rights intact.</summary>
    public async Task RemoveAsync(string id, CancellationToken cancellationToken = default)
    {
        await _profiles.RemoveProfileAsync(id, cancellationToken);
        await ReloadAsync(cancellationToken);
        Status = "The vault was removed from Facet. Its files remain intact.";
    }

    /// <summary>Reauthorize the existing replica without replacing offline changes.</summary>
    public async Task ReauthorizeAsync(
        string id,
        string? password,
        CancellationToken cancellationToken = default
    )
    {
        await _profiles.ReauthorizeProfileAsync(id, password, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    /// <summary>Stop all account sessions and remove their secure credentials.</summary>
    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        await _profiles.SignOutAsync(cancellationToken);
        Vaults = [];
        Status = "Signed out. Private replicas remain available offline.";
    }

    /// <summary>Load explicit preserved overlaps.</summary>
    public async Task ReloadAsync(CancellationToken cancellationToken = default)
    {
        OnPropertyChanged(nameof(Profiles));
        OnPropertyChanged(nameof(PendingActions));
        Conflicts = _profiles.SelectedProfileId is null
            ? []
            : await _profiles.ConflictsAsync(cancellationToken);
    }

    /// <summary>Choose a retained version explicitly.</summary>
    public async Task ResolveAsync(
        string id,
        string choice,
        CancellationToken cancellationToken = default
    )
    {
        await _profiles.ResolveConflictAsync(id, choice, cancellationToken);
        await ReloadAsync(cancellationToken);
    }

    private void Changed(object? sender, EventArgs args)
    {
        void Update()
        {
            OnPropertyChanged(nameof(Profiles));
            OnPropertyChanged(nameof(PendingActions));
            Status = _store.State.UserFacingError;
            Conflicts = _store.State.FacetConflicts;
        }
        if (_dispatcher.HasThreadAccess)
            Update();
        else
            _dispatcher.Enqueue(Update);
    }

    /// <summary>Release store observation.</summary>
    public void Dispose() => _store.StateChanged -= Changed;
}
