using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    /// <summary>Provides the executable launch-time UniFFI compatibility gate.</summary>
    public static class TaskNotesCompatibility
    {
        /// <summary>Gets the version reported by the loaded Rust core.</summary>
        public static string CoreVersion()
        {
            return Core.TaskNotesCoreMethods.CoreVersion();
        }

        /// <summary>Constructs every host callback and an unconfigured synchronization engine.</summary>
        public static async Task ValidateAsync(
            string storageDirectory,
            CancellationToken cancellationToken = default
        )
        {
            await using TaskNotesStore store = new(storageDirectory);
            await store.InitializeAsync(null, null, cancellationToken).ConfigureAwait(false);
            if (store.State.SyncState != TaskNotesSyncState.Unconfigured)
            {
                throw new InvalidOperationException(
                    "The unconfigured FFI engine returned an unexpected state."
                );
            }
        }
    }
}
