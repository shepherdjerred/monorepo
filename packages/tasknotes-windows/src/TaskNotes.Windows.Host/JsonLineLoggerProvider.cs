using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace TaskNotes.Windows.Host
{
    /// <summary>Writes allow-listed local diagnostics without task or credential content.</summary>
    public sealed class JsonLineLoggerProvider : ILoggerProvider
    {
        private const long MaximumFileBytes = 25 * 1024 * 1024;
        private static readonly UTF8Encoding Utf8WithoutBom = new(false);
        private static readonly HashSet<string> AllowedProperties = new(StringComparer.Ordinal)
        {
            "CorrelationId",
            "DurationMs",
            "Operation",
            "Outcome",
            "StatusCode",
        };

        private readonly object _gate = new();
        private readonly string _directory;
        private bool _sinkFailed;

        /// <summary>Creates an allow-listed rotating JSONL diagnostics provider.</summary>
        public JsonLineLoggerProvider(string directory)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(directory);
            _directory = Path.GetFullPath(directory);
            Directory.CreateDirectory(_directory);
            DeleteExpiredLogs();
        }

        /// <inheritdoc />
        public ILogger CreateLogger(string categoryName)
        {
            return new JsonLineLogger(this, categoryName);
        }

        /// <inheritdoc />
        public void Dispose() { }

        private void Write<TState>(
            string category,
            LogLevel level,
            EventId eventId,
            TState state,
            Exception? exception
        )
        {
            Dictionary<string, object?> properties = new(StringComparer.Ordinal);
            string? template = null;
            if (state is IReadOnlyList<KeyValuePair<string, object?>> values)
            {
                foreach (KeyValuePair<string, object?> value in values)
                {
                    if (value.Key == "{OriginalFormat}")
                    {
                        template = value.Value is string text ? text : null;
                    }
                    else if (AllowedProperties.Contains(value.Key))
                    {
                        properties[value.Key] = SafeValue(value.Value);
                    }
                }
            }

            DiagnosticRecord record = new(
                DateTimeOffset.UtcNow,
                level.ToString(),
                category,
                eventId.Id,
                eventId.Name,
                template,
                exception?.GetType().FullName,
                new ReadOnlyDictionary<string, object?>(properties)
            );
            string line = JsonSerializer.Serialize(record);

            lock (_gate)
            {
                if (_sinkFailed)
                {
                    return;
                }

                try
                {
                    File.AppendAllText(CurrentLogPath(), string.Concat(line, "\n"), Utf8WithoutBom);
                }
                catch (Exception failure)
                    when (failure is IOException or UnauthorizedAccessException)
                {
                    // This provider is the app's only logging sink, so a full disk, a
                    // locked file, or a revoked ACL would otherwise throw out of an
                    // ordinary Log call and fail whatever operation emitted it. Those
                    // conditions persist, so stop writing rather than paying an
                    // exception per line for the rest of the process.
                    _sinkFailed = true;
                }
            }
        }

        private string CurrentLogPath()
        {
            string prefix = $"tasknotes-{DateTime.UtcNow:yyyyMMdd}";
            for (int sequence = 0; sequence < 1000; sequence++)
            {
                string path = Path.Combine(
                    _directory,
                    $"{prefix}-{sequence.ToString("D2", CultureInfo.InvariantCulture)}.jsonl"
                );
                if (!File.Exists(path) || new FileInfo(path).Length < MaximumFileBytes)
                {
                    return path;
                }
            }
            throw new IOException("TaskNotes diagnostics exhausted the daily log-file sequence.");
        }

        private void DeleteExpiredLogs()
        {
            DateTime cutoff = DateTime.UtcNow.AddDays(-7);
            foreach (
                string file in Directory.EnumerateFiles(
                    _directory,
                    "tasknotes-*.jsonl",
                    SearchOption.TopDirectoryOnly
                )
            )
            {
                if (File.GetLastWriteTimeUtc(file) < cutoff)
                {
                    try
                    {
                        File.Delete(file);
                    }
                    catch (Exception failure)
                        when (failure is IOException or UnauthorizedAccessException)
                    {
                        // One stale log another process still holds must not stop the
                        // app from starting; the next run retries the deletion.
                        continue;
                    }
                }
            }
        }

        private static object? SafeValue(object? value)
        {
            return value switch
            {
                null => null,
                string text => text,
                bool flag => flag,
                byte number => number,
                short number => number,
                int number => number,
                long number => number,
                ushort number => number,
                uint number => number,
                ulong number => number,
                float number => number,
                double number => number,
                decimal number => number,
                Guid identifier => identifier,
                _ => value.GetType().FullName,
            };
        }

        private sealed class JsonLineLogger(JsonLineLoggerProvider provider, string category)
            : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull
            {
                _ = state;
                return NullScope.Instance;
            }

            public bool IsEnabled(LogLevel logLevel)
            {
                return logLevel >= LogLevel.Debug;
            }

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter
            )
            {
                ArgumentNullException.ThrowIfNull(formatter);
                if (IsEnabled(logLevel))
                {
                    provider.Write(category, logLevel, eventId, state, exception);
                }
            }
        }

        private sealed class NullScope : IDisposable
        {
            internal static NullScope Instance { get; } = new();

            public void Dispose() { }
        }

        private sealed record DiagnosticRecord(
            DateTimeOffset Timestamp,
            string Level,
            string Category,
            int EventId,
            string? EventName,
            string? Template,
            string? ExceptionType,
            IReadOnlyDictionary<string, object?> Properties
        );
    }
}
