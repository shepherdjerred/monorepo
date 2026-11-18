using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TaskNotes.Windows.App.Acceptance;

namespace TaskNotes.Windows.E2E;

/// <summary>Reads YAML frontmatter from private acceptance seed files without external native bindings.</summary>
internal sealed class StandaloneMarkdownReader : IAsyncDisposable
{
    private readonly StandaloneAcceptanceDescriptor _descriptor;
    private const int MaximumNoteBytes = 2 * 1024 * 1024;

    private StandaloneMarkdownReader(StandaloneAcceptanceDescriptor descriptor)
    {
        _descriptor = descriptor;
    }

    internal static Task<StandaloneMarkdownReader> CreateAsync(
        StandaloneAcceptanceDescriptor descriptor,
        CancellationToken cancellation
    )
    {
        cancellation.ThrowIfCancellationRequested();
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(descriptor.StateDirectory);
        return Task.FromResult(new StandaloneMarkdownReader(descriptor));
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
                byte[] after = await ReadBoundedAsync(exact, timeout.Token);
                StandaloneAcceptanceDescriptor.RequireUnlinkedPath(exact);
                if (
                    CryptographicOperations.FixedTimeEquals(
                        SHA256.HashData(before),
                        SHA256.HashData(after)
                    )
                )
                {
                    return ParseFrontmatter(Encoding.UTF8.GetString(before));
                }
                await Task.Delay(TimeSpan.FromMilliseconds(25), timeout.Token);
            }
        }
        catch (FileNotFoundException)
        {
            return null;
        }
    }

    internal Task<bool> HasSettledAsync(CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return Task.FromResult(Directory.Exists(_descriptor.VaultDirectory));
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static JsonElement ParseFrontmatter(string markdown)
    {
        Dictionary<string, object?> fields = new(StringComparer.Ordinal);
        string[] lines = markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        if (lines.Length >= 2 && lines[0].Trim() == "---")
        {
            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (line.Trim() == "---")
                    break;
                if (string.IsNullOrWhiteSpace(line) || line.TrimStart().StartsWith('#'))
                    continue;
                int colon = line.IndexOf(':', StringComparison.Ordinal);
                if (colon <= 0)
                    continue;
                string key = line[..colon].Trim();
                string rawVal = line[(colon + 1)..].Trim();
                fields[key] = ParseScalarOrList(rawVal);
            }
        }
        return JsonSerializer.SerializeToElement(fields);
    }

    private static object? ParseScalarOrList(string raw)
    {
        if (raw.Length == 0 || raw is "null" or "~")
            return null;
        if (raw.StartsWith('[') && raw.EndsWith(']'))
        {
            return raw[1..^1]
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(UnquoteYaml)
                .ToArray();
        }
        if (bool.TryParse(raw, out bool b))
            return b;
        if (int.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, out int n))
            return n;
        return UnquoteYaml(raw);
    }

    private static string UnquoteYaml(string value) =>
        value.Length >= 2
        && ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\''))
            ? value[1..^1]
            : value;

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
}
