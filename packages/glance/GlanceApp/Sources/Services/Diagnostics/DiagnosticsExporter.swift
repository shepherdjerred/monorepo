import AppKit
import Foundation
import OSLog

// MARK: - DiagnosticsExporter

/// Exports diagnostic information as a JSON bundle saved to a user-chosen location.
enum DiagnosticsExporter {
    // MARK: Internal

    /// Collect and export diagnostics to a user-chosen file via NSSavePanel.
    @MainActor
    static func exportDiagnostics(
        metricsCollector: MetricsCollector,
        snapshots: [ServiceSnapshot],
        settings: GlanceSettings,
    ) async {
        let panel = NSSavePanel()
        panel.title = "Export Diagnostics"
        panel.nameFieldStringValue = "glance-diagnostics.json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        let report = await Self.buildReport(
            metricsCollector: metricsCollector,
            snapshots: snapshots,
            settings: settings,
        )

        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(report)
            try data.write(to: url, options: .atomic)
            GlanceLogger.diagnostics.info("Diagnostics exported to \(url.path, privacy: .public)")
        } catch {
            GlanceLogger.diagnostics.error(
                "Failed to export diagnostics: \(error.localizedDescription, privacy: .public)",
            )
        }
    }

    // MARK: Private

    @MainActor
    private static func buildReport(
        metricsCollector: MetricsCollector,
        snapshots: [ServiceSnapshot],
        settings: GlanceSettings,
    ) async -> DiagnosticsReport {
        let overall = await metricsCollector.overallMetrics()
        let providerIds = await metricsCollector.allProviderIds()
        var providerReports: [ProviderDiagnostics] = []
        for id in providerIds {
            let metrics = await metricsCollector.metrics(for: id)
            providerReports.append(ProviderDiagnostics(
                providerId: id,
                fetchCount: metrics.fetchCount,
                successCount: metrics.successCount,
                errorCount: metrics.errorCount,
                averageDuration: metrics.averageDuration,
                p50Duration: metrics.p50Duration,
                p95Duration: metrics.p95Duration,
                maxDuration: metrics.maxDuration,
                lastError: metrics.lastError,
                lastErrorTime: metrics.lastErrorTime,
                consecutiveFailures: metrics.consecutiveFailures,
            ))
        }

        let snapshotReports = snapshots.map { snap in
            SnapshotDiagnostics(
                id: snap.id,
                displayName: snap.displayName,
                status: snap.status.label,
                summary: snap.summary,
                error: snap.error,
                timestamp: snap.timestamp,
            )
        }

        let settingsDiag = SettingsDiagnostics(
            pollInterval: settings.pollInterval,
            historyRetentionDays: settings.historyRetentionDays,
            debugLogging: settings.debugLogging,
            notificationsEnabled: settings.notificationsEnabled,
        )

        return DiagnosticsReport(
            exportedAt: .now,
            system: SystemInfo(
                macOSVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                appUptime: ProcessInfo.processInfo.systemUptime,
                memoryFootprintBytes: overall.memoryFootprintBytes,
            ),
            settings: settingsDiag,
            overall: OverallDiagnostics(
                lastCycleTime: overall.lastCycleTime,
                totalCycles: overall.totalCycles,
                providerCount: overall.providerCount,
            ),
            providers: providerReports,
            snapshots: snapshotReports,
        )
    }
}

// MARK: - DiagnosticsReport

private struct DiagnosticsReport: Codable {
    let exportedAt: Date
    let system: SystemInfo
    let settings: SettingsDiagnostics
    let overall: OverallDiagnostics
    let providers: [ProviderDiagnostics]
    let snapshots: [SnapshotDiagnostics]
}

// MARK: - SystemInfo

private struct SystemInfo: Codable {
    let macOSVersion: String
    let appUptime: TimeInterval
    let memoryFootprintBytes: UInt64
}

// MARK: - SettingsDiagnostics

private struct SettingsDiagnostics: Codable {
    let pollInterval: TimeInterval
    let historyRetentionDays: Int
    let debugLogging: Bool
    let notificationsEnabled: Bool
}

// MARK: - OverallDiagnostics

private struct OverallDiagnostics: Codable {
    let lastCycleTime: TimeInterval
    let totalCycles: Int
    let providerCount: Int
}

// MARK: - ProviderDiagnostics

private struct ProviderDiagnostics: Codable {
    let providerId: String
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
}

// MARK: - SnapshotDiagnostics

private struct SnapshotDiagnostics: Codable {
    let id: String
    let displayName: String
    let status: String
    let summary: String
    let error: String?
    let timestamp: Date
}
