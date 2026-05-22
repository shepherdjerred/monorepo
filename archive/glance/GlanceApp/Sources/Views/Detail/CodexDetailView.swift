import Charts
import SwiftUI

/// Detail view showing Codex plan usage (5-hour and 7-day windows).
struct CodexDetailView: View {
    let usage: CodexUsage

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
