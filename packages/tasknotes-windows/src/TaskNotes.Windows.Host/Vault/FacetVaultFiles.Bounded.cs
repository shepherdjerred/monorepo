namespace TaskNotes.Windows.Host;

internal sealed partial class FacetVaultFiles
{
    /// <summary>Bind only the actual future engine identity(), after construction and before registering callbacks.</summary>
    internal FacetBoundedVault OpenBoundedCapability(
        string profile,
        string engineIdentity,
        string privateMetadataDirectory,
        Func<FileStream, string>? identity = null,
        Action<string, string?>? durability = null
    )
    {
        lock (_gate)
        {
            _ = Root(profile);
            using var pins = PinDirectory(Root(profile));
            return new(
                privateMetadataDirectory,
                profile,
                engineIdentity,
                Root(profile),
                path => Resolve(profile, path),
                PinDirectory,
                OpenReadExact,
                () => RequireWritableReplica(profile),
                path => EnsureParents(profile, path),
                identity ?? BoundedFileIdentity,
                durability ?? FacetWindowsFileCommit.FlushEffects,
                new FacetLegacyBackups(
                    BackupDirectory(profile),
                    Path.Combine(privateMetadataDirectory, "legacy-acknowledgements"),
                    profile,
                    engineIdentity,
                    OpenReadExact,
                    path => Resolve(profile, path),
                    requireWritable: () => RequireWritableReplica(profile),
                    pinDirectory: PinDirectory
                )
            );
        }
    }
}
