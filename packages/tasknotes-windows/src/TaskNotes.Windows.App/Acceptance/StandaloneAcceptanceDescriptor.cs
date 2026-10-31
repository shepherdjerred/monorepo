using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.App.Acceptance;

/// <summary>Test-build bootstrap identity confined to the isolated package's private LocalState.</summary>
internal sealed record StandaloneAcceptanceDescriptor(
    [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
    [property: JsonPropertyName("runId")] string RunId,
    [property: JsonPropertyName("packageFamilyName")] string PackageFamilyName,
    [property: JsonPropertyName("profileId")] string ProfileId,
    [property: JsonPropertyName("stateDirectory")] string StateDirectory,
    [property: JsonPropertyName("seedFiles")] StandaloneSeedFile[] SeedFiles
)
{
    private static readonly StringComparison PathComparison = OperatingSystem.IsWindows()
        ? StringComparison.OrdinalIgnoreCase
        : StringComparison.Ordinal;

    internal string VaultDirectory => Path.Combine(StateDirectory, "vault");

    internal string EngineDirectory => Path.Combine(StateDirectory, "Facet");

    internal static StandaloneAcceptanceDescriptor Read(
        string descriptorPath,
        string localStateDirectory,
        string packageFamilyName,
        string schemaJson
    )
    {
        string fullPath = Path.GetFullPath(descriptorPath);
        string? directory = Path.GetDirectoryName(fullPath);
        string? runId = directory is null ? null : Path.GetFileName(directory);
        string root = Path.Combine(Path.GetFullPath(localStateDirectory), "StandaloneAcceptance");
        if (
            runId is null
            || !Guid.TryParseExact(runId, "D", out Guid parsed)
            || parsed.ToString("D") != runId
            || !string.Equals(
                fullPath,
                Path.Combine(root, runId, "descriptor.json"),
                PathComparison
            )
        )
            throw new InvalidDataException(
                "The acceptance descriptor is outside its exact private run."
            );
        RequireUnlinkedPath(fullPath);
        using FileStream stream = new(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is <= 0 or > 131_072)
            throw new InvalidDataException("The acceptance descriptor has an invalid size.");
        using StreamReader reader = new(stream);
        string json = reader.ReadToEnd();
        var schema = new FacetSchema(schemaJson);
        schema.Validate(json, "descriptor");
        var value =
            JsonSerializer.Deserialize<StandaloneAcceptanceDescriptor>(json)
            ?? throw new InvalidDataException("The acceptance descriptor is empty.");
        if (
            value.RunId != runId
            || value.PackageFamilyName != packageFamilyName
            || value.ProfileId != "acceptance-" + runId
            || !string.Equals(value.StateDirectory, Path.Combine(root, runId), PathComparison)
            || value
                .SeedFiles.Select(file => file.Path)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count() != value.SeedFiles.Length
        )
            throw new InvalidDataException(
                "The acceptance run, package or profile identity changed."
            );
        foreach (var file in value.SeedFiles)
            _ = value.ResolveSeed(file.Path);
        RequireUnlinkedPath(fullPath);
        return value;
    }

    internal string ResolveSeed(string relative)
    {
        if (
            relative.Contains('\\', StringComparison.Ordinal)
            || relative.Contains(':', StringComparison.Ordinal)
            || relative.Any(char.IsControl)
            || relative.Split('/').Any(part => part is "" or "." or "..")
            || relative
                .Split('/')
                .Any(part =>
                    part.EndsWith(' ') || part.EndsWith('.') || IsDeviceName(part.Split('.')[0])
                )
            || Path.IsPathRooted(relative)
        )
            throw new InvalidDataException(
                "An acceptance seed path is not canonical and relative."
            );
        return Path.Combine(VaultDirectory, relative.Replace('/', Path.DirectorySeparatorChar));
    }

    private static bool IsDeviceName(string value)
    {
        string name = value.ToUpperInvariant();
        return name is "CON" or "PRN" or "AUX" or "NUL"
            || name.Length == 4
                && (
                    name.StartsWith("COM", StringComparison.Ordinal)
                    || name.StartsWith("LPT", StringComparison.Ordinal)
                )
                && name[3] is >= '1' and <= '9';
    }

    internal void VerifySeedBytes()
    {
        RequireUnlinkedPath(VaultDirectory);
        HashSet<string> expected = SeedFiles
            .Select(seed => Path.GetFullPath(ResolveSeed(seed.Path)))
            .ToHashSet(
                OperatingSystem.IsWindows()
                    ? StringComparer.OrdinalIgnoreCase
                    : StringComparer.Ordinal
            );
        Stack<string> pending = new();
        pending.Push(VaultDirectory);
        while (pending.TryPop(out string? directory))
            foreach (string entry in Directory.EnumerateFileSystemEntries(directory))
            {
                RequireUnlinkedPath(entry);
                if ((File.GetAttributes(entry) & FileAttributes.Directory) != 0)
                    pending.Push(entry);
                else if (!expected.Remove(Path.GetFullPath(entry)))
                    throw new InvalidDataException(
                        "The private acceptance seed contains an undeclared file."
                    );
            }
        if (expected.Count != 0)
            throw new InvalidDataException("The private acceptance seed is incomplete.");
        foreach (var file in SeedFiles)
        {
            string path = ResolveSeed(file.Path);
            RequireUnlinkedPath(path);
            using FileStream stream = new(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (Convert.ToHexStringLower(SHA256.HashData(stream)) != file.Sha256)
                throw new InvalidDataException(
                    "The private acceptance seed bytes changed before registration."
                );
            RequireUnlinkedPath(path);
        }
    }

    internal static void RequireUnlinkedPath(string path)
    {
        string full = Path.GetFullPath(path);
        for (string? current = full; current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException(
                    "Acceptance paths cannot contain links or reparse points."
                );
    }
}

/// <summary>Exact initial seed identity; current task bytes remain mutable after bootstrap.</summary>
internal sealed record StandaloneSeedFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("sha256")] string Sha256
);
