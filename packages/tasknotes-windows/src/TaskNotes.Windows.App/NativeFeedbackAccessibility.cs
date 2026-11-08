using Windows.UI.ViewManagement;

namespace TaskNotes.Windows.App;

/// <summary>Use the system's accessibility notification duration, with a six-second minimum.</summary>
internal static class NativeFeedbackAccessibility
{
    internal static TimeSpan ConfirmationDuration() =>
        TimeSpan.FromSeconds(Math.Max(6, new UISettings().MessageDuration));
}
