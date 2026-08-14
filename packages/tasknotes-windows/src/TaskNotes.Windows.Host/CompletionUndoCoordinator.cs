using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    /// <summary>Owns the transient LIFO completion-undo stack and partial-failure recovery.</summary>
    internal sealed class CompletionUndoCoordinator
    {
        private const int MaximumDepth = 10;
        private readonly List<CompletionUndo> _entries = [];

        internal bool CanUndo => _entries.Count > 0;

        internal int Depth => _entries.Count;

        internal void Push(string message, IReadOnlyList<CompletionRestore> restores)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(message);
            ArgumentNullException.ThrowIfNull(restores);
            if (restores.Count == 0)
            {
                throw new ArgumentException(
                    "An undo entry requires at least one restore.",
                    nameof(restores)
                );
            }
            _entries.Add(new CompletionUndo(message, [.. restores]));
            if (_entries.Count > MaximumDepth)
            {
                _entries.RemoveAt(0);
            }
        }

        internal void Undo(Action<Core.CommandInput> dispatch)
        {
            ArgumentNullException.ThrowIfNull(dispatch);
            if (_entries.Count == 0)
            {
                return;
            }

            CompletionUndo current = _entries[^1];
            while (current.Restores.Count > 0)
            {
                int restoreIndex = current.Restores.Count - 1;
                CompletionRestore restore = current.Restores[restoreIndex];
                dispatch(Command(restore));
                current.Restores.RemoveAt(restoreIndex);
            }
            _entries.RemoveAt(_entries.Count - 1);
        }

        internal void Clear()
        {
            _entries.Clear();
        }

        private static Core.CommandInput Command(CompletionRestore restore)
        {
            return restore.OccurrenceDate is string date
                ? new Core.CommandInput.SetInstanceComplete(restore.TaskId, date, false)
                : new Core.CommandInput.SetStatus(
                    restore.TaskId,
                    restore.PreviousStatus
                        ?? throw new InvalidOperationException(
                            "Plain completion undo has no prior status."
                        )
                );
        }

        private sealed record CompletionUndo(string Message, List<CompletionRestore> Restores);
    }

    internal sealed record CompletionRestore(
        string TaskId,
        Core.TaskStatus? PreviousStatus,
        string? OccurrenceDate
    );
}
