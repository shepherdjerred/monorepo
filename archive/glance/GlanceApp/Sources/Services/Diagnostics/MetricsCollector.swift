import Darwin
import Foundation

// MARK: - ProviderMetrics

/// Aggregated metrics for a single service provider.
struct ProviderMetrics {
    let fetchCount: Int
    let successCount: Int
    let errorCount: Int
    let averageDuration: TimeInterval
    let p50Duration: TimeInterval
    let p95Duration: TimeInterval
    let maxDuration: TimeInterval
    let lastError: String?
    let lastErrorTime: Date?
    let consecutiveFailures: Int
    let statusHistory: [(status: ServiceStatus, timestamp: Date)]
}

// MARK: - OverallMetrics

/// Aggregated metrics across all providers.
struct OverallMetrics {
    let lastCycleTime: TimeInterval
    let totalCycles: Int
    let providerCount: Int
    let memoryFootprintBytes: UInt64
}

// MARK: - MetricsCollector

/// Collects per-provider and overall metrics for observability and debugging.
actor MetricsCollector {
    // MARK: Internal

    /// Record the result of a provider fetch.
    func recordFetch(
        providerId: String,
        duration: TimeInterval,
        success: Bool,
        error: String?,
        status: ServiceStatus?,
    ) {
        var entry = self.entries[providerId, default: ProviderEntry()]
        entry.fetchCount += 1
        if success {
            entry.successCount += 1
            entry.consecutiveFailures = 0
        } else {
            entry.errorCount += 1
            entry.consecutiveFailures += 1
            entry.lastError = error
            entry.lastErrorTime = .now
        }

        // Keep last 100 durations.
        entry.fetchDurations.append(duration)
        if entry.fetchDurations.count > 100 {
            entry.fetchDurations.removeFirst(entry.fetchDurations.count - 100)
        }

        // Track status transitions (last 50).
        if let status {
            let lastStatus = entry.statusHistory.last?.status
            if lastStatus != status {
                entry.statusHistory.append((status: status, timestamp: .now))
                if entry.statusHistory.count > 50 {
                    entry.statusHistory.removeFirst(entry.statusHistory.count - 50)
                }
            }
        }

        self.entries[providerId] = entry
    }

    /// Record the completion of a full poll cycle.
    func recordCycle(duration: TimeInterval) {
        self.lastCycleTime = duration
        self.totalCycles += 1
    }

    /// Retrieve metrics for a specific provider.
    func metrics(for providerId: String) -> ProviderMetrics {
        let entry = self.entries[providerId, default: ProviderEntry()]
        let sorted = entry.fetchDurations.sorted()
        return ProviderMetrics(
            fetchCount: entry.fetchCount,
            successCount: entry.successCount,
            errorCount: entry.errorCount,
            averageDuration: Self.average(sorted),
            p50Duration: Self.percentile(sorted, pct: 0.50),
            p95Duration: Self.percentile(sorted, pct: 0.95),
            maxDuration: sorted.last ?? 0,
            lastError: entry.lastError,
            lastErrorTime: entry.lastErrorTime,
            consecutiveFailures: entry.consecutiveFailures,
            statusHistory: entry.statusHistory,
        )
    }

    /// Retrieve overall metrics across all providers.
    func overallMetrics() -> OverallMetrics {
        OverallMetrics(
            lastCycleTime: self.lastCycleTime,
            totalCycles: self.totalCycles,
            providerCount: self.entries.count,
            memoryFootprintBytes: Self.currentMemoryFootprint(),
        )
    }

    /// All provider IDs that have recorded metrics, sorted by ID.
    func allProviderIds() -> [String] {
        self.entries.keys.sorted()
    }

    // MARK: Private

    private var entries: [String: ProviderEntry] = [:]
    private var lastCycleTime: TimeInterval = 0
    private var totalCycles: Int = 0

    /// Compute the average of a sorted array of durations.
    private static func average(_ sorted: [TimeInterval]) -> TimeInterval {
        guard !sorted.isEmpty else {
            return 0
        }
        return sorted.reduce(0, +) / Double(sorted.count)
    }

    /// Compute a percentile value from a sorted array.
    private static func percentile(_ sorted: [TimeInterval], pct: Double) -> TimeInterval {
        guard !sorted.isEmpty else {
            return 0
        }
        let index = Int(Double(sorted.count - 1) * pct)
        return sorted[index]
    }

    /// Get the current app memory footprint using mach_task_basic_info.
    private static func currentMemoryFootprint() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) { infoPtr in
            infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rawPtr in
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), rawPtr, &count)
            }
        }
        if result == KERN_SUCCESS {
            return info.resident_size
        }
        return 0
    }
}

// MARK: - ProviderEntry

/// Internal mutable state for a single provider.
private struct ProviderEntry {
    var fetchCount: Int = 0
    var successCount: Int = 0
    var errorCount: Int = 0
    var fetchDurations: [TimeInterval] = []
    var lastError: String?
    var lastErrorTime: Date?
    var consecutiveFailures: Int = 0
    var statusHistory: [(status: ServiceStatus, timestamp: Date)] = []
}
