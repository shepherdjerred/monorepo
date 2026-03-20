import SwiftUI
import WidgetKit

// MARK: - UsageWidgetView

struct UsageWidgetView: View {
    // MARK: Internal

    let entry: WidgetUsageEntry

    var body: some View {
        switch self.family {
        case .systemSmall:
            SmallUsageView(entry: self.entry)
        case .systemMedium:
            MediumUsageView(entry: self.entry)
        default:
            SmallUsageView(entry: self.entry)
        }
    }

    // MARK: Private

    @Environment(\.widgetFamily) private var family
}

// MARK: - SmallUsageView

/// Compact view for the small widget family.
/// Shows both services stacked with circular gauges.
struct SmallUsageView: View {
    let entry: WidgetUsageEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let cc = entry.claudeCode {
                ServiceGaugeRow(service: cc, icon: "terminal.fill")
            }
            if let codex = entry.codex {
                ServiceGaugeRow(service: codex, icon: "chevron.left.forwardslash.chevron.right")
            }
            if self.entry.claudeCode == nil, self.entry.codex == nil {
                ContentUnavailableView("No Data", systemImage: "chart.bar.xaxis")
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

// MARK: - MediumUsageView

/// Side-by-side view for the medium widget family.
/// Shows both services with detailed progress bars.
struct MediumUsageView: View {
    let entry: WidgetUsageEntry

    var body: some View {
        HStack(spacing: 16) {
            if let cc = entry.claudeCode {
                ServiceDetailColumn(service: cc, icon: "terminal.fill")
            }
            if self.entry.claudeCode != nil, self.entry.codex != nil {
                Divider()
            }
            if let codex = entry.codex {
                ServiceDetailColumn(service: codex, icon: "chevron.left.forwardslash.chevron.right")
            }
            if self.entry.claudeCode == nil, self.entry.codex == nil {
                ContentUnavailableView("No Data", systemImage: "chart.bar.xaxis")
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

// MARK: - ServiceGaugeRow

/// Compact row with service name and a circular gauge.
struct ServiceGaugeRow: View {
    // MARK: Internal

    let service: WidgetUsageEntry.Service
    let icon: String

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Label(self.service.name, systemImage: self.icon)
                    .font(.caption2.bold())
                    .lineLimit(1)
                HStack(spacing: 4) {
                    WindowPill(label: "5h", utilization: self.service.fiveHour?.utilization)
                    WindowPill(label: "7d", utilization: self.service.sevenDay?.utilization)
                }
            }
            Spacer(minLength: 4)
            Gauge(value: min(self.service.maxUtilization, 100), in: 0 ... 100) {
                EmptyView()
            } currentValueLabel: {
                Text("\(Int(self.service.maxUtilization))%")
                    .font(.system(.caption2, design: .rounded, weight: .bold))
            }
            .gaugeStyle(.accessoryCircular)
            .tint(self.gaugeGradient)
            .frame(width: 36, height: 36)
        }
    }

    // MARK: Private

    private var gaugeGradient: Gradient {
        Gradient(colors: [.green, .yellow, .red])
    }
}

// MARK: - ServiceDetailColumn

/// Detailed column view for medium widget with progress bars.
struct ServiceDetailColumn: View {
    let service: WidgetUsageEntry.Service
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(self.service.name, systemImage: self.icon)
                .font(.subheadline.bold())
                .lineLimit(1)

            if let fiveHour = service.fiveHour {
                WindowProgressRow(label: "5-Hour", window: fiveHour)
            }
            if let sevenDay = service.sevenDay {
                WindowProgressRow(label: "7-Day", window: sevenDay)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - WindowProgressRow

struct WindowProgressRow: View {
    // MARK: Internal

    let label: String
    let window: WidgetUsageEntry.Window

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(self.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(self.window.utilization))%")
                    .font(.caption2.bold())
                    .foregroundStyle(self.utilizationColor)
            }
            ProgressView(value: min(self.window.utilization, 100), total: 100)
                .tint(self.utilizationColor)
            if let resetsAt = window.resetsAt {
                Text("Resets \(resetsAt, style: .relative)")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: Private

    private var utilizationColor: Color {
        if self.window.utilization >= 95 {
            .red
        } else if self.window.utilization >= 80 {
            .yellow
        } else {
            .green
        }
    }
}

// MARK: - WindowPill

/// Tiny pill showing "5h: 42%" in the small widget.
struct WindowPill: View {
    // MARK: Internal

    let label: String
    let utilization: Double?

    var body: some View {
        if let utilization {
            Text("\(self.label): \(Int(utilization))%")
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundStyle(self.pillColor)
        }
    }

    // MARK: Private

    private var pillColor: Color {
        guard let utilization else {
            return .secondary
        }
        if utilization >= 95 {
            return .red
        }
        if utilization >= 80 {
            return .yellow
        }
        return .secondary
    }
}
