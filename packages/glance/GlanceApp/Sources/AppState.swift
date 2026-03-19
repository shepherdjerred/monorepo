import Foundation
import Observation
import OSLog

private let logger = Logger(subsystem: "com.glance", category: "AppState")

// MARK: - AppState

/// Central app state managing service snapshots, polling, and health aggregation.
@MainActor @Observable
final class AppState {
    // MARK: Lifecycle

    // MARK: - Initialization

    init(
        providers: [any ServiceProvider],
        refreshInterval: Duration = .seconds(60),
    ) {
        self.providers = providers
        self.refreshInterval = refreshInterval
    }

    // MARK: Internal

    // MARK: - Published State

    private(set) var snapshots: [ServiceSnapshot] = []
    private(set) var overallHealth: ServiceStatus = .unknown
    private(set) var isRefreshing = false
    private(set) var lastRefresh: Date?
    var selectedServiceId: String?

    // MARK: - Computed

    /// SF Symbol name for the menu bar icon based on overall health.
    var menuBarIcon: String {
        self.overallHealth.iconName
    }

    /// Sorted list of all service IDs for sidebar display.
    var serviceIds: [String] {
        self.providers.map(\.id)
    }

    /// Look up a provider by ID.
    func provider(for serviceId: String) -> (any ServiceProvider)? {
        self.providers.first { $0.id == serviceId }
    }

    /// Look up a snapshot by service ID.
    func snapshot(for serviceId: String) -> ServiceSnapshot? {
        self.snapshots.first { $0.id == serviceId }
    }

    // MARK: - Polling

    /// Start the background polling loop.
    func startPolling() {
        let scheduler = PollingScheduler(interval: refreshInterval) { [weak self] in
            await self?.performRefresh()
        }
        self.scheduler = scheduler
        Task {
            await scheduler.start()
        }
    }

    /// Stop background polling.
    func stopPolling() {
        Task {
            await self.scheduler?.stop()
        }
    }

    /// Trigger an immediate refresh of all services.
    func refreshNow() async {
        await self.performRefresh()
    }

    // MARK: Private

    private let providers: [any ServiceProvider]
    private var scheduler: PollingScheduler?
    private let refreshInterval: Duration

    private nonisolated static func fetchWithTimeout(
        provider: any ServiceProvider,
        seconds: Int,
    ) async -> ServiceSnapshot {
        do {
            return try await withThrowingTaskGroup(of: ServiceSnapshot.self) { group in
                group.addTask {
                    await provider.fetchStatus()
                }
                group.addTask {
                    try await Task.sleep(for: .seconds(seconds))
                    throw CancellationError()
                }
                let result = try await group.next()!
                group.cancelAll()
                return result
            }
        } catch {
            return ServiceSnapshot(
                id: provider.id,
                displayName: provider.displayName,
                iconName: provider.iconName,
                status: .unknown,
                summary: "Timed out",
                detail: .empty,
                error: "Request timed out after \(seconds)s",
                timestamp: .now,
            )
        }
    }

    private func performRefresh() async {
        glanceLog("[Glance] Starting refresh of \(self.providers.count) providers")
        self.isRefreshing = true
        defer { isRefreshing = false }

        let results = await withTaskGroup(
            of: ServiceSnapshot.self,
            returning: [ServiceSnapshot].self,
        ) { group in
            for provider in self.providers {
                group.addTask {
                    glanceLog("[Glance] Fetching \(provider.id)...")
                    let snapshot = await Self.fetchWithTimeout(provider: provider, seconds: 25)
                    glanceLog("[Glance] \(provider.id): \(snapshot.status.label) - \(snapshot.summary)")
                    if let error = snapshot.error {
                        glanceLog("[Glance] \(provider.id) ERROR: \(error)")
                    }
                    return snapshot
                }
            }
            var collected: [ServiceSnapshot] = []
            for await snapshot in group {
                collected.append(snapshot)
            }
            return collected
        }

        self.snapshots = results.sorted { $0.displayName < $1.displayName }
        self.overallHealth = self.snapshots.map(\.status).max() ?? .unknown
        self.lastRefresh = .now
        glanceLog("[Glance] Refresh complete: \(self.snapshots.count) services, overall: \(self.overallHealth.label)")
    }
}
