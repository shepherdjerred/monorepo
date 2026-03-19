import Foundation

/// Errors that can occur throughout the Tips app.
enum TipsError: Error, CustomStringConvertible {
    /// Content directory could not be found at any searched path.
    case contentDirectoryNotFound(searched: [URL])

    /// A single tip file failed to parse (non-fatal during batch loading).
    case tipFileParseError(file: URL, underlying: any Error)

    /// Failed to load persisted review state from disk.
    case persistenceLoadFailed(url: URL, underlying: any Error)

    /// Failed to save review state to disk.
    case persistenceSaveFailed(url: URL, underlying: any Error)

    /// Failed to encode review state (programming error).
    case persistenceEncodeFailed(underlying: any Error)

    /// Notification scheduling failed.
    case notificationSchedulingFailed(underlying: any Error)

    /// Login item registration/unregistration failed.
    case loginItemFailed(action: String, underlying: any Error)

    // MARK: Internal

    var description: String {
        switch self {
        case let .contentDirectoryNotFound(searched):
            "Content directory not found. Searched: \(searched.map(\.path).joined(separator: ", "))"
        case let .tipFileParseError(file, underlying):
            "Failed to parse tip file \(file.lastPathComponent): \(underlying)"
        case let .persistenceLoadFailed(url, underlying):
            "Failed to load state from \(url.path): \(underlying)"
        case let .persistenceSaveFailed(url, underlying):
            "Failed to save state to \(url.path): \(underlying)"
        case let .persistenceEncodeFailed(underlying):
            "Failed to encode state: \(underlying)"
        case let .notificationSchedulingFailed(underlying):
            "Failed to schedule notification: \(underlying)"
        case let .loginItemFailed(action, underlying):
            "Failed to \(action) login item: \(underlying)"
        }
    }
}
