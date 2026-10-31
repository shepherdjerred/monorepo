using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace TaskNotes.Windows.E2E;

/// <summary>Owns exactly one activated E2E package process and its original creation lifetime.</summary>
internal sealed partial class OwnedPackageLifetime : IAsyncDisposable
{
    private readonly string _family;
    private readonly string _executable;
    private readonly string _descriptor;
    private Process? _process;
    private DateTime _created;

    internal OwnedPackageLifetime(string family, string executable, string descriptor)
    {
        _family = family;
        _executable = Path.GetFullPath(executable);
        _descriptor = Path.GetFullPath(descriptor);
    }

    internal int ProcessId => RequireProcess().Id;

    internal void RequireForeground()
    {
        _ = GetWindowThreadProcessId(GetForegroundWindow(), out uint id);
        if (id != ProcessId)
            throw new InvalidOperationException(
                "Keyboard input requires the exact owned package foreground process."
            );
    }

    internal void Activate()
    {
        if (_process is not null)
            throw new InvalidOperationException("An acceptance process is already owned.");
        foreach (
            Process candidate in Process.GetProcessesByName(
                Path.GetFileNameWithoutExtension(_executable)
            )
        )
        {
            using (candidate)
            {
                if (
                    string.Equals(
                        candidate.MainModule?.FileName,
                        _executable,
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                    throw new InvalidOperationException(
                        "The acceptance package is already running; its process will not be adopted or stopped."
                    );
            }
        }
        var manager = (IApplicationActivationManager)new ApplicationActivationManager();
        try
        {
            int result = manager.ActivateApplication(
                _family + "!App",
                "--facet-acceptance-descriptor \"" + _descriptor + "\"",
                0,
                out uint id
            );
            Marshal.ThrowExceptionForHR(result);
            _process = Process.GetProcessById(checked((int)id));
            _created = _process.StartTime.ToUniversalTime();
            _ = RequireProcess();
        }
        finally
        {
            _ = Marshal.FinalReleaseComObject(manager);
        }
    }

    private unsafe Process RequireProcess()
    {
        Process process =
            _process ?? throw new InvalidOperationException("No package process is owned.");
        if (
            process.HasExited
            || process.StartTime.ToUniversalTime() != _created
            || !string.Equals(
                process.MainModule?.FileName,
                _executable,
                StringComparison.OrdinalIgnoreCase
            )
        )
            throw new InvalidOperationException(
                "The owned package process or creation lifetime changed."
            );
        uint length = 0;
        if (GetPackageFamilyName(process.Handle, ref length, null) != 122 || length is 0 or > 512)
            throw new InvalidOperationException(
                "The owned executable has no expected package identity."
            );
        char* buffer = stackalloc char[checked((int)length)];
        if (
            GetPackageFamilyName(process.Handle, ref length, buffer) != 0
            || new string(buffer) != _family
        )
            throw new InvalidOperationException("The owned executable package identity changed.");
        return process;
    }

    internal void RequireWindow(AutomationElement window, string runId)
    {
        int pid = ProcessId;
        if (window.Current.ProcessId != pid || window.Current.Name != "Facet Acceptance " + runId)
            throw new InvalidOperationException(
                "The native window is not owned by this acceptance run."
            );
        var windows = AutomationElement.RootElement.FindAll(
            TreeScope.Children,
            new AndCondition(
                new PropertyCondition(AutomationElement.ProcessIdProperty, pid),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window)
            )
        );
        if (
            windows.Count != 1
            || windows[0].Current.NativeWindowHandle != window.Current.NativeWindowHandle
        )
            throw new InvalidOperationException(
                "Acceptance requires exactly one owned package window."
            );
        if (
            window.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(
                    AutomationElement.AutomationIdProperty,
                    "Facet.Acceptance.Workspace." + runId
                )
            )
            is null
        )
            throw new InvalidOperationException(
                "The owned window has no descriptor-bound workspace."
            );
    }

    internal void CaptureWindow(AutomationElement window, string runId, string destination)
    {
        RequireWindow(window, runId);
        if (
            window.FindFirst(
                TreeScope.Descendants,
                new AndCondition(
                    new PropertyCondition(AutomationElement.IsPasswordProperty, true),
                    new PropertyCondition(AutomationElement.IsOffscreenProperty, false)
                )
            )
            is not null
        )
            throw new InvalidOperationException(
                "Credential surfaces cannot be captured as acceptance evidence."
            );
        nint handle = window.Current.NativeWindowHandle;
        if (!GetWindowRect(handle, out NativeRect rect))
            throw new InvalidOperationException("The owned window has no capture bounds.");
        int width = checked(rect.Right - rect.Left);
        int height = checked(rect.Bottom - rect.Top);
        if (width is < 1 or > 8192 || height is < 1 or > 8192)
            throw new InvalidOperationException("The owned window capture bounds are invalid.");
        using Bitmap bitmap = new(width, height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            nint context = graphics.GetHdc();
            try
            {
                if (!PrintWindow(handle, context, 2))
                    throw new InvalidOperationException(
                        "Windows could not render owned-window evidence."
                    );
            }
            finally
            {
                graphics.ReleaseHdc(context);
            }
        }
        RequireWindow(window, runId);
        Color first = bitmap.GetPixel(0, 0);
        bool varied = false;
        for (int x = 0; x < width && !varied; x += Math.Max(1, width / 32))
        for (int y = 0; y < height && !varied; y += Math.Max(1, height / 32))
            varied = bitmap.GetPixel(x, y) != first;
        if (!varied)
            throw new InvalidOperationException(
                "Windows returned a blank owned-window capture; no visual proof was recorded."
            );
        bitmap.Save(destination, ImageFormat.Png);
    }

    internal void RequireWindowScale(AutomationElement window, string runId, uint dpi)
    {
        RequireWindow(window, runId);
        if (GetDpiForWindow(window.Current.NativeWindowHandle) != dpi)
            throw new InvalidOperationException(
                "The actual owned window DPI does not match the requested real visual profile."
            );
    }

    internal async Task StopAsync(CancellationToken cancellationToken)
    {
        Process process = RequireProcess();
        process.Kill(entireProcessTree: false);
        await process.WaitForExitAsync(cancellationToken);
        process.Dispose();
        _process = null;
    }

    public async ValueTask DisposeAsync()
    {
        if (_process is null)
            return;
        if (!_process.HasExited)
            await StopAsync(CancellationToken.None);
        else
        {
            _process.Dispose();
            _process = null;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    [LibraryImport("kernel32.dll")]
    private static unsafe partial int GetPackageFamilyName(
        nint process,
        ref uint length,
        char* family
    );

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetWindowRect(nint window, out NativeRect rect);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool PrintWindow(nint window, nint context, uint flags);

    [LibraryImport("user32.dll")]
    private static partial nint GetForegroundWindow();

    [LibraryImport("user32.dll")]
    private static partial uint GetWindowThreadProcessId(nint window, out uint process);

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(nint window);

    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    private class ApplicationActivationManager { }

    [
        ComImport,
        Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),
        InterfaceType(ComInterfaceType.InterfaceIsIUnknown)
    ]
    private interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string applicationUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            uint options,
            out uint processId
        );

        [PreserveSig]
        int ActivateForFile(
            [MarshalAs(UnmanagedType.LPWStr)] string applicationUserModelId,
            nint items,
            [MarshalAs(UnmanagedType.LPWStr)] string verb,
            out uint processId
        );

        [PreserveSig]
        int ActivateForProtocol(
            [MarshalAs(UnmanagedType.LPWStr)] string applicationUserModelId,
            nint items,
            out uint processId
        );
    }
}
