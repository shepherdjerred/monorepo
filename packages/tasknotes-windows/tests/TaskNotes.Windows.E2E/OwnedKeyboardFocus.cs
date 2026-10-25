using System.Runtime.InteropServices;

namespace TaskNotes.Windows.E2E;

/// <summary>Owns one short-lived test-process window for a real global chord without touching another application.</summary>
internal static partial class OwnedKeyboardFocus
{
    internal static void SendGlobalChord(string runId, string chord)
    {
        nint window = CreateWindowExW(
            0,
            "STATIC",
            "Facet keyboard acceptance " + runId,
            0x10CF0000,
            100,
            100,
            380,
            140,
            0,
            0,
            0,
            0
        );
        if (window == 0)
            throw new InvalidOperationException(
                "The test-owned keyboard focus window could not be created."
            );
        try
        {
            _ = GetWindowThreadProcessId(window, out uint pid);
            if (
                pid != Environment.ProcessId
                || !SetForegroundWindow(window)
                || GetForegroundWindow() != window
            )
                throw new InvalidOperationException(
                    "The exact test-owned focus window could not become foreground; no keyboard input was sent."
                );
            SendKeys.SendWait(chord);
        }
        finally
        {
            if (!DestroyWindow(window))
                throw new InvalidOperationException(
                    "The exact test-owned focus window could not be closed."
                );
        }
    }

    internal static void WithReservedChord(uint modifiers, uint key, Action assertion)
    {
        nint window = CreateWindowExW(
            0,
            "STATIC",
            "Facet test-owned hotkey collision",
            0,
            0,
            0,
            0,
            0,
            -3,
            0,
            0,
            0
        );
        if (window == 0)
            throw new InvalidOperationException("The exact collision window could not be created.");
        try
        {
            if (!RegisterHotKey(window, 0x4545, modifiers, key))
                throw new InvalidOperationException(
                    "The test-owned collision chord could not be reserved."
                );
            try
            {
                assertion();
            }
            finally
            {
                if (!UnregisterHotKey(window, 0x4545))
                    throw new InvalidOperationException(
                        "The test-owned collision chord could not be released."
                    );
            }
        }
        finally
        {
            if (!DestroyWindow(window))
                throw new InvalidOperationException(
                    "The test-owned collision window could not be destroyed."
                );
        }
    }

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateWindowExW(
        uint extendedStyle,
        string className,
        string name,
        uint style,
        int x,
        int y,
        int width,
        int height,
        nint parent,
        nint menu,
        nint instance,
        nint parameter
    );

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool DestroyWindow(nint window);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetForegroundWindow(nint window);

    [LibraryImport("user32.dll")]
    private static partial nint GetForegroundWindow();

    [LibraryImport("user32.dll")]
    private static partial uint GetWindowThreadProcessId(nint window, out uint process);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool RegisterHotKey(nint window, int id, uint modifiers, uint key);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool UnregisterHotKey(nint window, int id);
}
