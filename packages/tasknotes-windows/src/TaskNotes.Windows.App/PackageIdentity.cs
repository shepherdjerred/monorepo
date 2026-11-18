using System.Runtime.InteropServices;

namespace TaskNotes.Windows.App;

/// <summary>Detects MSIX package identity without throwing on unpackaged <c>WindowsPackageType=None</c> launches.</summary>
internal static partial class PackageIdentity
{
    private const int ErrorNoPackage = 15700;

    /// <summary>Gets whether the current process is running with MSIX package identity.</summary>
    internal static bool IsPackaged { get; } = DetectPackageIdentity();

    /// <summary>Gets the root writable local data directory (<c>LocalFolder</c> when packaged, <c>%LOCALAPPDATA%\Facet</c> when unpackaged).</summary>
    internal static string LocalDataRoot
    {
        get
        {
            if (IsPackaged)
                return global::Windows.Storage.ApplicationData.Current.LocalFolder.Path;

            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Facet"
            );
            Directory.CreateDirectory(root);
            return root;
        }
    }

    private static bool DetectPackageIdentity()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
            return false;
        uint length = 0;
        int rc = GetCurrentPackageFullName(ref length, 0);
        return rc != ErrorNoPackage;
    }

    [LibraryImport("kernel32.dll", EntryPoint = "GetCurrentPackageFullName")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial int GetCurrentPackageFullName(
        ref uint packageFullNameLength,
        nint buffer
    );
}
