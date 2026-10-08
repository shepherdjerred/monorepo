using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Retains complete retry envelopes across ambiguous native failures.</summary>
internal sealed class FacetMutationJournal
{
    private readonly string _path;
    private Journal _journal;

    internal FacetMutationJournal(string directory)
    {
        _path = Path.Combine(directory, "mutation-envelopes.json");
        _journal = File.Exists(_path)
            ? JsonSerializer.Deserialize<Journal>(File.ReadAllBytes(_path))
                ?? throw new InvalidDataException("The mutation journal is corrupt.")
            : new Journal(1, [], []);
        if (_journal.SchemaVersion != 1)
            throw new InvalidDataException("Unsupported mutation journal version.");
        var schema = FacetSchema.Bundled();
        foreach (var (key, entry) in _journal.Pending)
        {
            if (entry.Key != key || string.IsNullOrWhiteSpace(entry.Profile))
                throw new InvalidDataException("The retained action ownership is corrupt.");
            schema.Validate(entry.Document, "retainedMutation");
            using var document = JsonDocument.Parse(entry.Document);
            if (document.RootElement.GetProperty("mutationId").GetString() != entry.Id)
                throw new InvalidDataException("The retained action identity is corrupt.");
        }
    }

    internal Entry Prepare(string profile, object command, string? requestKey = null)
    {
        // A published snapshot may advance revisions after the durable mutation but
        // before retry bookkeeping succeeds. Match the user request while retaining
        // every byte of the original command, revision, timestamp and mutation ID.
        string commandJson = LogicalRequest(JsonSerializer.SerializeToElement(command));
        string key = RequestIdentity(profile, requestKey ?? commandJson);
        if (_journal.Pending.TryGetValue(key, out var previous))
            return previous;
        DateTimeOffset now = DateTimeOffset.UtcNow;
        string zone = TimeZoneInfo.Local.Id;
        if (OperatingSystem.IsWindows())
            zone = TimeZoneInfo.TryConvertWindowsIdToIanaId(zone, out string? iana)
                ? iana
                : throw new InvalidOperationException(
                    "The local time zone has no IANA identifier."
                );
        string id = Guid.NewGuid().ToString("N");
        string document = JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                mutationId = id,
                at = now.ToString("O", CultureInfo.InvariantCulture),
                executionContext = new
                {
                    today = TimeZoneInfo
                        .ConvertTime(now, TimeZoneInfo.Local)
                        .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    timezone = zone,
                },
                command,
            }
        );
        Entry entry = new(key, profile, id, document);
        var pending = new Dictionary<string, Entry>(_journal.Pending, StringComparer.Ordinal)
        {
            [key] = entry,
        };
        Save(_journal with { Pending = pending });
        return entry;
    }

    internal void Complete(Entry entry, bool completion, string? undoReceiptId = null)
    {
        if (_journal.Pending.GetValueOrDefault(entry.Key) != entry)
            throw new InvalidOperationException(
                "The retained action was already observed or replaced."
            );
        var pending = new Dictionary<string, Entry>(_journal.Pending, StringComparer.Ordinal);
        pending.Remove(entry.Key);
        var undo = _journal.Undo.ToDictionary(
            pair => pair.Key,
            pair => new List<string>(pair.Value),
            StringComparer.Ordinal
        );
        if (completion)
        {
            if (!undo.TryGetValue(entry.Profile, out var entries))
                undo.Add(entry.Profile, entries = []);
            entries.Add(entry.Id);
        }
        if (undoReceiptId is not null)
        {
            if (
                !undo.TryGetValue(entry.Profile, out var entries)
                || entries.LastOrDefault() != undoReceiptId
            )
                throw new InvalidOperationException(
                    "The completion undo head changed before bookkeeping."
                );
            entries.RemoveAt(entries.Count - 1);
        }
        Save(_journal with { Pending = pending, Undo = undo });
    }

    private static string LogicalRequest(JsonElement command)
    {
        using MemoryStream stream = new();
        using (Utf8JsonWriter writer = new(stream))
            WriteLogicalRequest(writer, command);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteLogicalRequest(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (
                var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)
            )
                if (property.Name != "expectedRevision")
                {
                    writer.WritePropertyName(property.Name);
                    WriteLogicalRequest(writer, property.Value);
                }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var element in value.EnumerateArray())
                WriteLogicalRequest(writer, element);
            writer.WriteEndArray();
        }
        else
            value.WriteTo(writer);
    }

    internal string? UndoHead(string profile) =>
        _journal.Undo.GetValueOrDefault(profile)?.LastOrDefault();

    internal Entry? Pending(string profile, string requestKey) =>
        _journal.Pending.GetValueOrDefault(RequestIdentity(profile, requestKey));

    // Only called after observing a native absent or durably parked decision.
    // A transport error or typed Conflict alone cannot prove that it was rejected.
    internal void RetireRejected(Entry entry)
    {
        if (_journal.Pending.GetValueOrDefault(entry.Key) != entry)
            throw new InvalidOperationException("The retained decision identity changed.");
        Complete(entry, false);
    }

    private static string RequestIdentity(string profile, string requestKey) =>
        profile
        + ":"
        + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(requestKey)));

    internal int UndoDepth(string profile) => _journal.Undo.GetValueOrDefault(profile)?.Count ?? 0;

    internal IReadOnlyList<Entry> PendingEntries =>
        _journal.Pending.Values.OrderBy(entry => entry.Id, StringComparer.Ordinal).ToArray();

    private void Save(Journal next)
    {
        FacetDurableJson.Write(_path, next);
        _journal = next;
    }

    internal sealed record Entry(string Key, string Profile, string Id, string Document);

    private sealed record Journal(
        int SchemaVersion,
        Dictionary<string, Entry> Pending,
        Dictionary<string, List<string>> Undo
    );
}
