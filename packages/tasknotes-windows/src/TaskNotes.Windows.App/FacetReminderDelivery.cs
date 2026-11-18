using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using TaskNotes.Windows.Host;
using Windows.Storage;
using Windows.UI.Notifications;

namespace TaskNotes.Windows.App;

/// <summary>Schedules Windows toast notifications from synced <see cref="FacetScheduledReminder"/> entries when packaged.</summary>
internal sealed class FacetReminderDelivery : IAsyncDisposable
{
    private const string Group = "Facet.Reminders";
    private const string EnabledKey = "Facet.Reminders.Enabled";
    private const string StatusKey = "Facet.Reminders.Status";

    private readonly FacetSyncStore _store;
    private readonly CoalescingTaskPump _updates;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _scheduleGate = new();
    private int _generation;
    private int _disposed;
    private int _accountPaused;
    private Task? _disposeTask;

    internal FacetReminderDelivery(FacetSyncStore store)
    {
        _store = store;
        _updates = new CoalescingTaskPump(ReconcileAsync);
        if (PackageIdentity.IsPackaged)
            store.StateChanged += Changed;
    }

    internal static string Status
    {
        get
        {
            if (!PackageIdentity.IsPackaged)
                return "Windows reminders require the packaged MSIX application.";
            return ApplicationData.Current.LocalSettings.Values.TryGetValue(
                StatusKey,
                out var value
            )
                ? value as string
                    ?? throw new InvalidDataException("The reminder delivery status is corrupt.")
                : "Enable Windows reminders to schedule task notifications on this device.";
        }
    }

    internal static bool Enabled
    {
        get
        {
            if (!PackageIdentity.IsPackaged)
                return false;
            return ApplicationData.Current.LocalSettings.Values.TryGetValue(
                EnabledKey,
                out var value
            )
                ? value is bool enabled
                    ? enabled
                    : throw new InvalidDataException("The reminder delivery setting is corrupt.")
                : false;
        }
    }

    internal void Enable()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        var notifier = ToastNotificationManager.CreateToastNotifier();
        if (notifier.Setting != NotificationSetting.Enabled)
        {
            ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
            Report(
                "Windows notifications are unavailable ("
                    + notifier.Setting
                    + "). Review Windows Settings → System → Notifications, then enable reminders again."
            );
            return;
        }
        ApplicationData.Current.LocalSettings.Values[EnabledKey] = true;
        Request();
    }

    internal void Disable()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
        {
            ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
            CancelAllScheduled();
            Report("Windows reminder delivery is disabled on this device.");
        }
    }

    internal void FenceAccountChange()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        Volatile.Write(ref _accountPaused, 1);
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
            CancelAllScheduled();
    }

    internal void AccountChangeObserved()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        Volatile.Write(ref _accountPaused, 0);
        Request();
    }

    internal void Request()
    {
        if (!PackageIdentity.IsPackaged)
            return;
        lock (_scheduleGate)
            if (Volatile.Read(ref _disposed) == 0)
                _updates.Request();
    }

    private void Changed(object? sender, EventArgs args)
    {
        _ = sender;
        _ = args;
        Request();
    }

    private Task ReconcileAsync()
    {
        if (!PackageIdentity.IsPackaged || !Enabled || _lifetime.IsCancellationRequested)
            return Task.CompletedTask;
        if (Volatile.Read(ref _accountPaused) != 0)
            return Task.CompletedTask;

        int generation = Volatile.Read(ref _generation);
        try
        {
            var notifier = ToastNotificationManager.CreateToastNotifier();
            if (notifier.Setting != NotificationSetting.Enabled)
            {
                Report(
                    "Windows notification permission is unavailable (" + notifier.Setting + ")."
                );
                return Task.CompletedTask;
            }

            DateTimeOffset now = DateTimeOffset.UtcNow;
            DateTimeOffset horizon = now.AddDays(30);
            FacetScheduledReminder[] upcoming = _store
                .State.ScheduledReminders.Where(r => r.FireAt > now && r.FireAt <= horizon)
                .ToArray();

            lock (_scheduleGate)
                Reconcile(notifier, upcoming, generation, _lifetime.Token);

            if (IsCurrent(generation))
            {
                Report($"Windows reminders: {upcoming.Length} scheduled for the next 30 days.");
            }
        }
        catch (OperationCanceledException)
            when (_lifetime.IsCancellationRequested || !IsCurrent(generation))
        {
            // Shutdown cancelled an in-flight schedule update cleanly.
        }
        catch (COMException exception)
        {
            _ = exception;
            Report(
                "Windows could not finish updating reminder delivery. Review notification permissions and enable reminders again to retry."
            );
        }

        return Task.CompletedTask;
    }

    private void Reconcile(
        ToastNotifier notifier,
        FacetScheduledReminder[] reminders,
        int generation,
        CancellationToken cancellationToken
    )
    {
        Dictionary<string, (FacetScheduledReminder Reminder, string Xml)> desired = new(
            StringComparer.Ordinal
        );
        foreach (FacetScheduledReminder reminder in reminders)
        {
            string key = Tag(reminder.NotificationId);
            desired[key] = (reminder, Payload(reminder));
        }

        ScheduledToastNotification[] existing = notifier
            .GetScheduledToastNotifications()
            .Where(n => n.Group == Group)
            .ToArray();
        HashSet<string> retained = new(StringComparer.Ordinal);
        foreach (ScheduledToastNotification notification in existing)
        {
            CheckCurrent(generation, cancellationToken);
            if (
                desired.TryGetValue(notification.Tag, out var wanted)
                && notification.DeliveryTime == wanted.Reminder.FireAt
                && notification.Content.GetXml() == wanted.Xml
            )
            {
                retained.Add(notification.Tag);
            }
            else
            {
                notifier.RemoveFromSchedule(notification);
            }
        }

        foreach (var (key, wanted) in desired)
        {
            CheckCurrent(generation, cancellationToken);
            if (retained.Contains(key) || wanted.Reminder.FireAt <= DateTimeOffset.UtcNow)
                continue;
            global::Windows.Data.Xml.Dom.XmlDocument xml = new();
            xml.LoadXml(wanted.Xml);
            notifier.AddToSchedule(
                new ScheduledToastNotification(xml, wanted.Reminder.FireAt)
                {
                    Group = Group,
                    Tag = key,
                }
            );
        }
    }

    private bool IsCurrent(int generation) =>
        !_lifetime.IsCancellationRequested
        && generation == Volatile.Read(ref _generation)
        && Enabled;

    private void CheckCurrent(int generation, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsCurrent(generation))
            throw new OperationCanceledException("Reminder ownership changed.", cancellationToken);
    }

    private static string Payload(FacetScheduledReminder reminder)
    {
        string route =
            "tasknotes://tasks/"
            + Uri.EscapeDataString(reminder.TaskId)
            + "?notification="
            + Uri.EscapeDataString(reminder.NotificationId);
        XElement binding = new(
            "binding",
            new XAttribute("template", "ToastGeneric"),
            new XElement("text", reminder.Title)
        );
        if (reminder.Description is string description)
            binding.Add(new XElement("text", description));
        return new XElement(
            "toast",
            new XAttribute("activationType", "protocol"),
            new XAttribute("launch", route),
            new XElement("visual", binding)
        ).ToString(SaveOptions.DisableFormatting);
    }

    private static string Tag(string identity) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..16];

    private static void CancelAllScheduled()
    {
        var notifier = ToastNotificationManager.CreateToastNotifier();
        foreach (
            var notification in notifier
                .GetScheduledToastNotifications()
                .Where(n => n.Group == Group)
        )
            notifier.RemoveFromSchedule(notification);
    }

    private static void Report(string status)
    {
        if (!PackageIdentity.IsPackaged)
            return;
        ApplicationData.Current.LocalSettings.Values[StatusKey] = status;
    }

    public ValueTask DisposeAsync()
    {
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
        {
            if (_disposeTask is not null)
                return new ValueTask(_disposeTask);
            Volatile.Write(ref _disposed, 1);
            if (PackageIdentity.IsPackaged)
                _store.StateChanged -= Changed;
            _disposeTask = DisposeCoreAsync();
            return new ValueTask(_disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        await _lifetime.CancelAsync().ConfigureAwait(false);
        try
        {
            await _updates.DisposeAsync().ConfigureAwait(false);
        }
        finally
        {
            _lifetime.Dispose();
        }
    }
}
