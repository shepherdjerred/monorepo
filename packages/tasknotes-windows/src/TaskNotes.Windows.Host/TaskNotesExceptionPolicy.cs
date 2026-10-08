using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    /// <summary>Classifies failures that may be shown at a native UI boundary.</summary>
    public static class TaskNotesExceptionPolicy
    {
        /// <summary>Background activation handles only external authorization/provider failures; corrupt contracts and SQLite failures propagate.</summary>
        public static string? BackgroundMessage(Exception exception)
        {
            ArgumentNullException.ThrowIfNull(exception);
            return exception switch
            {
                FacetAuthorizationRequiredException => "Authorize this vault again in Facet.",
                Core.FacetEngineException.Host =>
                    "The vault provider is unavailable. Open Facet to restore access.",
                Core.FacetHostException.Io =>
                    "The vault filesystem operation failed. Open Facet to review storage access.",
                Core.FacetHostException.PermissionDenied =>
                    "Restore access to the vault folder in Facet.",
                Core.FacetHostException.Unavailable => "The vault provider is unavailable.",
                UnauthorizedAccessException =>
                    "Background storage access was denied. Open Facet to review permissions.",
                IOException =>
                    "Background storage could not be updated. Open Facet to review space and access.",
                _ => null,
            };
        }

        /// <summary>Returns a user-facing message for an expected boundary failure.</summary>
        public static string? UserFacingMessage(Exception exception)
        {
            ArgumentNullException.ThrowIfNull(exception);
            return exception switch
            {
                Core.CoreException.Invariant invariant => invariant.detail,
                Core.CoreException.Network network => network.detail,
                Core.CoreException.Api api => $"{api.detail} (HTTP {api.status})",
                Core.CoreException.Validation validation => validation.detail,
                Core.CoreException.NotFound notFound => notFound.detail,
                Core.CoreException.Connection connection => connection.detail,
                Core.FacetEngineException.Storage storage => storage.detail,
                Core.FacetEngineException.Host host => host.detail,
                Core.FacetEngineException.Validation validation => validation.detail,
                Core.FacetEngineException.Configuration configuration => configuration.detail,
                Core.FacetEngineException.Conflict =>
                    "The file changed. Reload it or resolve the preserved conflict.",
                Core.FacetEngineException.NotFound =>
                    "The selected profile or file no longer exists.",
                Core.FacetHostException.Io => "The vault filesystem operation failed.",
                Core.FacetHostException.PermissionDenied =>
                    "Select the vault folder again to restore access.",
                Core.FacetHostException.Unavailable => "The vault provider is unavailable.",
                Core.ObsidianBoundaryException.Boundary boundary => boundary.detail,
                FacetAuthorizationRequiredException authorization => authorization.Message,
                UnauthorizedAccessException =>
                    "Local storage access was denied. Restore access before trying again.",
                IOException =>
                    "Local storage could not be updated. Check available space and access before trying again.",
                ArgumentException => exception.Message,
                InvalidDataException => exception.Message,
                OperationCanceledException => "The operation was cancelled.",
                _ => null,
            };
        }
    }
}
