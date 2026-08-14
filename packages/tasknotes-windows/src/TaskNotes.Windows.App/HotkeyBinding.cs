namespace TaskNotes.Windows.App
{
    internal readonly record struct HotkeyBinding(uint Modifiers, uint VirtualKey)
    {
        internal static HotkeyBinding Parse(string binding)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(binding);
            uint modifiers = 0;
            uint key = 0;
            foreach (
                string component in binding.Split(
                    '+',
                    StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                )
            )
            {
                if (
                    component.Equals("Ctrl", StringComparison.OrdinalIgnoreCase)
                    || component.Equals("Control", StringComparison.OrdinalIgnoreCase)
                )
                {
                    modifiers |= 0x0002;
                }
                else if (component.Equals("Alt", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0001;
                }
                else if (component.Equals("Shift", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0004;
                }
                else if (component.Equals("Win", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0008;
                }
                else
                {
                    key =
                        component.Length == 1 && char.IsAsciiLetterOrDigit(component[0])
                            ? char.ToUpperInvariant(component[0])
                            : throw new ArgumentException(
                                $"Unsupported global hotkey component '{component}'.",
                                nameof(binding)
                            );
                }
            }
            return modifiers == 0 || key == 0
                ? throw new ArgumentException(
                    "A global hotkey needs a modifier and one letter or number.",
                    nameof(binding)
                )
                : new HotkeyBinding(modifiers, key);
        }
    }
}
