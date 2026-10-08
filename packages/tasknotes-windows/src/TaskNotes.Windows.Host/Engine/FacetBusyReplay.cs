using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Replay the exact captured operation only for pre-admission Busy or an owned staged transfer.</summary>
internal static class FacetBusyReplay
{
    internal static async Task<T> RunAsync<T>(
        Func<Task<T>> operation,
        Func<bool> isCurrent,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task>? wait = null
    )
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!isCurrent())
                throw new OperationCanceledException(cancellationToken);
            try
            {
                return await operation().ConfigureAwait(false);
            }
            catch (Exception failure)
                when (failure
                        is Core.ObsidianBoundaryException.Busy
                            or Core.FacetEngineException.Busy
                )
            {
                if (wait is not null)
                    await wait(cancellationToken).ConfigureAwait(false);
                else
                    await Task.Delay(TimeSpan.FromMilliseconds(25), cancellationToken)
                        .ConfigureAwait(false);
            }
        }
    }
}
