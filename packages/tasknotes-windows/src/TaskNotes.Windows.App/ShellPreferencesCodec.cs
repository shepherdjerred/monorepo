using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App
{
    internal static class ShellPreferencesCodec
    {
        private const int CurrentSchemaVersion = 1;
        private const string SchemaVersionKey = "settings-schema-version";
        private const string NavigationKey = "navigation";
        private const string InspectorKey = "inspector-visible";
        private const string HotkeyKey = "quick-add-hotkey";
        private const string WindowWidthKey = "window-width";
        private const string WindowHeightKey = "window-height";

        internal static ShellPreferences Load(IDictionary<string, object> values)
        {
            ArgumentNullException.ThrowIfNull(values);
            int version = ValueOrDefault(values, SchemaVersionKey, CurrentSchemaVersion);
            if (version != CurrentSchemaVersion)
            {
                throw new InvalidDataException($"Unsupported TaskNotes settings schema {version}.");
            }

            ShellPreferences preferences = new(
                ValueOrDefault(values, NavigationKey, "today"),
                ValueOrDefault(values, InspectorKey, true),
                ValueOrDefault(values, HotkeyKey, "Ctrl+Alt+N"),
                ValueOrDefault(values, WindowWidthKey, 1240d),
                ValueOrDefault(values, WindowHeightKey, 820d)
            );
            Validate(preferences);
            return preferences;
        }

        internal static void Save(IDictionary<string, object> values, ShellPreferences preferences)
        {
            ArgumentNullException.ThrowIfNull(values);
            ArgumentNullException.ThrowIfNull(preferences);
            Validate(preferences);
            values[SchemaVersionKey] = CurrentSchemaVersion;
            values[NavigationKey] = preferences.NavigationRoute;
            values[InspectorKey] = preferences.InspectorVisible;
            values[HotkeyKey] = preferences.QuickAddHotkey;
            values[WindowWidthKey] = preferences.WindowWidth;
            values[WindowHeightKey] = preferences.WindowHeight;
        }

        private static T ValueOrDefault<T>(
            IDictionary<string, object> values,
            string key,
            T fallback
        )
        {
            if (!values.TryGetValue(key, out object? stored))
            {
                return fallback;
            }
            return stored is T value
                ? value
                : throw new InvalidDataException(
                    $"TaskNotes setting '{key}' has the wrong value type."
                );
        }

        private static void Validate(ShellPreferences preferences)
        {
            _ = NavigationRoute.Parse(preferences.NavigationRoute);
            if (preferences.WindowWidth is < 800 or > 3840)
            {
                throw new InvalidDataException(
                    "TaskNotes window width must be between 800 and 3840 pixels."
                );
            }
            if (preferences.WindowHeight is < 600 or > 2160)
            {
                throw new InvalidDataException(
                    "TaskNotes window height must be between 600 and 2160 pixels."
                );
            }
        }
    }
}
