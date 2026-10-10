using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Native folder capabilities with durable displaced versions.</summary>
internal sealed partial class FacetVaultFiles
{
    // Pre-bounded record retained only by legacy recovery fixtures; never exposed as a Rust callback.
    internal sealed record LegacyFileExchange(
        bool Applied,
        byte[]? DisplacedBytes,
        string? DisplacedVersionId
    );

    private readonly Dictionary<string, string> _roots = new(StringComparer.Ordinal);
    private readonly HashSet<string> _exclusiveReplicas = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    internal void Register(string profile, string root, bool exclusiveReplica = false) =>
        Boundary(() =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(profile);
            string full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
            if (
                ExistingAttributes(full) is not { } attributes
                || (attributes & FileAttributes.Directory) == 0
            )
                throw new Core.FacetHostException.Unavailable("Select an existing vault folder.");
            lock (_gate)
            {
                using var pins = PinDirectory(full);
                if (
                    _roots.TryGetValue(profile, out string? previous)
                    && !StringComparer.OrdinalIgnoreCase.Equals(previous, full)
                )
                    throw new InvalidOperationException(
                        "The profile already owns another folder capability."
                    );
                _roots[profile] = full;
                if (exclusiveReplica)
                    _exclusiveReplicas.Add(profile);
            }
            return true;
        });

    public string[] ListFiles(string profileId) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                string root = Root(profileId);
                List<string> paths = [];
                Walk(root, root, paths);
                return paths.Order(StringComparer.Ordinal).ToArray();
            }
        });

    private static void Walk(string root, string directory, List<string> paths)
    {
        using var pins = PinDirectory(directory);
        foreach (string item in Directory.EnumerateFileSystemEntries(directory))
        {
            if (IsReserved(Path.GetFileName(item)))
                continue;
            FileAttributes attributes = File.GetAttributes(item);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new Core.FacetHostException.PermissionDenied(
                    "Vault links and reparse points are unsupported."
                );
            if ((attributes & FileAttributes.Directory) != 0)
                Walk(root, item, paths);
            else
                paths.Add(
                    Path.GetRelativePath(root, item).Replace(Path.DirectorySeparatorChar, '/')
                );
        }
    }

    public byte[]? ReadFile(string profileId, string path) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                string target = Resolve(profileId, path);
                string parent = Path.GetDirectoryName(target)!;
                if (ExistingAttributes(parent) is null)
                    return null;
                using var pins = PinDirectory(parent);
                return ReadExact(target);
            }
        });

    internal LegacyFileExchange CompareExchange(
        string profileId,
        string path,
        string? expectedRevision,
        byte[]? replacement
    ) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                RequireWritableReplica(profileId);
                string target = Resolve(profileId, path);
                string parent = Path.GetDirectoryName(target)!;
                // Pin each existing ancestor before creating the next component.
                EnsureParents(profileId, path);
                using var pins = PinDirectory(parent);
                byte[]? observed = ReadExact(target);
                string? revision = observed is null
                    ? null
                    : Convert.ToHexStringLower(SHA256.HashData(observed));
                if (!StringComparer.Ordinal.Equals(revision, expectedRevision))
                    return new LegacyFileExchange(false, null, null);
                if (observed is null && replacement is null)
                    return new LegacyFileExchange(true, null, null);

                // Journal lives on the same volume: ReplaceFile/rename capture the old
                // bytes atomically, including a competing writer after the read above.
                string backupDirectory = BackupDirectory(profileId);
                EnsureDirectory(backupDirectory);
                using var backupPins = PinDirectory(backupDirectory);
                string id = Guid.NewGuid().ToString("N");
                string backup = Path.Combine(backupDirectory, id + ".bytes");
                string metadata = Path.Combine(backupDirectory, id + ".json");
                WriteDurable(metadata, JsonSerializer.SerializeToUtf8Bytes(new BackupEntry(path)));
                string temporary = Path.Combine(parent, ".facet-write-" + id);
                try
                {
                    if (replacement is null)
                    {
                        File.Move(target, backup, false);
                    }
                    else
                    {
                        WriteDurable(temporary, replacement);
                        if (observed is null)
                            File.Move(temporary, target, false);
                        else
                            File.Replace(temporary, target, backup, false);
                    }
                    byte[]? displaced = ReadExact(backup);
                    if (displaced is null)
                    {
                        File.Delete(metadata);
                        return new LegacyFileExchange(true, null, null);
                    }
                    FacetDurableJson.Write(
                        metadata,
                        new BackupEntry(
                            path,
                            checked((ulong)displaced.LongLength),
                            Convert.ToHexStringLower(SHA256.HashData(displaced))
                        )
                    );
                    return new LegacyFileExchange(true, displaced, id);
                }
                finally
                {
                    File.Delete(temporary);
                }
            }
        });

    public Core.FacetDisplacedMetadata[] DisplacedMetadata(
        string profileId,
        string? afterId,
        uint limit
    ) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                string directory = BackupDirectory(profileId);
                if (ExistingAttributes(directory) is null)
                    return [];
                using var pins = PinDirectory(directory);
                foreach (string prepared in Directory.EnumerateFiles(directory, "*.json"))
                    if (ExistingAttributes(Path.ChangeExtension(prepared, ".bytes")) is null)
                        throw new Core.FacetHostException.Unavailable(
                            "A legacy recovery record is missing its captured file. Restore that version or explicitly review its recovery disposition; current destination bytes cannot prove the original outcome."
                        );
                List<Core.FacetDisplacedMetadata> result = [];
                foreach (
                    string backup in Directory
                        .EnumerateFiles(directory, "*.bytes")
                        .Order(StringComparer.Ordinal)
                        .Where(path =>
                            afterId is null
                            || StringComparer.Ordinal.Compare(
                                Path.GetFileNameWithoutExtension(path),
                                afterId
                            ) > 0
                        )
                        .Take(checked((int)limit))
                )
                {
                    string id = Path.GetFileNameWithoutExtension(backup);
                    if (!Guid.TryParseExact(id, "N", out _))
                        throw new InvalidDataException("A retained version identity is invalid.");
                    var entry =
                        JsonSerializer.Deserialize<BackupEntry>(
                            ReadExact(Path.Combine(directory, id + ".json"))
                                ?? throw new InvalidDataException(
                                    "A retained version is missing its identity."
                                )
                        )
                        ?? throw new InvalidDataException(
                            "A retained version identity is invalid."
                        );
                    _ = Resolve(profileId, entry.Path);
                    using var stream =
                        OpenReadExact(backup)
                        ?? throw new InvalidDataException("A retained version disappeared.");
                    if (entry.Size is null || entry.Revision is null)
                    {
                        // A crash after atomic capture but before sealing metadata is
                        // recovered from the immutable captured file, never from the
                        // pre-exchange observation of a competing writer.
                        entry = entry with
                        {
                            Size = checked((ulong)stream.Length),
                            Revision = Convert.ToHexStringLower(SHA256.HashData(stream)),
                        };
                        FacetDurableJson.Write(Path.Combine(directory, id + ".json"), entry);
                    }
                    if (
                        entry.Revision.Length != 64
                        || !entry.Revision.All(Uri.IsHexDigit)
                        || entry.Size != checked((ulong)stream.Length)
                    )
                        throw new InvalidDataException("The retained version metadata is corrupt.");
                    result.Add(
                        new Core.FacetDisplacedMetadata(
                            id,
                            entry.Path,
                            entry.Size.Value,
                            entry.Revision
                        )
                    );
                }
                return result.ToArray();
            }
        });

    public byte[] ReadDisplaced(string profileId, string id) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                if (!Guid.TryParseExact(id, "N", out _))
                    throw new ArgumentException("Invalid retained version identity.");
                string directory = BackupDirectory(profileId);
                using var pins = PinDirectory(directory);
                return ReadExact(Path.Combine(directory, id + ".bytes"))
                    ?? throw new InvalidDataException("A retained version disappeared.");
            }
        });

    public void AcknowledgeDisplaced(string profileId, string id) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                if (!Guid.TryParseExact(id, "N", out _))
                    throw new ArgumentException("Invalid retained version identity.");
                string directory = BackupDirectory(profileId);
                using var pins = PinDirectory(directory);
                File.Delete(Path.Combine(directory, id + ".bytes"));
                File.Delete(Path.Combine(directory, id + ".json"));
                return true;
            }
        });

    internal void ApplyDirectory(string profileId, string path, bool deleted) =>
        Boundary(() =>
        {
            lock (_gate)
            {
                RequireWritableReplica(profileId);
                string target = Resolve(profileId, path);
                EnsureParents(profileId, path);
                using var pins = PinDirectory(Path.GetDirectoryName(target)!);
                if (deleted)
                {
                    if (Directory.Exists(target))
                    {
                        using var targetPins = PinDirectory(target);
                        if (Directory.EnumerateFileSystemEntries(target).Any())
                            return false;
                        // Release the target handle before deleting its empty directory.
                        targetPins.Dispose();
                        Directory.Delete(target, false);
                    }
                }
                else
                {
                    Directory.CreateDirectory(target);
                    using var targetPins = PinDirectory(target);
                }
                return true;
            }
        });

    private string Root(string profile) =>
        _roots.TryGetValue(profile, out string? root)
            ? root
            : throw new Core.FacetHostException.Unavailable("The vault capability is unavailable.");

    private void RequireWritableReplica(string profile)
    {
        if (!_exclusiveReplicas.Contains(profile))
            throw new Core.FacetHostException.PermissionDenied(
                "External-folder writes require a verified Windows filesystem capability. This folder is currently read-only."
            );
    }

    private string Resolve(string profile, string path)
    {
        string[] parts = path.Split('/');
        if (
            parts.Any(p =>
                p.Length == 0
                || p is "." or ".."
                || p.EndsWith('.')
                || p.EndsWith(' ')
                || IsDeviceName(p)
                || p.Any(c =>
                    char.IsControl(c)
                    || c is '\\' or ':' or '<' or '>' or '"' or '|' or '?' or '*'
                    || Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0
                )
            )
        )
            throw new ArgumentException("Invalid vault-relative path.");
        if (parts.Any(IsReserved))
            throw new ArgumentException("Reserved private write path.");
        return Path.Combine([Root(profile), .. parts]);
    }

    private static bool IsReserved(string component) =>
        component.Equals(".facet-private-backups", StringComparison.OrdinalIgnoreCase)
        || component.StartsWith(".facet-write-", StringComparison.OrdinalIgnoreCase);

    private static bool IsDeviceName(string component)
    {
        string stem = component.Split('.')[0].TrimEnd(' ');
        return stem.Equals("CON", StringComparison.OrdinalIgnoreCase)
            || stem.Equals("PRN", StringComparison.OrdinalIgnoreCase)
            || stem.Equals("AUX", StringComparison.OrdinalIgnoreCase)
            || stem.Equals("NUL", StringComparison.OrdinalIgnoreCase)
            || stem.Equals("CONIN$", StringComparison.OrdinalIgnoreCase)
            || stem.Equals("CONOUT$", StringComparison.OrdinalIgnoreCase)
            || (
                stem.Length == 4
                && (
                    stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
                    || stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)
                )
                && (stem[3] is >= '1' and <= '9' or '¹' or '²' or '³')
            );
    }

    internal void Unregister(string profile)
    {
        lock (_gate)
        {
            _roots.Remove(profile);
            _exclusiveReplicas.Remove(profile);
        }
    }

    private void EnsureParents(string profile, string path)
    {
        string current = Root(profile);
        foreach (string component in path.Split('/').SkipLast(1))
        {
            using var pins = PinDirectory(current);
            current = Path.Combine(current, component);
            Directory.CreateDirectory(current);
        }
    }

    private static void EnsureDirectory(string directory)
    {
        string current = Path.GetPathRoot(directory)!;
        foreach (
            string component in Path.GetRelativePath(current, directory)
                .Split(Path.DirectorySeparatorChar)
        )
        {
            using var pins = PinDirectory(current);
            current = Path.Combine(current, component);
            Directory.CreateDirectory(current);
        }
    }

    private string BackupDirectory(string profile)
    {
        string root = Root(profile);
        string hash = Convert.ToHexStringLower(
            SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(profile))
        );
        return Path.Combine(root, ".facet-private-backups", hash);
    }

    private static byte[]? ReadExact(string path)
    {
        using var stream = OpenReadExact(path);
        if (stream is null)
            return null;
        using var output = new MemoryStream();
        stream.CopyTo(output);
        return output.ToArray();
    }

    private static FileStream? OpenReadExact(string path)
    {
        if (OperatingSystem.IsWindows())
        {
            SafeFileHandle handle = Native.CreateFile(
                path,
                0x80000000,
                1 | 2 | 4,
                0,
                3,
                0x00200000,
                0
            );
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastPInvokeError();
                handle.Dispose();
                if (error == 2)
                    return null;
                throw new IOException("The vault file could not be opened.");
            }
            try
            {
                Native.RejectLink(handle);
                return new FileStream(handle, FileAccess.Read);
            }
            catch
            {
                handle.Dispose();
                throw;
            }
        }
        var attributes = ExistingAttributes(path);
        if (attributes is null)
            return null;
        if ((attributes & FileAttributes.ReparsePoint) != 0)
            throw new Core.FacetHostException.PermissionDenied("Vault links are unsupported.");
        return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
    }

    internal static string BoundedFileIdentity(FileStream stream)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException(
                "Descriptor file identities require Windows native acceptance."
            );
        return Native.FileIdentity(stream.SafeFileHandle);
    }

    internal static string BoundedFileIdentity(string path)
    {
        using FileStream stream =
            OpenReadExact(path)
            ?? throw new FileNotFoundException("The prepared file identity is missing.");
        return BoundedFileIdentity(stream);
    }

    internal static int BoundedIdentityRecordSize => Marshal.SizeOf<Native.FileIdentifier>();

    private static FileAttributes? ExistingAttributes(string path)
    {
        try
        {
            return File.GetAttributes(path);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    private static void WriteDurable(string path, byte[] bytes)
    {
        using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            4096,
            FileOptions.WriteThrough
        );
        stream.Write(bytes);
        stream.Flush(true);
    }

    private static DirectoryPins PinDirectory(string path)
    {
        var pins = new DirectoryPins();
        try
        {
            string current = Path.GetPathRoot(path)!;
            foreach (
                string part in Path.GetRelativePath(current, path)
                    .Split(Path.DirectorySeparatorChar)
            )
            {
                if (part == ".")
                    continue;
                current = Path.Combine(current, part);
                if (OperatingSystem.IsWindows())
                {
                    // No FILE_SHARE_DELETE: a directory/junction cannot be replaced
                    // while operations using its namespace are in progress.
                    SafeFileHandle handle = Native.CreateFile(
                        current,
                        0,
                        1 | 2,
                        0,
                        3,
                        0x02000000 | 0x00200000,
                        0
                    );
                    pins.Handles.Add(handle);
                    if (handle.IsInvalid)
                        throw new IOException(
                            "The vault directory capability could not be pinned."
                        );
                    Native.RejectLink(handle);
                }
                else if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new Core.FacetHostException.PermissionDenied(
                        "Vault links are unsupported."
                    );
            }
            return pins;
        }
        catch
        {
            pins.Dispose();
            throw;
        }
    }

    private static T Boundary<T>(Func<T> operation)
    {
        try
        {
            return operation();
        }
        catch (UnauthorizedAccessException)
        {
            throw new Core.FacetHostException.PermissionDenied(
                "Restore access to the selected vault folder."
            );
        }
        catch (IOException)
        {
            throw new Core.FacetHostException.Io("The durable vault filesystem operation failed.");
        }
    }

    private sealed record BackupEntry(string Path, ulong? Size = null, string? Revision = null);

    private sealed class DirectoryPins : IDisposable
    {
        internal List<SafeFileHandle> Handles { get; } = [];

        public void Dispose()
        {
            foreach (var handle in Handles)
                handle.Dispose();
        }
    }

    private static class Native
    {
        [DllImport(
            "kernel32.dll",
            EntryPoint = "CreateFileW",
            CharSet = CharSet.Unicode,
            SetLastError = true
        )]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        internal static extern SafeFileHandle CreateFile(
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
        private static extern bool GetFileInformationByHandle(
            SafeFileHandle handle,
            out FileInformation information
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandleEx(
            SafeFileHandle handle,
            int informationClass,
            out FileIdentifier information,
            uint size
        );

        internal static void RejectLink(SafeFileHandle handle)
        {
            if (!GetFileInformationByHandle(handle, out var information))
                throw new IOException("The vault handle could not be inspected.");
            if ((information.Attributes & (uint)FileAttributes.ReparsePoint) != 0)
                throw new Core.FacetHostException.PermissionDenied(
                    "Vault links and reparse points are unsupported."
                );
        }

        internal static string FileIdentity(SafeFileHandle handle)
        {
            if (!GetFileInformationByHandle(handle, out var information))
                throw new IOException("The bounded file descriptor could not be inspected.");
            if (
                (
                    information.Attributes
                    & ((uint)FileAttributes.ReparsePoint | (uint)FileAttributes.Directory)
                ) != 0
            )
                throw new Core.FacetHostException.PermissionDenied(
                    "A bounded read requires a regular file without reparse points."
                );
            // FileIdInfo=18: retain the full128-bit identifier. Legacy64-bit
            // BY_HANDLE_FILE_INFORMATION indices are not unique on ReFS.
            if (
                !GetFileInformationByHandleEx(
                    handle,
                    18,
                    out var identity,
                    checked((uint)Marshal.SizeOf<FileIdentifier>())
                )
            )
                throw new IOException(
                    "The filesystem cannot supply its required128-bit file identity."
                );
            return identity.VolumeSerial.ToString(
                    "x16",
                    System.Globalization.CultureInfo.InvariantCulture
                )
                + ":"
                + identity.IdentifierHigh.ToString(
                    "x16",
                    System.Globalization.CultureInfo.InvariantCulture
                )
                + identity.IdentifierLow.ToString(
                    "x16",
                    System.Globalization.CultureInfo.InvariantCulture
                );
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct FileIdentifier
        {
            internal ulong VolumeSerial,
                IdentifierLow,
                IdentifierHigh;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileInformation
        {
            internal uint Attributes;
            internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime,
                AccessTime,
                WriteTime;
            internal uint VolumeSerial,
                SizeHigh,
                SizeLow,
                Links,
                IndexHigh,
                IndexLow;
        }
    }
}
