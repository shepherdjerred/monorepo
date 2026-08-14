using System.Globalization;
using System.Text;
using System.Text.Json;
using Core = uniffi.TaskNotesCore;
using CoreTask = uniffi.TaskNotesCore.Task;

namespace TaskNotes.Windows.Host
{
    internal sealed class FileHostStorage
        : Core.QueueStorage,
            Core.TaskCacheStorage,
            Core.MigrationStorage
    {
        private static readonly UTF8Encoding StrictUtf8 = new(false, true);

        public FileHostStorage(string directory)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(directory);
            Root = Path.GetFullPath(directory);
            Store("create the storage directory", () => Directory.CreateDirectory(Root));
        }

        internal string Root { get; }

        public string? ReadQueue()
        {
            return ReadText("queue.json");
        }

        public void WriteQueue(string data)
        {
            WriteText("queue.json", data);
        }

        public string? ReadDeadLetter()
        {
            return ReadText("dead-letter.json");
        }

        public void WriteDeadLetter(string data)
        {
            WriteText("dead-letter.json", data);
        }

        public CoreTask[] ReadTasks()
        {
            string? text = ReadText("tasks.json");
            if (text is null)
            {
                return [];
            }

            try
            {
                using JsonDocument document = JsonDocument.Parse(text);
                if (document.RootElement.ValueKind != JsonValueKind.Array)
                {
                    throw new Core.CoreException.Validation(
                        "the cached task list is not a JSON array"
                    );
                }

                List<CoreTask> tasks = new(document.RootElement.GetArrayLength());
                foreach (JsonElement element in document.RootElement.EnumerateArray())
                {
                    tasks.Add(Core.TaskNotesCoreMethods.TaskFromJson(element.GetRawText()));
                }

                return [.. tasks];
            }
            catch (Core.CoreException)
            {
                throw;
            }
            catch (JsonException exception)
            {
                throw new Core.CoreException.Validation(
                    $"the cached task list is not valid JSON: {exception.Message}"
                );
            }
        }

        public void WriteTasks(CoreTask[] tasks)
        {
            ArgumentNullException.ThrowIfNull(tasks);
            string json =
                $"[{string.Join(',', tasks.Select(Core.TaskNotesCoreMethods.TaskToJson))}]";
            WriteText("tasks.json", json);
        }

        public string? ReadIdAliases()
        {
            return ReadText("id-aliases.json");
        }

        public void WriteIdAliases(string data)
        {
            WriteText("id-aliases.json", data);
        }

        public string? ReadIdCounters()
        {
            return ReadText("id-counters.json");
        }

        public void WriteIdCounters(string data)
        {
            WriteText("id-counters.json", data);
        }

        public string? ReadCompletionRestores()
        {
            return ReadText("completion-restores.json");
        }

        public void WriteCompletionRestores(string data)
        {
            WriteText("completion-restores.json", data);
        }

        public long? ReadLastSyncTime()
        {
            string? text = ReadText("last-sync-time.json");
            return text is null ? null
                : !long.TryParse(
                    text.Trim(),
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out long millis
                )
                    ? throw new Core.CoreException.Validation(
                        $"the stored last-sync time is not an integer: {text}"
                    )
                : millis;
        }

        public void WriteLastSyncTime(long millis)
        {
            WriteText("last-sync-time.json", millis.ToString(CultureInfo.InvariantCulture));
        }

        internal string? ReadSavedViews()
        {
            return ReadText("saved-views.json");
        }

        internal void WriteSavedViews(string data)
        {
            WriteText("saved-views.json", data);
        }

        public uint ReadSchemaVersion()
        {
            string? text = ReadText("schema-version.json");
            return text is null ? 0
                : !uint.TryParse(
                    text.Trim(),
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out uint version
                )
                    ? throw new Core.CoreException.Validation(
                        $"the stored schema version is not an integer: {text}"
                    )
                : version;
        }

        public void WriteSchemaVersion(uint version)
        {
            WriteText("schema-version.json", version.ToString(CultureInfo.InvariantCulture));
        }

        public string? ReadLegacyQueue()
        {
            return ReadText("legacy-queue.json");
        }

        public void RemoveLegacyQueue()
        {
            string path = SlotPath("legacy-queue.json");
            if (!File.Exists(path))
            {
                return;
            }

            Store("remove legacy-queue.json", () => File.Delete(path));
        }

        private string? ReadText(string slot)
        {
            string path = SlotPath(slot);
            if (!File.Exists(path))
            {
                return null;
            }

            try
            {
                return StrictUtf8.GetString(File.ReadAllBytes(path));
            }
            catch (DecoderFallbackException exception)
            {
                throw new Core.CoreException.Validation(
                    $"{slot} is not valid UTF-8: {exception.Message}"
                );
            }
            catch (IOException exception)
            {
                throw StorageFailure($"read {slot}", exception);
            }
            catch (UnauthorizedAccessException exception)
            {
                throw StorageFailure($"read {slot}", exception);
            }
        }

        private void WriteText(string slot, string text)
        {
            ArgumentNullException.ThrowIfNull(text);
            string destination = SlotPath(slot);
            string temporary = $"{destination}.{Guid.NewGuid():N}.tmp";

            try
            {
                byte[] bytes = StrictUtf8.GetBytes(text);
                using (
                    FileStream stream = new(
                        temporary,
                        FileMode.CreateNew,
                        FileAccess.Write,
                        FileShare.None,
                        4096,
                        FileOptions.WriteThrough
                    )
                )
                {
                    stream.Write(bytes);
                    stream.Flush(true);
                }

                File.Move(temporary, destination, true);
            }
            catch (IOException exception)
            {
                PreserveCleanupFailure(temporary, exception);
                throw StorageFailure($"write {slot}", exception);
            }
            catch (UnauthorizedAccessException exception)
            {
                PreserveCleanupFailure(temporary, exception);
                throw StorageFailure($"write {slot}", exception);
            }
            catch (Exception exception)
            {
                PreserveCleanupFailure(temporary, exception);
                throw;
            }
        }

        private string SlotPath(string slot)
        {
            return Path.Combine(Root, slot);
        }

        private static Core.CoreException.Invariant StorageFailure(
            string operation,
            Exception exception
        )
        {
            return new($"could not {operation}: {exception.Message}");
        }

        private static void PreserveCleanupFailure(string temporary, Exception primaryFailure)
        {
            try
            {
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }
            catch (IOException cleanupFailure)
            {
                primaryFailure.Data["TemporaryCleanupFailure"] = cleanupFailure.GetType().FullName;
            }
            catch (UnauthorizedAccessException cleanupFailure)
            {
                primaryFailure.Data["TemporaryCleanupFailure"] = cleanupFailure.GetType().FullName;
            }
        }

        private static void Store(string operation, Action action)
        {
            try
            {
                action();
            }
            catch (IOException exception)
            {
                throw StorageFailure(operation, exception);
            }
            catch (UnauthorizedAccessException exception)
            {
                throw StorageFailure(operation, exception);
            }
        }
    }
}
