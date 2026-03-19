import Charts
import SwiftUI

// MARK: - StatusHistoryChart

/// Displays a status-over-time chart for a single service provider.
///
/// Queries `SnapshotStore` for the last 24 hours and renders a step chart
/// mapping status values to a Y axis (unknown=0, ok=1, warning=2, error=3).
struct StatusHistoryChart: View {
    // MARK: Internal

    let providerId: String
    let snapshotStore: SnapshotStore?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Status History (24h)")
                .font(.headline)

            if self.dataPoints.isEmpty {
                ContentUnavailableView(
                    String(localized: "No History Available"),
                    systemImage: "chart.xyaxis.line",
                    description: Text("Status history will appear here after polling data is collected."),
                )
            } else {
                self.historyChart
            }
        }
        .task {
            await self.loadHistory()
        }
    }

    // MARK: Private

    @State private var dataPoints: [StatusDataPoint] = []

    private var historyChart: some View {
        Chart(self.dataPoints) { point in
            LineMark(
                x: .value("Time", point.date),
                y: .value("Status", point.numericStatus),
            )
            .interpolationMethod(.stepEnd)
            .foregroundStyle(self.chartColor(for: point.numericStatus))

            PointMark(
                x: .value("Time", point.date),
                y: .value("Status", point.numericStatus),
            )
            .symbolSize(20)
            .foregroundStyle(self.chartColor(for: point.numericStatus))
        }
        .chartYScale(domain: 0 ... 3)
        .chartYAxis {
            AxisMarks(values: [0, 1, 2, 3]) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let intValue = value.as(Int.self) {
                        Text(verbatim: self.statusLabel(for: intValue))
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { _ in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.hour().minute())
            }
        }
        .frame(minHeight: 200)
        .accessibilityLabel("Status history chart for \(self.providerId)")
    }

    private func loadHistory() async {
        guard let store = self.snapshotStore else {
            return
        }
        let twentyFourHours: TimeInterval = 24 * 60 * 60
        let snapshots = await (try? store.history(
            for: self.providerId,
            last: twentyFourHours,
        )) ?? []
        self.dataPoints = snapshots.map { StatusDataPoint(from: $0) }
    }

    private func chartColor(for numericStatus: Int) -> Color {
        switch numericStatus {
        case 1:
            .green
        case 2:
            .yellow
        case 3:
            .red
        default:
            .secondary
        }
    }

    private func statusLabel(for value: Int) -> String {
        switch value {
        case 0:
            "Unknown"
        case 1:
            "OK"
        case 2:
            "Warning"
        case 3:
            "Error"
        default:
            ""
        }
    }
}

// MARK: - StatusDataPoint

/// A single data point for the status history chart.
struct StatusDataPoint: Identifiable {
    // MARK: Lifecycle

    init(from snapshot: PersistedSnapshot) {
        self.id = snapshot.id ?? Int64(snapshot.timestamp.hashValue)
        self.date = snapshot.date
        // Map: ok=1, warning=2, error=3, unknown=0
        self.numericStatus = switch snapshot.serviceStatus {
        case .ok:
            1
        case .warning:
            2
        case .error:
            3
        case .unknown:
            0
        }
    }

    // MARK: Internal

    let id: Int64
    let date: Date
    let numericStatus: Int
}
