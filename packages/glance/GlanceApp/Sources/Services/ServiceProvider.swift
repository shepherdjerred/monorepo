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

    /// Fetch the current status. Must not throw.
    func fetchStatus() async -> ServiceSnapshot
}
