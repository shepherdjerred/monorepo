using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    /// <summary>Owns saved-view metadata, ordering, validation, defaults, and persistence.</summary>
    internal sealed class SavedViewCatalog(SavedViewStorage storage)
    {
        private readonly SavedViewStorage _storage =
            storage ?? throw new ArgumentNullException(nameof(storage));
        private readonly List<SavedViewDefinition> _views = [];

        internal IReadOnlyList<SavedViewDefinition> Presentation =>
            [.. _views.OrderByDescending(view => view.IsFavorite).ThenBy(view => view.Order)];

        internal void LoadOrCreateDefaults()
        {
            _views.Clear();
            // An empty catalog is a state the user can reach by deleting every view, so
            // only an absent file means "never initialized". Treating the two alike
            // resurrected both defaults on the next start.
            IReadOnlyList<SavedViewDefinition>? stored = _storage.Load();
            if (stored is null)
            {
                _views.AddRange(TaskProjectionService.DefaultSavedViews());
                Save();
                return;
            }

            _views.AddRange(stored);
        }

        internal SavedViewDefinition Create(
            string name,
            string symbol,
            string tint,
            bool favorite,
            TaskListQuery query
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            ArgumentNullException.ThrowIfNull(query);
            SavedViewDefinition created = new()
            {
                Id = $"view-{Guid.NewGuid():N}",
                Name = name.Trim(),
                Symbol = symbol.Trim(),
                Tint = tint.Trim(),
                IsFavorite = favorite,
                Order = _views.Count,
                FilterJson = Core.TaskNotesCoreMethods.FilterChainToJson(
                    TaskProjectionService.BuildFilterChain(query)
                ),
                SortJson = TaskProjectionService.BuildSort(query) is Core.SortConfig sort
                    ? Core.TaskNotesCoreMethods.SortConfigToJson(sort)
                    : null,
                Group = query.Group,
            };
            _views.Add(created);
            Save();
            return created;
        }

        internal void Update(SavedViewDefinition view)
        {
            ArgumentNullException.ThrowIfNull(view);
            int index = _views.FindIndex(item =>
                string.Equals(item.Id, view.Id, StringComparison.Ordinal)
            );
            if (index < 0)
            {
                throw new Core.CoreException.NotFound($"saved view not found: {view.Id}");
            }
            _views[index] = view;
            Save();
        }

        internal SavedViewDefinition Duplicate(string viewId)
        {
            SavedViewDefinition source = Require(viewId);
            SavedViewDefinition duplicate = source with
            {
                Id = $"view-{Guid.NewGuid():N}",
                Name = $"{source.Name} Copy",
                Order = _views.Count,
            };
            _views.Add(duplicate);
            Save();
            return duplicate;
        }

        internal void Delete(string viewId)
        {
            _ = _views.Remove(Require(viewId));
            NormalizeOrder();
            Save();
        }

        internal void Move(string viewId, int index)
        {
            SavedViewDefinition existing = Require(viewId);
            _ = _views.Remove(existing);
            int bounded = Math.Clamp(index, 0, _views.Count);
            _views.Insert(bounded, existing);
            NormalizeOrder();
            Save();
        }

        internal void RestoreDefaults()
        {
            _views.Clear();
            _views.AddRange(TaskProjectionService.DefaultSavedViews());
            Save();
        }

        internal SavedViewDefinition Require(string viewId)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(viewId);
            return _views.SingleOrDefault(view =>
                    string.Equals(view.Id, viewId, StringComparison.Ordinal)
                ) ?? throw new Core.CoreException.NotFound($"saved view not found: {viewId}");
        }

        private void Save()
        {
            _storage.Save(_views);
        }

        private void NormalizeOrder()
        {
            for (int index = 0; index < _views.Count; index++)
            {
                _views[index] = _views[index] with { Order = index };
            }
        }
    }
}
