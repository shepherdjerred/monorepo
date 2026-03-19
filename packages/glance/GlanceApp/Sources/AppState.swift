import AppKit
import Dispatch
import Foundation
import Observation
import OSLog

// MARK: - AppState

/// Thin UI coordinator holding only view state.
///
/// All fetch/polling logic lives in `PollingCoordinator`.
/// AppState receives snapshots via `receiveSnapshots(_:)` and exposes
/// them to SwiftUI views.
@MainActor @Observable
final class AppState {
    // MARK: Lifecycle

    // MARK: - Initialization

    init(
        providers: [any ServiceProvider],
        refreshInterval _: Duration = .seconds(60),
        notificationManager: NotificationManager? = nil,
        settings: GlanceSettings? = nil,
        spotlightIndexer: SpotlightIndexer? = nil,
    ) {
        self.notificationManager = notificationManager
        self.settings = settings
        self.spotlightIndexer = spotlightIndexer
        // Placeholder coordinator -- immediately replaced after self is available.
        self.coordinator = PollingCoordinator(
            providers: providers,
            metricsCollector: self.metricsCollector,
            onResults: { _ in },
        )
        // Now that self is fully initialized, create the real coordinator
        // with a callback that delivers results back to this AppState.
        self.coordinator = PollingCoordinator(
            providers: providers,
            metricsCollector: self.metricsCollector,
            onResults: { [weak self] snapshots in
                self?.receiveSnapshots(snapshots)
            },
        )
        self.setupMemoryPressureHandler()
    }

    // MARK: Internal

    // MARK: - Published State

    private(set) var snapshots: [ServiceSnapshot] = []
    private(set) var overallHealth: ServiceStatus = .unknown
    private(set) var isRefreshing = false
    private(set) var lastRefresh: Date?
    var selectedServiceId: String?

    // MARK: - Coordinator Access

    private(set) var coordinator: PollingCoordinator

    /// The metrics collector shared with the polling coordinator.
    /// Stored directly so views can access it synchronously (actors are Sendable).
    let metricsCollector = MetricsCollector()

    /// Historical snapshot store for status history charts.
    /// Exposed so views can query history per provider.
    var snapshotStore: SnapshotStore?

    // MARK: - Computed

    /// SF Symbol name for the menu bar icon based on overall health.
    var menuBarIcon: String {
        self.overallHealth.iconName
    }

    /// Sorted list of all service IDs for sidebar display.
    var serviceIds: [String] {
        get async {
            await self.coordinator.providerIds
        }
    }

    /// Look up a provider by ID.
    func provider(for serviceId: String) async -> (any ServiceProvider)? {
        await self.coordinator.provider(for: serviceId)
    }

    /// Look up a snapshot by service ID.
    func snapshot(for serviceId: String) -> ServiceSnapshot? {
        self.snapshots.first { $0.id == serviceId }
    }

    // MARK: - Polling

    /// Start the background polling loop.
    func startPolling() {
        Task {
            await self.coordinator.startPolling()
        }
    }

    /// Stop background polling.
    func stopPolling() {
        Task {
            await self.coordinator.stopPolling()
        }
    }

    /// Trigger an immediate refresh of all services.
    func refreshNow() async {
        self.isRefreshing = true
        await self.coordinator.refreshNow()
        self.isRefreshing = false
    }

    /// Fetch detail data for a specific provider on demand.
    func fetchDetail(for providerId: String) async -> ServiceDetail {
        await self.coordinator.fetchDetail(for: providerId)
    }

    // MARK: Private

    private let notificationManager: NotificationManager?
    private let settings: GlanceSettings?
    private let spotlightIndexer: SpotlightIndexer?
    private var memoryPressureSource: (any DispatchSourceMemoryPressure)?

    /// Set up a dispatch source to monitor system memory pressure.
    private func setupMemoryPressureHandler() {
        let source = DispatchSource.makeMemoryPressureSource(
            eventMask: .all,
            queue: .main,
        )
        source.setEventHandler { [weak self] in
            guard self != nil else {
                return
            }
            let event = source.data
            if event.contains(.critical) {
                GlanceLogger.diagnostics.warning(
                    "Critical memory pressure — pruning snapshot history to last 24 hours",
                )
                if let store = self?.snapshotStore {
                    Task {
                        try? await store.prune(olderThan: 86400)
                    }
                }
            } else if event.contains(.warning) {
                GlanceLogger.diagnostics.info("Memory pressure warning received")
            }
        }
        source.resume()
        self.memoryPressureSource = source
    }

    /// Receive snapshots from the polling coordinator.
    private func receiveSnapshots(_ newSnapshots: [ServiceSnapshot]) {
        // Process notifications before updating state so the manager can
        // compare old vs new statuses.
        self.notificationManager?.processSnapshots(
            newSnapshots,
            notificationsEnabled: self.settings?.notificationsEnabled ?? true,
        )

        // Merge new snapshots into existing: update matching providers, keep others.
        let oldHealth = self.overallHealth
        var merged = Dictionary(self.snapshots.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        for snapshot in newSnapshots {
            merged[snapshot.id] = snapshot
        }
        self.snapshots = merged.values.sorted { $0.displayName < $1.displayName }
        self.overallHealth = self.snapshots.map(\.status).max() ?? .unknown
        self.lastRefresh = .now

        // Announce health changes to VoiceOver users.
        if oldHealth != self.overallHealth {
            NSAccessibility.post(
                element: NSApp as Any,
                notification: .announcementRequested,
                userInfo: [
                    .announcement: "Glance status changed to \(self.overallHealth.label)",
                    .priority: NSAccessibilityPriorityLevel.high.rawValue,
                ],
            )
        }
        let health = self.overallHealth.label
        GlanceLogger.polling.info(
            "Received \(newSnapshots.count) snapshots, overall: \(health, privacy: .public)",
        )

        // Persist snapshots for history charts.
        if let store = self.snapshotStore {
            Task {
                try? await store.save(newSnapshots)
            }
        }

        // Update Spotlight index with latest statuses.
        self.spotlightIndexer?.updateIndex(with: newSnapshots)
    }
}
