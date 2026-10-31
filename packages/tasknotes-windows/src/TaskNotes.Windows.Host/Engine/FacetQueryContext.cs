using System.Globalization;
using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Admits a saved selection with one captured viewer clock and strips device context before persistence.</summary>
internal static class FacetQueryContext
{
    internal static Dictionary<string, JsonElement> Apply(
        Dictionary<string, JsonElement> query,
        DateTimeOffset instant,
        TimeZoneInfo zone
    )
    {
        string timezone = FacetTimeZone.IanaId(zone);
        query["today"] = JsonSerializer.SerializeToElement(
            TimeZoneInfo
                .ConvertTime(instant, zone)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        );
        query["at"] = JsonSerializer.SerializeToElement(
            instant.ToString("O", CultureInfo.InvariantCulture)
        );
        query["timezone"] = JsonSerializer.SerializeToElement(timezone);
        return query;
    }

    internal static Dictionary<string, JsonElement> Selection(JsonElement query)
    {
        var selection =
            JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(query.GetRawText())
            ?? throw new InvalidDataException("The saved query must be an object.");
        foreach (string field in new[] { "offset", "limit", "today", "at", "timezone" })
            selection.Remove(field);
        return selection;
    }
}
