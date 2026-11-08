using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace TaskNotes.Windows.Host;

/// <summary>Supported Win32 file flush/write-through namespace operations; provider power-loss acceptance is separate.</summary>
internal static class FacetWindowsFileCommit
{
    internal static void Move(string source, string destination, bool replace)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException(
                "Write-through namespace commits require Windows."
            );
        // No COPY_ALLOWED: these are same-volume namespace operations, never
        // a successful copy that leaves the sole predecessor at another name.
        if (!MoveFileEx(source, destination, 8u | (replace ? 1u : 0u)))
            throw Failure("The write-through file move failed.");
    }

    internal static void FlushEffects(string target, string? captured)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Native file persistence requires Windows.");
        FlushExisting(target, allowMissing: true);
        if (captured is not null)
            FlushExisting(captured, allowMissing: false);
    }

    private static void FlushExisting(string path, bool allowMissing)
    {
        SafeFileHandle handle = CreateFile(path, 0xc0000000, 1 | 2 | 4, 0, 3, 0x80200000, 0);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            if (allowMissing && error == 2)
                return;
            throw new IOException(
                "The durable file could not be opened for native flush.",
                new Win32Exception(error)
            );
        }
        using (FileStream stream = new(handle, FileAccess.ReadWrite))
        {
            // Reject directories/reparse points from the actual descriptor.
            FacetVaultFiles.BoundedFileIdentity(stream);
            if (!FlushFileBuffers(stream.SafeFileHandle))
                throw Failure("The native file persistence barrier failed.");
        }
        // Windows has no assumed POSIX directory-fsync fallback here. Private
        // receipt namespace commits use MoveFileEx WRITE_THROUGH; external
        // folders remain read-only until actual provider/power-loss acceptance.
    }

    private static IOException Failure(string message) =>
        new(message, new Win32Exception(Marshal.GetLastPInvokeError()));

    [DllImport(
        "kernel32.dll",
        EntryPoint = "MoveFileExW",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string source, string destination, uint flags);

    [DllImport(
        "kernel32.dll",
        EntryPoint = "CreateFileW",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern SafeFileHandle CreateFile(
        string name,
        uint access,
        uint share,
        nint security,
        uint disposition,
        uint flags,
        nint template
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);
}
