using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using TaskNotes.Windows.Host;
using Windows.Storage;
using Windows.UI.Notifications;

namespace TaskNotes.Windows.App;

/// <summary>Owns app notification permission and schedule effects, using only core-authored firing times.</summary>
internal sealed class FacetReminderDelivery : IAsyncDisposable
{
    private const string Group = "Facet.Reminders";
    private const string EnabledKey = "Facet.Reminders.Enabled";
    private const string StatusKey = "Facet.Reminders.Status";
    private readonly FacetTaskNotesStore _store;
    private readonly CoalescingTaskPump _updates;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _scheduleGate = new();
    private int _generation;
    private int _disposed;
    private int _accountPaused;
    private Task? _disposeTask;

    internal FacetReminderDelivery(FacetTaskNotesStore store)
    {
        _store = store;
        _updates = new CoalescingTaskPump(ReconcileAsync);
        store.StateChanged += Changed;
    }

    internal static string Status =>
        ApplicationData.Current.LocalSettings.Values.TryGetValue(StatusKey, out var value)
            ? value as string
                ?? throw new InvalidDataException("The reminder delivery status is corrupt.")
            : "Enable Windows reminders to schedule task notifications on this device.";

    internal static bool Enabled =>
        ApplicationData.Current.LocalSettings.Values.TryGetValue(EnabledKey, out var value)
            ? value is bool enabled
                ? enabled
                : throw new InvalidDataException("The reminder delivery setting is corrupt.")
            : false;

    internal void Enable()
    {
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
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
        {
            ApplicationData.Current.LocalSettings.Values[EnabledKey] = false;
            CancelProfiles(null);
            Report("Windows reminder delivery is disabled on this device.");
        }
    }

    internal void FenceAccountChange()
    {
        Volatile.Write(ref _accountPaused, 1);
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
        {
            CancelProfiles(
                _store
                    .Profiles.Where(p => p.PrivateReplica)
                    .Select(p => p.Id)
                    .ToHashSet(StringComparer.Ordinal)
            );
        }
    }

    internal void AccountChangeObserved()
    {
        Volatile.Write(ref _accountPaused, 0);
        Request();
    }

    internal void Request()
    {
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

    private async Task ReconcileAsync()
    {
        if (!Enabled || _lifetime.IsCancellationRequested)
            return;
        int generation = Volatile.Read(ref _generation);
        var notifier = ToastNotificationManager.CreateToastNotifier();
        if (notifier.Setting != NotificationSetting.Enabled)
        {
            Report("Windows notification permission is unavailable (" + notifier.Setting + ").");
            return;
        }
        DateTimeOffset at = DateTimeOffset.UtcNow;
        string timezone =
            TimeZoneInfo.Local.HasIanaId ? TimeZoneInfo.Local.Id
            : TimeZoneInfo.TryConvertWindowsIdToIanaId(TimeZoneInfo.Local.Id, out string? iana)
                ? iana
            : throw new InvalidDataException("Windows did not provide a supported IANA time zone.");
        ulong problems = 0;
        int scheduled = 0;
        List<string> unavailable = [];
        foreach (var profile in _store.Profiles)
        {
            if (profile.PrivateReplica && Volatile.Read(ref _accountPaused) != 0)
                continue;
            try
            {
                await _store
                    .ReconcileReminderPlanAsync(
                        profile.Id,
                        at,
                        timezone,
                        at.AddDays(30),
                        (plan, cancellationToken) =>
                        {
                            // No OS effects occur until every page has passed the same
                            // owner/version fence. The store retains its writer operation
                            // while these synchronous effects run.
                            lock (_scheduleGate)
                                Reconcile(notifier, plan, generation, cancellationToken);
                            problems += plan.ProblemCount;
                            scheduled += plan.Reminders.Count;
                            return Task.CompletedTask;
                        },
                        _lifetime.Token
                    )
                    .ConfigureAwait(false);
            }
            catch (FacetAuthorizationRequiredException)
            {
                if (IsCurrent(generation))
                    lock (_scheduleGate)
                    {
                        if (IsCurrent(generation))
                            CancelProfiles(
                                new HashSet<string>(StringComparer.Ordinal) { profile.Id }
                            );
                    }
                unavailable.Add(profile.Name + ": authorize this vault again");
            }
            catch (FacetReminderUnavailableException)
            {
                unavailable.Add(
                    profile.Name
                        + ": its last reminder schedule is retained; restore vault access or TaskNotes configuration"
                );
            }
            catch (OperationCanceledException)
                when (_lifetime.IsCancellationRequested || !IsCurrent(generation))
            {
                return;
            }
            catch (COMException)
            {
                Report(
                    "Windows could not finish updating reminder delivery. Task reminders remain stored; review notification permissions and enable reminders again to retry."
                );
                return;
            }
        }
        if (IsCurrent(generation))
            Report(
                $"Windows reminders: {scheduled} projected for the next 30 days; {problems} invalid reminders require review."
                    + (unavailable.Count == 0 ? "" : " " + string.Join("; ", unavailable))
            );
    }

    private void Reconcile(
        ToastNotifier notifier,
        FacetReminderPlan plan,
        int generation,
        CancellationToken cancellationToken
    )
    {
        Dictionary<string, (FacetReminder Reminder, string Xml)> desired = new(
            StringComparer.Ordinal
        );
        foreach (var reminder in plan.Reminders)
        {
            string key = Tag(reminder.NotificationId);
            if (!desired.TryAdd(key, (reminder, Payload(plan.ProfileId, reminder))))
                throw new InvalidDataException(
                    "Two reminder identities collide in the Windows notification key."
                );
        }
        var owned = notifier
            .GetScheduledToastNotifications()
            .Where(n => n.Group == Group)
            .ToArray();
        if (owned.Any(n => OwningProfile(n) != plan.ProfileId && desired.ContainsKey(n.Tag)))
            throw new InvalidDataException(
                "A reminder identity collides with another vault's Windows notification key."
            );
        var existing = owned.Where(n => OwningProfile(n) == plan.ProfileId).ToArray();
        HashSet<string> retained = new(StringComparer.Ordinal);
        foreach (var notification in existing)
        {
            CheckCurrent(generation, cancellationToken);
            if (
                desired.TryGetValue(notification.Tag, out var wanted)
                && notification.DeliveryTime == wanted.Reminder.FireAt
                && notification.Content.GetXml() == wanted.Xml
            )
                retained.Add(notification.Tag);
            else
                notifier.RemoveFromSchedule(notification);
        }
        foreach (var (key, wanted) in desired)
        {
            CheckCurrent(generation, cancellationToken);
            if (retained.Contains(key))
                continue;
            // A slow OS call may cross an exact fire time. Never invent a replacement
            // firing or backdate a notification; the next core plan determines eligibility.
            if (wanted.Reminder.FireAt <= DateTimeOffset.UtcNow)
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

    private static string Payload(string profile, FacetReminder reminder)
    {
        string route =
            "tasknotes://tasks/"
            + Uri.EscapeDataString(reminder.TaskPath)
            + "?profile="
            + Uri.EscapeDataString(profile)
            + "&notification="
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

    private static string OwningProfile(ScheduledToastNotification notification)
    {
        var root = XElement.Parse(notification.Content.GetXml());
        string launch =
            root.Attribute("launch")?.Value
            ?? throw new InvalidDataException("A Facet reminder has no owning route.");
        Uri route = new(launch);
        if (route.Scheme != "tasknotes" || route.Host != "tasks")
            throw new InvalidDataException("A Facet reminder has an invalid owning route.");
        foreach (string part in route.Query.TrimStart('?').Split('&'))
        {
            string[] pair = part.Split('=', 2);
            if (pair.Length == 2 && pair[0] == "profile")
                return Uri.UnescapeDataString(pair[1]);
        }
        throw new InvalidDataException("A Facet reminder has no owning vault.");
    }

    private static void CancelProfiles(HashSet<string>? profiles)
    {
        var notifier = ToastNotificationManager.CreateToastNotifier();
        foreach (
            var notification in notifier
                .GetScheduledToastNotifications()
                .Where(n => n.Group == Group)
        )
            if (profiles is null || profiles.Contains(OwningProfile(notification)))
                notifier.RemoveFromSchedule(notification);
    }

    private static void Report(string status) =>
        ApplicationData.Current.LocalSettings.Values[StatusKey] = status;

    public ValueTask DisposeAsync()
    {
        Interlocked.Increment(ref _generation);
        lock (_scheduleGate)
        {
            if (_disposeTask is not null)
                return new ValueTask(_disposeTask);
            Volatile.Write(ref _disposed, 1);
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
