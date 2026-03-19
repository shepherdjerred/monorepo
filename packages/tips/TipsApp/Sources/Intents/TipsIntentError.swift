import Foundation

enum TipsIntentError: Error, LocalizedError {
    case appNotRunning
    case noTipsAvailable

    // MARK: Internal

    var errorDescription: String? {
        switch self {
        case .appNotRunning:
            "Tips app is not running. Please launch it first."
        case .noTipsAvailable:
            "No tips are currently available."
        }
    }
}
