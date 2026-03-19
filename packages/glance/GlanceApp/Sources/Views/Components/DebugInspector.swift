import SwiftUI

/// Debug inspector panel shown via `.inspector()` in the dashboard.
///
/// Displays per-provider fetch metrics and overall cycle diagnostics.
struct DebugInspector: View {
    // MARK: Internal

    let selectedServiceId: String?
    let metricsCollector: MetricsCollector

    var body: some View {
        List {
            if let selectedServiceId {
                self.providerSection(providerId: selectedServiceId)
            }
            self.overallSection
        }
        .listStyle(.sidebar)
        .navigationTitle("Debug Inspector")
        .task(id: self.refreshTick) {
            await self.loadMetrics()
        }
        .task {
            // Auto-refresh every 5 seconds.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                self.refreshTick += 1
            }
        }
    }

    // MARK: Private

    @State private var selectedMetrics: ProviderMetrics?
    @State private var overall: OverallMetrics?
    @State private var providerRanking: [(id: String, avgDuration: TimeInterval)] = []
    @State private var refreshTick: Int = 0

    private var errorEntries: [(id: String, errorCount: Int)] {
        // This is a simple snapshot; real data loads async but we use the ranking list
        []
    }

    private var overallSection: some View {
        Section("Overall") {
            if let overall {
                LabeledContent("Total cycles", value: "\(overall.totalCycles)")
                LabeledContent("Last cycle time", value: Self.formatDuration(overall.lastCycleTime))
                LabeledContent("Providers tracked", value: "\(overall.providerCount)")
                LabeledContent("Memory", value: Self.formatBytes(overall.memoryFootprintBytes))
            } else {
                Text("No cycle data yet.")
                    .foregroundStyle(.secondary)
            }

            if !self.providerRanking.isEmpty {
                DisclosureGroup("Providers by duration") {
                    ForEach(self.providerRanking, id: \.id) { entry in
                        LabeledContent(entry.id, value: Self.formatDuration(entry.avgDuration))
                    }
                }
            }

            self.errorSummary
        }
    }

    @ViewBuilder
    private var errorSummary: some View {
        if !self.providerRanking.isEmpty {
            let totalErrors = self.providerRanking.count
            // Show total error count across all providers if available
            if totalErrors > 0 {
                DisclosureGroup("Error counts") {
                    ForEach(self.errorEntries, id: \.id) { entry in
                        LabeledContent(entry.id, value: "\(entry.errorCount)")
                    }
                }
            }
        }
    }

    private func providerSection(providerId: String) -> some View {
        Section("Provider: \(providerId)") {
            if let metrics = selectedMetrics {
                self.metricsContent(metrics)
            } else {
                Text("No metrics recorded yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func metricsContent(_ metrics: ProviderMetrics) -> some View {
        LabeledContent("Fetch count", value: "\(metrics.fetchCount)")
        LabeledContent("Success", value: "\(metrics.successCount)")
        LabeledContent("Errors", value: "\(metrics.errorCount)")
        LabeledContent(
            "Consecutive failures",
            value: "\(metrics.consecutiveFailures)",
        )

        if metrics.fetchCount > 0 {
            self.durationMetrics(metrics)
        }

        if let lastError = metrics.lastError {
            LabeledContent("Last error") {
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        if let lastErrorTime = metrics.lastErrorTime {
            LabeledContent(
                "Last error at",
                value: lastErrorTime.formatted(.dateTime),
            )
        }

        if !metrics.statusHistory.isEmpty {
            self.statusHistorySection(metrics)
        }
    }

    @ViewBuilder
    private func durationMetrics(
        _ metrics: ProviderMetrics,
    ) -> some View {
        LabeledContent(
            "Avg duration",
            value: Self.formatDuration(metrics.averageDuration),
        )
        LabeledContent(
            "p50 duration",
            value: Self.formatDuration(metrics.p50Duration),
        )
        LabeledContent(
            "p95 duration",
            value: Self.formatDuration(metrics.p95Duration),
        )
        LabeledContent(
            "Max duration",
            value: Self.formatDuration(metrics.maxDuration),
        )
    }

    private func statusHistorySection(
        _ metrics: ProviderMetrics,
    ) -> some View {
        DisclosureGroup("Status history (\(metrics.statusHistory.count))") {
            ForEach(
                Array(metrics.statusHistory.reversed().enumerated()),
                id: \.offset,
            ) { _, entry in
                HStack {
                    Image(systemName: entry.status.iconName)
                        .foregroundStyle(entry.status.color)
                        .accessibilityHidden(true)
                    Text(entry.status.label)
                    Spacer()
                    Text(
                        entry.timestamp.formatted(
                            .dateTime.hour().minute().second(),
                        ),
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private static func formatDuration(_ interval: TimeInterval) -> String {
        if interval < 1 {
            String(format: "%.0f ms", interval * 1000)
        } else {
            String(format: "%.2f s", interval)
        }
    }

    private static func formatBytes(_ bytes: UInt64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .memory
        return formatter.string(fromByteCount: Int64(bytes))
    }

    private func loadMetrics() async {
        if let selectedServiceId {
            self.selectedMetrics = await self.metricsCollector.metrics(for: selectedServiceId)
        }
        self.overall = await self.metricsCollector.overallMetrics()

        let ids = await self.metricsCollector.allProviderIds()
        var ranking: [(id: String, avgDuration: TimeInterval)] = []
        for id in ids {
            let providerMetrics = await self.metricsCollector.metrics(for: id)
            ranking.append((id: id, avgDuration: providerMetrics.averageDuration))
        }
        self.providerRanking = ranking.sorted { $0.avgDuration > $1.avgDuration }
    }
}
