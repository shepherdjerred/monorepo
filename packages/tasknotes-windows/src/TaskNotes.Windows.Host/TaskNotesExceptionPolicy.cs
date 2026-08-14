using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    /// <summary>Classifies failures that may be shown at a native UI boundary.</summary>
    public static class TaskNotesExceptionPolicy
    {
        /// <summary>Returns a user-facing message for an expected boundary failure.</summary>
        public static string? UserFacingMessage(Exception exception)
        {
            ArgumentNullException.ThrowIfNull(exception);
            return exception switch
            {
                Core.CoreException.Invariant invariant => invariant.message,
                Core.CoreException.Network network => network.message,
                Core.CoreException.Api api => $"{api.message} (HTTP {api.status})",
                Core.CoreException.Validation validation => validation.message,
                Core.CoreException.NotFound notFound => notFound.message,
                Core.CoreException.Connection connection => connection.message,
                ArgumentException => exception.Message,
                InvalidDataException => exception.Message,
                OperationCanceledException => "The operation was cancelled.",
                _ => null,
            };
        }
    }
}
