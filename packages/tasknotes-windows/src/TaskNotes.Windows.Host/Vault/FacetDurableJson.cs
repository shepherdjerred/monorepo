using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Atomic app-private JSON with Windows write-through namespace commits; native power-loss acceptance is separate.</summary>
internal static class FacetDurableJson
{
    internal static void Write<T>(string path, T value)
    {
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (
                FileStream stream = new(
                    temporary,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    4096,
                    FileOptions.None
                )
            )
            {
                JsonSerializer.Serialize(stream, value);
                // Persist the complete image once, before the namespace commit.
                // Per-write WriteThrough would duplicate this explicit barrier.
                stream.Flush(true);
            }
            if (OperatingSystem.IsWindows())
                FacetWindowsFileCommit.Move(temporary, path, replace: true);
            else
                File.Move(temporary, path, true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }
}
