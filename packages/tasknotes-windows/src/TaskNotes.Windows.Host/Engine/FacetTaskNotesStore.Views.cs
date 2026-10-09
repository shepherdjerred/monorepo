using System.Text.Json;

namespace TaskNotes.Windows.Host;

public sealed partial class FacetTaskNotesStore
{
    /// <summary>Freeze a named view's query, identity and owner before waiting for the serialized host.</summary>
    public Task<SavedViewDefinition> CreateOwnedSavedViewAsync(
        string profile,
        string viewId,
        string name,
        string symbol,
        string tint,
        bool favorite,
        TaskListQuery query,
        Action<string> actionAdmitted,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(profile);
        ArgumentException.ThrowIfNullOrWhiteSpace(viewId);
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(actionAdmitted);
        JsonElement frozen = JsonSerializer.SerializeToElement(
            new
            {
                kind = "save_view",
                id = viewId,
                view = new
                {
                    schemaVersion = 1,
                    name,
                    symbol,
                    tint,
                    favorite,
                    order = State.SavedViews.Count,
                    query = QueryDocument(query, 0),
                },
            }
        );
        return SerializedAsync(
            async () =>
            {
                if (SelectedProfileId != profile)
                    throw new ArgumentException(
                        "Return to the view's original vault before saving it."
                    );
                await MutateAsync(
                        frozen,
                        false,
                        cancellationToken,
                        requestKey: "save-view:" + viewId,
                        actionAdmitted: actionAdmitted
                    )
                    .ConfigureAwait(false);
                return State.SavedViews.SingleOrDefault(view => view.Id == viewId)
                    ?? throw new FacetSavedObservationException();
            },
            cancellationToken
        );
    }
}
