import Charts
import SwiftUI

// MARK: - ClaudeCodeDetailView

/// Detail view showing Claude Code plan usage (5-hour and 7-day windows).
struct ClaudeCodeDetailView: View {
    let usage: ClaudeCodeUsage

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let fiveHour = usage.fiveHour {
                UsageWindowView(label: "5-Hour Window", window: fiveHour)
            }
            if let sevenDay = usage.sevenDay {
                UsageWindowView(label: "7-Day Window", window: sevenDay)
            }
            if self.usage.fiveHour == nil, self.usage.sevenDay == nil {
                Text("No usage data available.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - UsageWindowView

/// Shared view for displaying a usage window with progress bar.
struct UsageWindowView: View {
    // MARK: Internal

    let label: String
    let window: UsageWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(self.label)
                    .font(.headline)
                Spacer()
                Gauge(value: min(self.window.utilization, 100), in: 0 ... 100) {
                    Text("Usage")
                } currentValueLabel: {
                    Text("\(Int(self.window.utilization))%")
                }
                .gaugeStyle(.accessoryCircular)
                .tint(self.progressColor)
                .frame(width: 44, height: 44)
            }

            ProgressView(value: min(self.window.utilization, 100), total: 100)
                .tint(self.progressColor)

            if let resetsAt = window.resetsAt {
                Text("Resets \(resetsAt, style: .relative)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Private

    private var progressColor: Color {
        if self.window.utilization >= 95 {
            .red
        } else if self.window.utilization >= 80 {
            .yellow
        } else {
            .green
        }
    }
}
