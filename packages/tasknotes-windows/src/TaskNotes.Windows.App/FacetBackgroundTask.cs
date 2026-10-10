using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.Threading;
using TaskNotes.Windows.Host;
using Windows.ApplicationModel.Background;
using Windows.Storage;

namespace TaskNotes.Windows.App;

/// <summary>Budgeted, packaged activation with no UI and no native domain policy.</summary>
[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
[Guid("d5e32ce5-4205-4a47-8972-8aef763ce691")]
public sealed class FacetBackgroundTask : IBackgroundTask
{
    private static readonly Action<ILogger, string, string, Exception?> UnexpectedFailure =
        LoggerMessage.Define<string, string>(
            LogLevel.Error,
            new EventId(601, "FacetBackgroundFailure"),
            "Background operation {Operation} finished with {Outcome}."
        );

    /// <summary>Retains the OS deferral through session shutdown, SQLite close and writer release.</summary>
    public void Run(IBackgroundTaskInstance taskInstance)
    {
        ArgumentNullException.ThrowIfNull(taskInstance);
        using CancellationTokenSource cancellation = new(TimeSpan.FromSeconds(45));
        BackgroundTaskDeferral deferral = taskInstance.GetDeferral();
        Program.BeginBackgroundActivation();
        void Cancel(IBackgroundTaskInstance instance, BackgroundTaskCancellationReason reason)
        {
            _ = instance;
            _ = reason;
            cancellation.Cancel();
        }
        taskInstance.Canceled += Cancel;
        try
        {
            // The COM activation thread has no UI synchronization context. Blocking
            // this one entrypoint keeps its deferral owned through durable cleanup.
            using JoinableTaskContext context = new();
            context.Factory.Run(() => RunAsync(cancellation.Token));
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            FacetBackgroundRegistration.Report(
                "Background synchronization paused; saved actions remain on this device."
            );
        }
        catch (Exception error) when (TaskNotesExceptionPolicy.BackgroundMessage(error) is not null)
        {
            FacetBackgroundRegistration.Report(TaskNotesExceptionPolicy.BackgroundMessage(error)!);
        }
        catch (Exception error)
        {
            try
            {
                FacetBackgroundRegistration.Report(
                    "Background activation failed: "
                        + error.GetType().Name
                        + ". Open Facet to review diagnostics."
                );
                using var diagnostics = new JsonLineLoggerProvider(
                    Path.Combine(ApplicationData.Current.LocalFolder.Path, "Logs")
                );
                UnexpectedFailure(
                    diagnostics.CreateLogger("Facet.Background"),
                    "background-activation",
                    "unexpected-failure",
                    error
                );
            }
            finally
            {
                // Diagnostics never replace the original fault, even when the disk
                // or LocalSettings sink also fails. The OS sees an unsuccessful
                // activation after the outer finally completes its deferral.
                ExceptionDispatchInfo.Capture(error).Throw();
            }
        }
        finally
        {
            try
            {
                taskInstance.Canceled -= Cancel;
            }
            finally
            {
                try
                {
                    deferral.Complete();
                }
                finally
                {
                    Program.CompleteBackgroundActivation();
                }
            }
        }
    }

    private static async Task RunAsync(CancellationToken cancellationToken)
    {
        string directory = Path.Combine(ApplicationData.Current.LocalFolder.Path, "Facet");
        await using var lease = await FacetWriterLease
            .AcquireAsync(directory, cancellationToken)
            .ConfigureAwait(false);
        var settings = new AppSettingsService();
        if (!FacetBackgroundRegistration.IsEnabled)
            return;
        var profiles = new FacetProfileCatalog(directory).Profiles;
        bool authorized = FacetBackgroundRegistration.HasAuthorizedSync(settings, profiles);
        bool synchronize = FacetBackgroundRegistration.SyncRequested && authorized;
        bool reminders =
            FacetReminderDelivery.Enabled
            && (authorized || profiles.Any(profile => !profile.PrivateReplica));
        if (!synchronize && !reminders)
            return;
        await using var store = new FacetTaskNotesStore(directory, settings, synchronize);
        await using var delivery = new FacetReminderDelivery(store);
        await store.InitializeAsync(null, null, cancellationToken).ConfigureAwait(false);
        // OS triggers are best effort. The bounded execution window lets the Rust
        // session finish downloads/uploads; cancellation preserves its checkpoints.
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
    }
}
