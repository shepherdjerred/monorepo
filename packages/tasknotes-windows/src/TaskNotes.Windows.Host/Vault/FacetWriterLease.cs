using System.Security.Cryptography;
using System.Text;

namespace TaskNotes.Windows.Host;

/// <summary>Serializes foreground and packaged background owners until their durable writers have drained.</summary>
public sealed class FacetWriterLease : IAsyncDisposable
{
    private readonly ManualResetEventSlim _release = new();
    private readonly TaskCompletionSource<bool> _ready = new(
        TaskCreationOptions.RunContinuationsAsynchronously
    );
    private readonly Task _worker;
    private int _disposed;

    private FacetWriterLease(string name, CancellationToken cancellationToken)
    {
        // A named mutex must be released on its acquiring thread. Keep that thread
        // alive through asynchronous store/session disposal, including cancellation.
        _worker = Task.Factory.StartNew(
            () => Hold(name, cancellationToken),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default
        );
    }

    /// <summary>Waits for the previous app owner before any index, journal or credentials are opened.</summary>
    public static async Task<FacetWriterLease> AcquireAsync(
        string directory,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        string path = Path.GetFullPath(directory);
        if (OperatingSystem.IsWindows())
            path = path.ToUpperInvariant();
        string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path)));
        var lease = new FacetWriterLease(
            (OperatingSystem.IsWindows() ? "Local\\" : "") + "Facet.Writer." + hash,
            cancellationToken
        );
        try
        {
            await lease._ready.Task.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            return lease;
        }
        catch
        {
            await lease.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private void Hold(string name, CancellationToken cancellationToken)
    {
        Mutex? mutex = null;
        bool acquired = false;
        try
        {
            mutex = new Mutex(false, name);
            try
            {
                while (!mutex.WaitOne(TimeSpan.FromMilliseconds(50)))
                    cancellationToken.ThrowIfCancellationRequested();
                acquired = true;
            }
            catch (AbandonedMutexException)
            {
                // A killed owner released its OS resources. Rust's normal durable
                // recovery still runs before this new owner starts synchronization.
                acquired = true;
            }
            cancellationToken.ThrowIfCancellationRequested();
            _ready.SetResult(true);
            _release.Wait(CancellationToken.None);
        }
        catch (Exception error)
        {
            _ready.TrySetException(error);
            throw;
        }
        finally
        {
            if (acquired)
                mutex!.ReleaseMutex();
            mutex?.Dispose();
        }
    }

    /// <summary>Releases ownership only after the caller has drained sessions and closed its engine.</summary>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;
        _release.Set();
        try
        {
            await _worker.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _release.Dispose();
        }
    }
}
