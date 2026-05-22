import Foundation
@testable import GlanceApp

/// Configurable mock service provider for testing.
struct MockServiceProvider: ServiceProvider {
    // MARK: Lifecycle

    init(
        id: String = "mock",
        displayName: String = "Mock Service",
        iconName: String = "circle",
        webURL: String? = nil,
        status: ServiceStatus = .ok,
        summary: String = "All good",
        detail: ServiceDetail = .empty,
        error: String? = nil,
    ) {
        self.id = id
        self.displayName = displayName
        self.iconName = iconName
        self.webURL = webURL
        self.snapshot = ServiceSnapshot(
            id: id,
            displayName: displayName,
            iconName: iconName,
            status: status,
            summary: summary,
            detail: detail,
            error: error,
            timestamp: .now,
        )
    }

    // MARK: Internal

    let id: String
    let displayName: String
    let iconName: String
    let webURL: String?
    let snapshot: ServiceSnapshot

    func fetchStatus() async -> ServiceSnapshot {
        self.snapshot
    }
}
