import SwiftUI

// MARK: - ServiceStatus

/// Health status of a monitored service, ordered by severity.
enum ServiceStatus: Comparable, CaseIterable {
    case ok
    case warning
    case error
    case unknown
}

extension ServiceStatus {
    /// SF Symbol name representing this status.
    var iconName: String {
        switch self {
        case .ok:
            "checkmark.circle.fill"
        case .warning:
            "exclamationmark.triangle.fill"
        case .error:
            "xmark.circle.fill"
        case .unknown:
            "questionmark.circle"
        }
    }

    /// Display color for this status.
    var color: Color {
        switch self {
        case .ok:
            .green
        case .warning:
            .yellow
        case .error:
            .red
        case .unknown:
            .secondary
        }
    }

    /// Short human-readable label.
    var label: String {
        switch self {
        case .ok:
            "OK"
        case .warning:
            "Warning"
        case .error:
            "Error"
        case .unknown:
            "Unknown"
        }
    }
}
