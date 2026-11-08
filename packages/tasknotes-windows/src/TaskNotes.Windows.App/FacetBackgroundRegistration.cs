using System.Runtime.InteropServices;
using TaskNotes.Windows.Host;
using Windows.ApplicationModel.Background;
using Windows.Storage;

namespace TaskNotes.Windows.App;

/// <summary>Owns only Facet OS registrations; runtime permission and account credentials remain explicit prerequisites.</summary>
internal static class FacetBackgroundRegistration
{
    private const string TaskName = "Facet.PrivateReplicaSync.v1";
    private const string EnabledKey = "Facet.BackgroundSync.Enabled";
    private const string SyncRequestedKey = "Facet.BackgroundSync.Requested";
    private const string NetworkModeKey = "Facet.BackgroundSync.RequiresNetwork";
    internal static bool SyncRequested => ReadFlag(SyncRequestedKey);

    private static bool ReadFlag(string key) =>
        ApplicationData.Current.LocalSettings.Values.TryGetValue(key, out var value)
            ? value is bool enabled
                ? enabled
                : throw new InvalidDataException("The Facet background preference is corrupt.")
            : false;

    internal static void SetSyncRequested(bool enabled)
    {
        ApplicationData.Current.LocalSettings.Values[SyncRequestedKey] = enabled;
        Stop();
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
        Report(
            enabled
                ? "Background Sync is enabled for authorized vaults after Facet closes; Windows background permission is required."
                : "Background Sync is disabled; opted-in local reminders can still be maintained."
        );
    }

    internal static bool HasAuthorizedSync(
        AppSettingsService settings,
        IReadOnlyList<FacetProfileRegistration> profiles
    )
    {
        string? owner = settings.Read("obsidian/account-owner");
        return owner is not null
            && settings.Read("obsidian/account-token") is not null
            && profiles.Any(profile =>
                profile.PrivateReplica
                && profile.Vault is not null
                && profile.AccountOwner == owner
                && settings.Read(
                    ObsidianAccountService.KeyIdentity(owner, profile.Id, profile.Vault.Id)
                )
                    is not null
            );
    }

    internal static string Status =>
        ApplicationData.Current.LocalSettings.Values.TryGetValue(
            "Facet.BackgroundSync.Status",
            out var value
        )
            ? value as string
                ?? throw new InvalidDataException(
                    "The background synchronization status is corrupt."
                )
            : "Background synchronization requires an authorized Sync vault and Windows background permission.";
    internal static bool IsEnabled
    {
        get
        {
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
        foreach (
            var task in BackgroundTaskRegistration.AllTasks.Values.Where(task =>
                task.Name == TaskName
            )
        )
            task.Unregister(true);
    }

    internal static void Report(string status) =>
        ApplicationData.Current.LocalSettings.Values["Facet.BackgroundSync.Status"] = status;

    internal static async Task EnableAsync(
        AppSettingsService settings,
        IReadOnlyList<FacetProfileRegistration> profiles
    )
    {
        bool synchronize = SyncRequested && HasAuthorizedSync(settings, profiles);
        bool maintainReminders =
            FacetReminderDelivery.Enabled
            && (
                profiles.Any(profile => !profile.PrivateReplica)
                || HasAuthorizedSync(settings, profiles)
            );
        if (!synchronize && !maintainReminders)
        {
            Disable();
            return;
        }
        // Registration never substitutes for account/vault authorization: the worker
        // reopens Credential Locker and the core checks the owning account for each vault.
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
            catch (COMException)
            {
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
                ? "Windows will maintain opted-in reminders, including local vaults while offline; enabled Sync uses only authorized vaults."
                : "Windows will synchronize authorized vaults when background execution and network access are available."
        );
    }

    internal static void Disable()
    {
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
        Stop();
        Report("Background synchronization is disabled.");
    }
}
