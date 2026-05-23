import Foundation
import WidgetKit

// MARK: - WidgetUsageEntry

/// Codable data shared between the main app and the widget extension.
/// Must be kept in sync with GlanceWidget/Sources/WidgetUsageEntry.swift.
struct WidgetUsageEntry: Codable {
    struct Window: Codable {
        let utilization: Double
        let resetsAt: Date?
    }

    struct Service: Codable {
        let name: String
        let fiveHour: Window?
        let sevenDay: Window?
    }

    let claudeCode: Service?
    let codex: Service?
    let timestamp: Date
}

// MARK: - WidgetDataProvider

/// Writes Claude Code and Codex usage data to a JSON file at
/// ~/Library/Application Support/Glance/widget-data.json.
/// The sandboxed widget extension reads this file via a temporary file exception.
enum WidgetDataProvider {
    // MARK: Internal

    static var sharedDirectory: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Application Support/Glance"
    }

    static var sharedFilePath: String {
        "\(self.sharedDirectory)/widget-data.json"
    }

    static func update(from snapshots: [ServiceSnapshot]) {
        let ccSnapshot = snapshots.first { $0.id == "claude-code" }
        let codexSnapshot = snapshots.first { $0.id == "codex" }

        let entry = WidgetUsageEntry(
            claudeCode: self.service(from: ccSnapshot, name: "Claude Code"),
            codex: self.service(from: codexSnapshot, name: "Codex"),
            timestamp: .now,
        )

        guard let data = try? JSONEncoder().encode(entry) else {
            return
        }

        let dir = self.sharedDirectory
        try? FileManager.default.createDirectory(
            atPath: dir,
            withIntermediateDirectories: true,
        )
        FileManager.default.createFile(
            atPath: self.sharedFilePath,
            contents: data,
            attributes: [.posixPermissions: 0o644],
        )

        WidgetCenter.shared.reloadTimelines(ofKind: "GlanceUsageWidget")
    }

    // MARK: Private

    private static func service(
        from snapshot: ServiceSnapshot?,
        name: String,
    ) -> WidgetUsageEntry.Service? {
        guard let snapshot else {
            return nil
        }
        switch snapshot.detail {
        case let .claudeCode(usage):
            return WidgetUsageEntry.Service(
                name: name,
                fiveHour: usage.fiveHour.map {
                    WidgetUsageEntry.Window(utilization: $0.utilization, resetsAt: $0.resetsAt)
                },
                sevenDay: usage.sevenDay.map {
                    WidgetUsageEntry.Window(utilization: $0.utilization, resetsAt: $0.resetsAt)
                },
            )
        case let .codex(usage):
            return WidgetUsageEntry.Service(
                name: name,
                fiveHour: usage.fiveHour.map {
                    WidgetUsageEntry.Window(utilization: $0.utilization, resetsAt: $0.resetsAt)
                },
                sevenDay: usage.sevenDay.map {
                    WidgetUsageEntry.Window(utilization: $0.utilization, resetsAt: $0.resetsAt)
                },
            )
        default:
            return nil
        }
    }
}
