namespace TaskNotes.Windows.Host;

/// <summary>The edit was saved, but refreshing its authoritative task projection failed.</summary>
/// <remarks>Consumers retain the draft until a fresh projection is available.</remarks>
public sealed class FacetSavedObservationException : Exception
{
    /// <summary>Initializes an applied edit whose resulting projection is unavailable.</summary>
    public FacetSavedObservationException()
        : base("Saved. Refresh the vault to update the list.") { }

    /// <summary>Initializes an applied edit with an observation message.</summary>
    public FacetSavedObservationException(string message)
        : base(message) { }

    /// <summary>Initializes an applied edit with the expected observation failure.</summary>
    public FacetSavedObservationException(string message, Exception innerException)
        : base(message, innerException) { }
}
