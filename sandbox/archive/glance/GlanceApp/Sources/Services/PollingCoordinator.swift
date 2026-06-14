import Foundation
import OSLog

// MARK: - PollingTier

/// Polling frequency tier for providers.
enum PollingTier {
    /// Real-time infrastructure (30s).
    case fast
    /// Standard services (60s).
    case normal
    /// Billing/usage APIs (5min).
    case slow

    // MARK: Internal

    var interval: Duration {
        switch self {
        case .fast:
            .seconds(30)
        case .normal:
            .seconds(60)
        case .slow:
            .seconds(300)
        }
    }
}

// MARK: - PollingCoordinator

/// Coordinates polling of all service providers off the main actor.
///
/// Owns the providers array and polling scheduler, executes fetches in task groups,
/// and delivers results back to AppState via a callback closure.
actor PollingCoordinator {
    // MARK: Lifecycle

    init(
        providers: [any ServiceProvider],
        metricsCollector: MetricsCollector = MetricsCollector(),
        onResults: @escaping @MainActor @Sendable ([ServiceSnapshot]) -> Void,
    ) {
        self.providers = providers
        self.metricsCollector = metricsCollector
        self.onResults = onResults
        for provider in providers {
            self.consecutiveFailures[provider.id] = 0
        }
    }

    // MARK: Internal

    /// The metrics collector for observability.
    let metricsCollector: MetricsCollector

    /// All provider IDs in order.
    var providerIds: [String] {
        self.providers.map(\.id)
    }

    /// Start the background polling loop.
    func startPolling() {
        guard self.scheduler == nil else {
            return
        }
        let scheduler = PollingScheduler(interval: .seconds(30)) { [weak self] in
            await self?.tick()
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
        self.scheduler = nil
    }

    /// Pause polling (e.g., when network is unavailable).
    func pausePolling() {
        self.isPaused = true
        GlanceLogger.polling.info("Polling paused")
    }

    /// Resume polling and trigger an immediate refresh.
    func resumePolling() {
        self.isPaused = false
        GlanceLogger.polling.info("Polling resumed")
        Task {
            await self.performRefresh()
        }
    }

    /// Trigger an immediate refresh of all providers.
    func refreshNow() async {
        await self.performRefresh()
    }

    /// Fetch detail data for a specific provider on demand.
    func fetchDetail(for providerId: String) async -> ServiceDetail {
        guard let provider = self.providers.first(where: { $0.id == providerId }) else {
            return .empty
        }
        do {
            return try await withThrowingTaskGroup(of: ServiceDetail.self) { group in
                group.addTask {
                    await provider.fetchDetail()
                }
                group.addTask {
                    try await Task.sleep(for: .seconds(30))
                    throw CancellationError()
                }
                // swiftlint:disable:next force_unwrapping
                let result = try await group.next()!
                group.cancelAll()
                return result
            }
        } catch {
            GlanceLogger.provider(providerId).error("Detail fetch timed out")
            return .empty
        }
    }

    /// Look up a provider by ID.
    func provider(for serviceId: String) -> (any ServiceProvider)? {
        self.providers.first { $0.id == serviceId }
    }

    // MARK: Private

    private let providers: [any ServiceProvider]
    private let onResults: @MainActor @Sendable ([ServiceSnapshot]) -> Void
    private var scheduler: PollingScheduler?
    private var isPaused = false
    private var tickCount: UInt64 = 0
    private var consecutiveFailures: [String: Int] = [:]
    private var consecutiveAuthFailures: [String: Int] = [:]

    /// Maximum consecutive failures before backing off to slow tier.
    private let circuitBreakerThreshold = 5

    /// Maximum consecutive auth failures before logging a rotation warning.
    private let authFailureThreshold = 3

    /// Fetch a single provider's status with a timeout.
    private static func fetchWithTimeout(
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
                // swiftlint:disable:next force_unwrapping
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

    /// Determine the polling tier for a provider based on its ID.
    private func tier(for providerId: String) -> PollingTier {
        switch providerId {
        case "alertmanager",
             "kubernetes",
             "prometheus":
            .fast
        case "anthropic-api",
             "claude-code",
             "codex",
             "openai-api":
            .slow
        default:
            .normal
        }
    }

    /// Whether a provider should be polled on this tick.
    private func shouldPoll(providerId: String) -> Bool {
        let failures = self.consecutiveFailures[providerId, default: 0]
        let effectiveTier: PollingTier = if failures >= self.circuitBreakerThreshold {
            .slow
        } else {
            self.tier(for: providerId)
        }

        // Base tick runs every 30s (fast tier interval).
        // Normal tier runs every 2nd tick (60s), slow every 10th tick (300s).
        switch effectiveTier {
        case .fast:
            return true
        case .normal:
            return self.tickCount.isMultiple(of: 2)
        case .slow:
            return self.tickCount.isMultiple(of: 10)
        }
    }

    /// Check if a snapshot's error indicates an authentication/authorization failure.
    private func isAuthFailure(snapshot: ServiceSnapshot) -> Bool {
        guard let error = snapshot.error?.lowercased() else {
            return false
        }
        return error.contains("401") || error.contains("403")
            || error.contains("unauthorized") || error.contains("forbidden")
    }

    /// Update circuit breaker and auth failure counters for a single snapshot.
    private func updateFailureTracking(for snapshot: ServiceSnapshot) {
        guard snapshot.status == .unknown, snapshot.error != nil else {
            self.consecutiveFailures[snapshot.id] = 0
            self.consecutiveAuthFailures[snapshot.id] = 0
            return
        }
        self.consecutiveFailures[snapshot.id, default: 0] += 1
        let failures = self.consecutiveFailures[snapshot.id, default: 0]
        if failures == self.circuitBreakerThreshold {
            GlanceLogger.provider(snapshot.id).warning(
                "Circuit breaker tripped after \(failures) consecutive failures",
            )
        }
        if self.isAuthFailure(snapshot: snapshot) {
            self.consecutiveAuthFailures[snapshot.id, default: 0] += 1
            let authFailures = self.consecutiveAuthFailures[snapshot.id, default: 0]
            if authFailures == self.authFailureThreshold {
                GlanceLogger.provider(snapshot.id).error(
                    "Repeated auth failures — secret may need rotation",
                )
            }
        } else {
            self.consecutiveAuthFailures[snapshot.id] = 0
        }
    }

    /// Called by the scheduler on each tick.
    private func tick() async {
        guard !self.isPaused else {
            return
        }
        await self.performRefresh()
        self.tickCount += 1
    }

    /// Run a full refresh cycle for eligible providers.
    private func performRefresh() async {
        let signposter = GlanceLogger.signposter
        let pollState = signposter.beginInterval("pollCycle", id: signposter.makeSignpostID())
        let cycleStart = ContinuousClock.now

        let eligibleProviders = self.providers.filter { self.shouldPoll(providerId: $0.id) }
        GlanceLogger.polling.info(
            "Starting refresh of \(eligibleProviders.count)/\(self.providers.count) providers",
        )

        let results = await self.fetchAllProviders(eligibleProviders)

        for snapshot in results {
            self.updateFailureTracking(for: snapshot)
        }

        let cycleDuration = cycleStart.duration(to: .now)
        let cycleSeconds = Double(cycleDuration.components.seconds)
            + Double(cycleDuration.components.attoseconds) / 1e18
        await self.metricsCollector.recordCycle(duration: cycleSeconds)

        signposter.endInterval("pollCycle", pollState)

        let sortedResults = results.sorted { $0.displayName < $1.displayName }
        await self.onResults(sortedResults)
    }

    /// Fetch status from all eligible providers concurrently with metrics recording.
    private func fetchAllProviders(
        _ providers: [any ServiceProvider],
    ) async -> [ServiceSnapshot] {
        let collector = self.metricsCollector
        return await withTaskGroup(
            of: ServiceSnapshot.self,
            returning: [ServiceSnapshot].self,
        ) { group in
            for provider in providers {
                group.addTask {
                    let start = ContinuousClock.now
                    let snapshot = await Self.fetchWithTimeout(provider: provider, seconds: 25)
                    let duration = start.duration(to: .now)
                    let seconds = Double(duration.components.seconds)
                        + Double(duration.components.attoseconds) / 1e18
                    let isSuccess = snapshot.error == nil
                    await collector.recordFetch(
                        providerId: provider.id,
                        duration: seconds,
                        success: isSuccess,
                        error: snapshot.error,
                        status: snapshot.status,
                    )
                    return snapshot
                }
            }
            var collected: [ServiceSnapshot] = []
            for await snapshot in group {
                collected.append(snapshot)
            }
            return collected
        }
    }
}
