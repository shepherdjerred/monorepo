namespace TaskNotes.Windows.Host;

/// <summary>Uses the OS IANA identifier or its supported Windows-to-IANA conversion without substituting UTC.</summary>
internal static class FacetTimeZone
{
    internal static string IanaId(TimeZoneInfo zone) =>
        zone.HasIanaId || zone.Id == "UTC" ? zone.Id
        : TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out string? iana) ? iana
        : throw new InvalidOperationException("The local time zone has no IANA identifier.");
}
