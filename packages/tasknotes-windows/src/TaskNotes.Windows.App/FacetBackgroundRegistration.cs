using System.Runtime.InteropServices;
using TaskNotes.Windows.Presentation;
using Windows.ApplicationModel.Background;
using Windows.Storage;

namespace TaskNotes.Windows.App;

/// <summary>Owns packaged OS background task registrations; gracefully no-ops when running unpackaged.</summary>
internal static class FacetBackgroundRegistration
{
    private const string TaskName = "Facet.Sync.v1";
    private const string EnabledKey = "Facet.BackgroundSync.Enabled";
    private const string SyncRequestedKey = "Facet.BackgroundSync.Requested";
    private const string NetworkModeKey = "Facet.BackgroundSync.RequiresNetwork";

    internal static bool SyncRequested => PackageIdentity.IsPackaged && ReadFlag(SyncRequestedKey);

    private static bool ReadFlag(string key) =>
        ApplicationData.Current.LocalSettings.Values.TryGetValue(key, out var value)
            ? value is bool enabled
                ? enabled
                : throw new InvalidDataException("The Facet background preference is corrupt.")
            : false;

    internal static void SetSyncRequested(bool enabled)
    {
        if (!PackageIdentity.IsPackaged)
            return;
        ApplicationData.Current.LocalSettings.Values[SyncRequestedKey] = enabled;
        Stop();
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
        Report(
            enabled
                ? "Background sync is enabled after Facet closes; Windows background permission is required."
                : "Background sync is disabled; opted-in local reminders can still be maintained."
        );
    }

    internal static bool HasAuthorizedSync(AppSettingsService settings)
    {
        ServerConfiguration config = settings.Load();
        return !string.IsNullOrWhiteSpace(config.ServerUrl)
            && !string.IsNullOrWhiteSpace(config.Token);
    }

    internal static string Status
    {
        get
        {
            if (!PackageIdentity.IsPackaged)
                return "Background synchronization requires the packaged MSIX application.";
            return ApplicationData.Current.LocalSettings.Values.TryGetValue(
                "Facet.BackgroundSync.Status",
                out var value
            )
                ? value as string
                    ?? throw new InvalidDataException(
                        "The background synchronization status is corrupt."
                    )
                : "Background synchronization requires a configured server token and Windows background permission.";
        }
    }

    internal static bool IsEnabled
    {
        get
        {
            if (!PackageIdentity.IsPackaged)
                return false;
            if (
                !ApplicationData.Current.LocalSettings.Values.TryGetValue(EnabledKey, out var value)
            )
                return false;
            return value is bool enabled
                ? enabled
                : throw new InvalidDataException(
                    "The background synchronization setting is corrupt."
                );
        }
    }

    internal static void Stop()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        foreach (
            var task in BackgroundTaskRegistration.AllTasks.Values.Where(task =>
                task.Name == TaskName
            )
        )
            task.Unregister(true);
    }

    internal static void Report(string status)
    {
        if (!PackageIdentity.IsPackaged)
            return;
        ApplicationData.Current.LocalSettings.Values["Facet.BackgroundSync.Status"] = status;
    }

    internal static async Task EnableAsync(AppSettingsService settings)
    {
        if (!PackageIdentity.IsPackaged)
            return;
        bool authorized = HasAuthorizedSync(settings);
        bool synchronize = SyncRequested && authorized;
        bool maintainReminders = FacetReminderDelivery.Enabled && authorized;
        if (!synchronize && !maintainReminders)
        {
            Disable();
            return;
        }
        var access = await BackgroundExecutionManager.RequestAccessAsync();
        if (
            access
            is BackgroundAccessStatus.Denied
                or BackgroundAccessStatus.DeniedBySystemPolicy
                or BackgroundAccessStatus.DeniedByUser
                or BackgroundAccessStatus.Unspecified
        )
        {
            ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
            Stop();
            Report("Windows background permission is unavailable. Open Facet to synchronize.");
            return;
        }
        bool requiresNetwork = synchronize && !maintainReminders;
        bool existing = BackgroundTaskRegistration.AllTasks.Values.Any(task =>
            task.Name == TaskName
        );
        if (
            existing
            && (
                !ApplicationData.Current.LocalSettings.Values.ContainsKey(NetworkModeKey)
                || ReadFlag(NetworkModeKey) != requiresNetwork
            )
        )
        {
            Stop();
            existing = false;
        }
        if (!existing)
        {
            var builder = new Microsoft.Windows.ApplicationModel.Background.BackgroundTaskBuilder
            {
                Name = TaskName,
            };
            builder.SetTrigger(new TimeTrigger(15, false));
            if (requiresNetwork)
                builder.AddCondition(new SystemCondition(SystemConditionType.InternetAvailable));
            builder.SetTaskEntryPointClsid(typeof(FacetBackgroundTask).GUID);
            try
            {
                builder.Register();
                ApplicationData.Current.LocalSettings.Values[NetworkModeKey] = requiresNetwork;
            }
            catch (COMException exception)
            {
                _ = exception;
                ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
                Report(
                    "Windows could not register Facet background synchronization. Open Facet to synchronize and review app permissions."
                );
                return;
            }
        }
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = true;
        Report(
            maintainReminders
                ? "Windows will synchronize tasks and maintain scheduled reminders in the background."
                : "Windows will synchronize tasks when background execution and network access are available."
        );
    }

    internal static void Disable()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
        Stop();
        Report("Background synchronization is disabled.");
    }
}
