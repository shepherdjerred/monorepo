using CommunityToolkit.Mvvm.ComponentModel;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable state and validation for the platform-global Quick Add binding.</summary>
    public sealed class GlobalHotkeyViewModel : ObservableObject, IDisposable
    {
        private IGlobalHotkeyRegistrar? _registrar;
        private string _binding = string.Empty;
        private string _status = "Global Quick Add is disabled.";
        private bool _disposed;

        /// <summary>Gets the currently requested binding.</summary>
        public string Binding
        {
            get => _binding;
            private set => SetProperty(ref _binding, value);
        }

        /// <summary>Gets the user-facing registration state.</summary>
        public string Status
        {
            get => _status;
            private set => SetProperty(ref _status, value);
        }

        /// <summary>Attaches the window-owned platform registrar.</summary>
        public void Attach(IGlobalHotkeyRegistrar registrar)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            ArgumentNullException.ThrowIfNull(registrar);
            _registrar?.Dispose();
            _registrar = registrar;
        }

        /// <summary>Validates and applies a new binding, publishing collisions as state.</summary>
        public void Register(string binding)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            IGlobalHotkeyRegistrar registrar =
                _registrar
                ?? throw new InvalidOperationException("Attach the global hotkey registrar first.");
            Binding = binding.Trim();
            try
            {
                bool registered = registrar.Register(Binding);
                Status = registered
                    ? $"Registered {Binding}"
                    : $"{Binding} is already used by another application.";
            }
            catch (ArgumentException exception)
            {
                Status = exception.Message;
            }
        }

        /// <summary>Disables the binding.</summary>
        public void Clear()
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _registrar?.Clear();
            Binding = string.Empty;
            Status = "Global Quick Add is disabled.";
        }

        /// <summary>Releases the native registration.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _registrar?.Dispose();
            _registrar = null;
            _disposed = true;
        }
    }
}
