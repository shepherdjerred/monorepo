using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Media;
using TaskNotes.Windows.Presentation;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace TaskNotes.Windows.App;

/// <summary>Open configured colors remain decoration; high contrast always uses Windows' readable foreground.</summary>
public sealed class ConfiguredColorConverter : IValueConverter
{
    /// <inheritdoc />
    public object Convert(object value, Type targetType, object parameter, string language)
    {
        _ = targetType;
        _ = parameter;
        _ = language;
        var color = ConfiguredColor.Parse(value as string);
        return new SolidColorBrush(
            new AccessibilitySettings().HighContrast || color is null
                ? new UISettings().GetColorValue(UIColorType.Foreground)
                : Color.FromArgb(color.Alpha, color.Red, color.Green, color.Blue)
        );
    }

    /// <inheritdoc />
    public object ConvertBack(object value, Type targetType, object parameter, string language) =>
        throw new NotSupportedException("Configured color decoration is one-way.");
}
