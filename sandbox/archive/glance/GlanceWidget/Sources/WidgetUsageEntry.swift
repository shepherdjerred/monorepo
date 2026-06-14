import Foundation
import WidgetKit

// MARK: - WidgetUsageEntry

/// Codable data shared between the main app and the widget extension.
/// Must be kept in sync with GlanceApp/Sources/Services/WidgetDataProvider.swift.
struct WidgetUsageEntry: TimelineEntry, Codable {
    struct Window: Codable {
        let utilization: Double
        let resetsAt: Date?
    }

    struct Service: Codable {
        let name: String
        let fiveHour: Window?
        let sevenDay: Window?

        var maxUtilization: Double {
            max(self.fiveHour?.utilization ?? 0, self.sevenDay?.utilization ?? 0)
        }
    }

    static var placeholder: WidgetUsageEntry {
        WidgetUsageEntry(
            claudeCode: Service(
                name: "Claude Code",
                fiveHour: Window(utilization: 42, resetsAt: .now.addingTimeInterval(3600)),
                sevenDay: Window(utilization: 28, resetsAt: .now.addingTimeInterval(86400)),
            ),
            codex: Service(
                name: "Codex",
                fiveHour: Window(utilization: 15, resetsAt: .now.addingTimeInterval(7200)),
                sevenDay: Window(utilization: 10, resetsAt: .now.addingTimeInterval(172_800)),
            ),
            timestamp: .now,
        )
    }

    let claudeCode: Service?
    let codex: Service?
    let timestamp: Date

    /// TimelineEntry requires `date`
    var date: Date {
        self.timestamp
    }
}
