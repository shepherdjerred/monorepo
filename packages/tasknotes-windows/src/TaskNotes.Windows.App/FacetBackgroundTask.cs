using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.Threading;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.ApplicationModel.Background;

namespace TaskNotes.Windows.App;

/// <summary>Budgeted, packaged background sync and reminder reconciliation task.</summary>
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

    /// <summary>Retains the OS deferral through HTTP sync, reminder reconciliation, SQLite close and writer release.</summary>
    public void Run(IBackgroundTaskInstance taskInstance)
    {
        ArgumentNullException.ThrowIfNull(taskInstance);
        if (!PackageIdentity.IsPackaged)
            return;

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
            using JoinableTaskContext context = new();
            context.Factory.Run(() => RunAsync(cancellation.Token));
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            FacetBackgroundRegistration.Report(
                "Background synchronization paused; cached tasks remain on this device."
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
                    Path.Combine(PackageIdentity.LocalDataRoot, "Logs")
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
        string directory = Path.Combine(PackageIdentity.LocalDataRoot, "Facet");
        await using var lease = await FacetWriterLease
            .AcquireAsync(directory, cancellationToken)
            .ConfigureAwait(false);
        var settings = new AppSettingsService();
        if (!FacetBackgroundRegistration.IsEnabled)
            return;
        if (!FacetBackgroundRegistration.HasAuthorizedSync(settings))
            return;

        bool synchronize = FacetBackgroundRegistration.SyncRequested;
        bool reminders = FacetReminderDelivery.Enabled;
        if (!synchronize && !reminders)
            return;

        ServerConfiguration config = settings.Load();
        await using var store = new FacetSyncStore(directory);
        await using var delivery = new FacetReminderDelivery(store);
        if (synchronize)
        {
            await store
                .InitializeAsync(config.ServerUrl, config.Token, cancellationToken)
                .ConfigureAwait(false);
        }
        delivery.Request();
    }
}
