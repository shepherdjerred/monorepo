using System.Text.Json;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    internal sealed class SavedViewStorage(FileHostStorage storage)
    {
        private static readonly JsonSerializerOptions SerializerOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        };

        private readonly FileHostStorage _storage = storage;

        public IReadOnlyList<SavedViewDefinition> Load()
        {
            string? json = _storage.ReadSavedViews();
            if (json is null)
            {
                return [];
            }

            try
            {
                SavedViewDefinition[]? views =
                    JsonSerializer.Deserialize<SavedViewDefinition[]>(json, SerializerOptions)
                    ?? throw new Core.CoreException.Validation(
                        "saved-views.json must contain an array"
                    );
                Validate(views);
                return
                [
                    .. views
                        .OrderBy(view => view.Order)
                        .ThenBy(view => view.Id, StringComparer.Ordinal),
                ];
            }
            catch (Core.CoreException)
            {
                throw;
            }
            catch (JsonException exception)
            {
                throw new Core.CoreException.Validation(
                    $"saved-views.json is not valid: {exception.Message}"
                );
            }
        }

        public void Save(IReadOnlyList<SavedViewDefinition> views)
        {
            ArgumentNullException.ThrowIfNull(views);
            Validate(views);
            _storage.WriteSavedViews(JsonSerializer.Serialize(views, SerializerOptions));
        }

        private static void Validate(IReadOnlyList<SavedViewDefinition> views)
        {
            HashSet<string> ids = new(StringComparer.Ordinal);
            foreach (SavedViewDefinition view in views)
            {
                if (string.IsNullOrWhiteSpace(view.Id) || !ids.Add(view.Id))
                {
                    throw new Core.CoreException.Validation(
                        "saved view identifiers must be non-empty and unique"
                    );
                }

                if (string.IsNullOrWhiteSpace(view.Name))
                {
                    throw new Core.CoreException.Validation($"saved view '{view.Id}' has no name");
                }

                _ = Core.TaskNotesCoreMethods.FilterChainFromJson(view.FilterJson);
                if (view.SortJson is not null)
                {
                    _ = Core.TaskNotesCoreMethods.SortConfigFromJson(view.SortJson);
                }
            }
        }
    }
}
