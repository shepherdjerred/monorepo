// MARK: - ServiceProvider

/// A pluggable service monitor that fetches current status.
///
/// Implementations must never throw from `fetchStatus()`. On failure,
/// return a snapshot with `.unknown` status and a human-readable error.
protocol ServiceProvider: Sendable {
    /// Unique identifier for this service (e.g., "argocd").
    var id: String { get }

    /// Human-readable display name.
    var displayName: String { get }

    /// SF Symbol name for the service icon.
    var iconName: String { get }

    /// Base URL to open in browser for this service.
    var webURL: String? { get }

    /// Quick status -- runs every poll cycle. Must be fast (<5s).
    func fetchStatus() async -> ServiceSnapshot

    /// Deep fetch -- on demand when user views detail. Can be slower (30s timeout).
    func fetchDetail() async -> ServiceDetail
}

extension ServiceProvider {
    func fetchDetail() async -> ServiceDetail {
        .empty
    }
}
