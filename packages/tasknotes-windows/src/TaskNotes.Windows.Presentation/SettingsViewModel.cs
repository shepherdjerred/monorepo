using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable server configuration and parked-change presentation.</summary>
    public sealed class SettingsViewModel : ObservableObject, IDisposable
    {
        private readonly ITaskNotesStore _store;
        private readonly IServerConfigurationStore _configuration;
        private readonly IUiDispatcher _dispatcher;
        private string _serverUrl = string.Empty;
        private string _token = string.Empty;
        private string? _validationError;
        private TaskNotesState _state;
        private bool _disposed;

        /// <summary>Initializes settings over platform-secure configuration storage.</summary>
        public SettingsViewModel(
            ITaskNotesStore store,
            IServerConfigurationStore configuration,
            IUiDispatcher dispatcher
        )
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _configuration =
                configuration ?? throw new ArgumentNullException(nameof(configuration));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _state = store.State;
            _store.StateChanged += StoreStateChanged;
        }

        /// <summary>Gets or sets the server URL.</summary>
        public string ServerUrl
        {
            get => _serverUrl;
            set => SetProperty(ref _serverUrl, value);
        }

        /// <summary>Gets or sets the in-memory token.</summary>
        public string Token
        {
            get => _token;
            set => SetProperty(ref _token, value);
        }

        /// <summary>Gets the validation or connection error.</summary>
        public string? ValidationError
        {
            get => _validationError;
            private set => SetProperty(ref _validationError, value);
        }

        /// <summary>Gets the current store state.</summary>
        public TaskNotesState State
        {
            get => _state;
            private set
            {
                if (SetProperty(ref _state, value))
                {
                    OnPropertyChanged(nameof(ParkedChanges));
                }
            }
        }

        /// <summary>Gets parked changes requiring user action.</summary>
        public IReadOnlyList<ParkedChange> ParkedChanges => State.ParkedChanges;

        /// <summary>Loads the URL and credential into editable memory.</summary>
        public void Load()
        {
            ServerConfiguration current = _configuration.Load();
            ServerUrl = current.ServerUrl ?? string.Empty;
            Token = current.Token ?? string.Empty;
            ValidationError = null;
        }

        /// <summary>Validates, connects, and persists configuration only after success.</summary>
        public async Task<bool> SaveAndSyncAsync(CancellationToken cancellationToken = default)
        {
            string serverUrl = ServerUrl.Trim();
            if (
                !Uri.TryCreate(serverUrl, UriKind.Absolute, out Uri? uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            )
            {
                ValidationError = "Enter an absolute HTTP or HTTPS TaskNotes server URL.";
                return false;
            }
            await _store.ReconfigureAsync(serverUrl, Token, cancellationToken);
            if (_store.State.SyncState != TaskNotesSyncState.Connected)
            {
                ValidationError =
                    _store.State.UserFacingError ?? "TaskNotes could not connect to this server.";
                return false;
            }
            _configuration.Save(serverUrl, Token);
            ValidationError = null;
            return true;
        }

        /// <summary>Retries one parked mutation.</summary>
        public Task RetryParkedAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        )
        {
            return _store.RetryParkedMutationAsync(mutationId, cancellationToken);
        }

        /// <summary>Discards one parked mutation.</summary>
        public Task DiscardParkedAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        )
        {
            return _store.DiscardParkedMutationAsync(mutationId, cancellationToken);
        }

        /// <summary>Stops observing store state.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _store.StateChanged -= StoreStateChanged;
        }

        private void StoreStateChanged(object? sender, EventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            if (_dispatcher.HasThreadAccess)
            {
                State = _store.State;
            }
            else
            {
                _dispatcher.Enqueue(() => State = _store.State);
            }
        }
    }
}
