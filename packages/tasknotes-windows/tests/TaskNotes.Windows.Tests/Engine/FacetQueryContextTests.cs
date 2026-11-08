using System.Globalization;
using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Device context belongs to query admission, not the portable saved selection.</summary>
[TestClass]
public sealed class FacetQueryContextTests
{
    /// <summary>A saved agenda uses the viewer's captured zone and clock for every page.</summary>
    [TestMethod]
    public void AdmissionOverridesStaleSavedZoneWithoutChangingTheSelection()
    {
        const string raw =
            """{"schemaVersion":1,"scope":"todayAgenda","timezone":"Asia/Tokyo","today":"old","at":"2020-01-01T00:00:00Z","statuses":["custom"],"vendor":{"exact":9007199254740993}}""";
        var query = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(raw)!;
        DateTimeOffset instant = new(2026, 10, 4, 1, 0, 0, TimeSpan.Zero);
        TimeZoneInfo zone = TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles");
        var first = FacetQueryContext.Apply(query, instant, zone);
        var second = new Dictionary<string, JsonElement>(first, StringComparer.Ordinal)
        {
            ["offset"] = JsonSerializer.SerializeToElement(100),
            ["limit"] = JsonSerializer.SerializeToElement(1000),
        };
        Assert.AreEqual("2026-10-03", first["today"].GetString());
        Assert.AreEqual(
            instant.ToString("O", CultureInfo.InvariantCulture),
            first["at"].GetString()
        );
        Assert.AreEqual("America/Los_Angeles", first["timezone"].GetString());
        foreach (string field in new[] { "today", "at", "timezone", "scope", "statuses", "vendor" })
            Assert.AreEqual(first[field].GetRawText(), second[field].GetRawText());
        Assert.AreEqual("todayAgenda", second["scope"].GetString());
        Assert.AreEqual("9007199254740993", second["vendor"].GetProperty("exact").GetRawText());
    }

    /// <summary>Saving or duplicating a selection removes execution fields and leaves exact query values intact.</summary>
    [TestMethod]
    public void PersistenceStripsDeviceContextBeforeAnotherViewerAdmitsTheAgenda()
    {
        using var document = JsonDocument.Parse(
            """{"schemaVersion":1,"scope":"upcomingAgenda","offset":100,"limit":1000,"today":"2026-10-03","at":"2026-10-04T01:00:00Z","timezone":"America/Los_Angeles","statuses":["custom"],"vendor":{"exact":9007199254740993}}"""
        );
        var selection = FacetQueryContext.Selection(document.RootElement);
        foreach (string field in new[] { "offset", "limit", "today", "at", "timezone" })
            Assert.IsFalse(selection.ContainsKey(field));
        Assert.AreEqual("upcomingAgenda", selection["scope"].GetString());
        Assert.AreEqual("9007199254740993", selection["vendor"].GetProperty("exact").GetRawText());
        var admitted = FacetQueryContext.Apply(
            selection,
            new DateTimeOffset(2026, 10, 4, 1, 0, 0, TimeSpan.Zero),
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo")
        );
        Assert.AreEqual("Asia/Tokyo", admitted["timezone"].GetString());
        Assert.AreEqual("2026-10-04", admitted["today"].GetString());
    }

    /// <summary>Existing IANA and UTC identifiers retain their authority; unsupported custom zones never become UTC.</summary>
    [TestMethod]
    public void TimeZoneAuthorityPreservesSupportedIdentifiersAndRejectsUnknownZones()
    {
        Assert.AreEqual("UTC", FacetTimeZone.IanaId(TimeZoneInfo.Utc));
        Assert.AreEqual(
            "America/Los_Angeles",
            FacetTimeZone.IanaId(TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles"))
        );
        var unsupported = TimeZoneInfo.CreateCustomTimeZone(
            "FacetUnsupportedZone",
            TimeSpan.FromHours(5),
            "Unsupported",
            "Unsupported"
        );
        _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
            FacetTimeZone.IanaId(unsupported)
        );
    }

    /// <summary>A Windows identifier uses the platform conversion or fails when the host lacks that mapping.</summary>
    [TestMethod]
    public void WindowsTimeZoneNamesRequireTheSupportedIanaConversion()
    {
        var windows = TimeZoneInfo.CreateCustomTimeZone(
            "Pacific Standard Time",
            TimeSpan.FromHours(-8),
            "Pacific",
            "Pacific"
        );
        if (TimeZoneInfo.TryConvertWindowsIdToIanaId(windows.Id, out string? expected))
            Assert.AreEqual(expected, FacetTimeZone.IanaId(windows));
        else
            _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
                FacetTimeZone.IanaId(windows)
            );
    }
}
