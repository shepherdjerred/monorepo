import Foundation
import WidgetKit

struct UsageTimelineProvider: TimelineProvider {
    // MARK: Internal

    func placeholder(in _: Context) -> WidgetUsageEntry {
        .placeholder
    }

    func getSnapshot(in _: Context, completion: @escaping (WidgetUsageEntry) -> Void) {
        completion(self.loadEntry() ?? .placeholder)
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<WidgetUsageEntry>) -> Void) {
        let entry = self.loadEntry() ?? WidgetUsageEntry(
            claudeCode: nil,
            codex: nil,
            timestamp: .now,
        )
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 5, to: .now)
            ?? .now.addingTimeInterval(300)
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    // MARK: Private

    private func loadEntry() -> WidgetUsageEntry? {
        // Use getpwuid to get the real home directory, not the sandboxed container
        let home: String = if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            String(cString: dir)
        } else {
            NSHomeDirectory()
        }
        let path = "\(home)/Library/Application Support/Glance/widget-data.json"
        guard let data = FileManager.default.contents(atPath: path) else {
            return nil
        }
        return try? JSONDecoder().decode(WidgetUsageEntry.self, from: data)
    }
}
