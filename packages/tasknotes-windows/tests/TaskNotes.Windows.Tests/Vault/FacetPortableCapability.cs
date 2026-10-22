using System.Globalization;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Injected physical-file component capability; no Windows descriptor or power-loss acceptance claim.</summary>
internal static class FacetPortableCapability
{
    internal static FacetEngineService Open(
        string database,
        IEnumerable<FacetFolderCapability> capabilities
    ) => new(database, capabilities, Create);

    internal static FacetTaskNotesStore Store(
        string directory,
        IFacetSecretStore secrets,
        HttpClient? accountHttp = null,
        Func<IFacetSocket>? socketFactory = null,
        TimeProvider? time = null,
        bool allowSync = true,
        bool? synchronize = null
    ) =>
        new(directory, secrets, accountHttp, socketFactory, time, synchronize ?? allowSync, Create);

    internal static FacetBoundedVault Create(
        FacetVaultFiles files,
        string profile,
        string identity,
        string directory
    ) =>
        files.OpenBoundedCapability(
            profile,
            identity,
            directory,
            stream =>
                File.GetCreationTimeUtc(stream.SafeFileHandle)
                    .Ticks.ToString(CultureInfo.InvariantCulture),
            Flush
        );

    private static void Flush(string target, string? captured)
    {
        foreach (string? path in new[] { target, captured })
            if (path is not null && File.Exists(path))
            {
                using FileStream stream = new(
                    path,
                    FileMode.Open,
                    FileAccess.ReadWrite,
                    FileShare.ReadWrite | FileShare.Delete
                );
                stream.Flush(true);
            }
    }
}
