namespace TaskNotes.Windows.Host;

/// <summary>Raised when the sync server rejects the configured Bearer token (HTTP 401/403).</summary>
public sealed class FacetAuthenticationException : Exception
{
    /// <summary>Initializes an authentication failure with HTTP status code.</summary>
    public FacetAuthenticationException(string message, ushort statusCode = 401)
        : base(message)
    {
        StatusCode = statusCode;
    }

    /// <summary>Initializes an authentication failure with an inner cause.</summary>
    public FacetAuthenticationException(
        string message,
        Exception innerException,
        ushort statusCode = 401
    )
        : base(message, innerException)
    {
        StatusCode = statusCode;
    }

    /// <summary>Gets the HTTP status code returned by the server.</summary>
    public ushort StatusCode { get; }
}

/// <summary>Raised when the sync server cannot be reached due to connectivity or timeout.</summary>
public sealed class FacetNetworkException : Exception
{
    /// <summary>Initializes a network connectivity failure.</summary>
    public FacetNetworkException(string message)
        : base(message) { }

    /// <summary>Initializes a network connectivity failure with its underlying transport error.</summary>
    public FacetNetworkException(string message, Exception innerException)
        : base(message, innerException) { }
}

/// <summary>Raised when the sync server returns an unexpected HTTP error or malformed payload.</summary>
public sealed class FacetApiException : Exception
{
    /// <summary>Initializes an API failure with HTTP status code.</summary>
    public FacetApiException(string message, ushort statusCode)
        : base(message)
    {
        StatusCode = statusCode;
    }

    /// <summary>Initializes an API failure with an inner cause.</summary>
    public FacetApiException(string message, ushort statusCode, Exception innerException)
        : base(message, innerException)
    {
        StatusCode = statusCode;
    }

    /// <summary>Gets the HTTP status code returned by the server.</summary>
    public ushort StatusCode { get; }
}

/// <summary>Raised when user input or domain rules fail local validation.</summary>
public sealed class FacetValidationException : Exception
{
    /// <summary>Initializes a validation failure with a user-actionable explanation.</summary>
    public FacetValidationException(string message)
        : base(message) { }

    /// <summary>Initializes a validation failure with an inner cause.</summary>
    public FacetValidationException(string message, Exception innerException)
        : base(message, innerException) { }
}

/// <summary>Classifies failures that may be shown at a native UI boundary.</summary>
public static class TaskNotesExceptionPolicy
{
    /// <summary>Background activation handles only external auth/network/IO failures; corrupt contracts propagate.</summary>
    public static string? BackgroundMessage(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return exception switch
        {
            FacetAuthenticationException =>
                "Update your Facet server token in Settings to resume background sync.",
            FacetNetworkException => "Facet server is offline; cached tasks remain available.",
            FacetApiException api => $"{api.Message} (HTTP {api.StatusCode})",
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
            FacetValidationException validation => validation.Message,
            FacetAuthenticationException auth => auth.Message,
            FacetNetworkException network => network.Message,
            FacetApiException api => $"{api.Message} (HTTP {api.StatusCode})",
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
