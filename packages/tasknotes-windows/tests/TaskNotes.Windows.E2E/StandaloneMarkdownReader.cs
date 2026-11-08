using System.Security.Cryptography;
using System.Text.Json;
using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.E2E;

/// <summary>Reads actual fixture bytes with Rust's YAML parser through a production read-only native capability and its own private index.</summary>
internal sealed class StandaloneMarkdownReader : IAsyncDisposable
{
    private readonly StandaloneAcceptanceDescriptor _descriptor;
    private readonly FacetEngineService _engine;
    private const int MaximumNoteBytes = 2 * 1024 * 1024;

    private StandaloneMarkdownReader(StandaloneAcceptanceDescriptor descriptor, string index)
    {
        _descriptor = descriptor;
        _engine = new FacetEngineService(
            index,
            [new(descriptor.ProfileId, descriptor.VaultDirectory, false)]
        );
    }

    internal static async Task<StandaloneMarkdownReader> CreateAsync(
        StandaloneAcceptanceDescriptor descriptor,
        CancellationToken cancellation
    )
    {
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(descriptor.StateDirectory);
        string directory = Path.Combine(
            descriptor.StateDirectory,
            "inspection-" + Guid.NewGuid().ToString("N")
        );
        Directory.CreateDirectory(directory);
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(directory);
        StandaloneMarkdownReader reader = new(
            descriptor,
            Path.Combine(directory, "readonly.sqlite")
        );
        try
        {
            await reader._engine.InitializeAsync(cancellation);
            _ = await reader._engine.RegisterProfileAsync(
                descriptor.ProfileId,
                "Synthetic acceptance read-only inspector",
                descriptor.VaultDirectory,
                false,
                false,
                cancellation
            );
            using var profiles = JsonDocument.Parse(
                await reader._engine.ProfilesAsync(cancellation)
            );
            var entries = profiles.RootElement.GetProperty("profiles");
            if (
                entries.GetArrayLength() != 1
                || entries[0].GetProperty("id").GetString() != descriptor.ProfileId
                || entries[0].GetProperty("kind").GetString() != "local_folder"
            )
                throw new InvalidDataException(
                    "The semantic inspector did not retain its exact read-only profile."
                );
            return reader;
        }
        catch
        {
            await reader.DisposeAsync();
            throw;
        }
    }

    internal async Task<JsonElement?> ReadAsync(string filename, CancellationToken cancellation)
    {
        string relative = Path.GetRelativePath(
                _descriptor.VaultDirectory,
                Path.GetFullPath(filename)
            )
            .Replace('\\', '/');
        string exact = _descriptor.ResolveSeed(relative);
        if (!string.Equals(Path.GetFullPath(filename), exact, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(
                "The semantic assertion is outside the exact owned vault."
            );
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation
        );
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            while (true)
            {
                timeout.Token.ThrowIfCancellationRequested();
                StandaloneAcceptanceDescriptor.RequireUnlinkedPath(exact);
                byte[] before = await ReadBoundedAsync(exact, timeout.Token);
                string request = JsonSerializer
                    .SerializeToElement(new { kind = "normalization_preview", path = relative })
                    .GetRawText();
                using var normalized = JsonDocument.Parse(
                    await _engine.FeaturesAsync(_descriptor.ProfileId, request, timeout.Token)
                );
                byte[] after = await ReadBoundedAsync(exact, timeout.Token);
                StandaloneAcceptanceDescriptor.RequireUnlinkedPath(exact);
                if (
                    CryptographicOperations.FixedTimeEquals(
                        SHA256.HashData(before),
                        SHA256.HashData(after)
                    )
                )
                    return normalized.RootElement.GetProperty("frontmatter").Clone();
                await Task.Delay(TimeSpan.FromMilliseconds(25), timeout.Token);
            }
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (Core.FacetEngineException.NotFound)
        {
            return null;
        }
    }

    internal async Task<bool> HasSettledAsync(CancellationToken cancellation)
    {
        string journal = Path.Combine(_descriptor.EngineDirectory, "mutation-envelopes.json");
        if (!File.Exists(journal))
            return false;
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(journal);
        using var document = JsonDocument.Parse(await ReadBoundedAsync(journal, cancellation));
        var root = document.RootElement;
        if (root.GetProperty("SchemaVersion").GetInt32() != 1)
            throw new InvalidDataException("The owned action journal changed schema.");
        var entries = root.GetProperty("Pending").EnumerateObject().ToArray();
        foreach (var entry in entries)
            if (entry.Value.GetProperty("Profile").GetString() != _descriptor.ProfileId)
                throw new InvalidDataException(
                    "The settlement observation includes another profile."
                );
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(journal);
        return entries.Length == 0;
    }

    private static async Task<byte[]> ReadBoundedAsync(
        string filename,
        CancellationToken cancellation
    )
    {
        using FileStream stream = new(
            filename,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            65536,
            FileOptions.Asynchronous
        );
        if (stream.Length is < 0 or > MaximumNoteBytes)
            throw new InvalidDataException(
                "The synthetic note exceeds its semantic assertion budget."
            );
        byte[] bytes = new byte[checked((int)stream.Length)];
        await stream.ReadExactlyAsync(bytes, cancellation);
        return bytes;
    }

    public ValueTask DisposeAsync() => _engine.DisposeAsync();
}
