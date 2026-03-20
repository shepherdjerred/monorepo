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
        // Refresh every 5 minutes — the main app pushes updates via WidgetCenter
        // so this is just a fallback.
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 5, to: .now)
            ?? .now.addingTimeInterval(300)
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    // MARK: Private

    private static let suiteName = "group.glance.widget"

    private func loadEntry() -> WidgetUsageEntry? {
        guard let defaults = UserDefaults(suiteName: Self.suiteName),
              let data = defaults.data(forKey: "widgetUsageEntry")
        else {
            return nil
        }
        return try? JSONDecoder().decode(WidgetUsageEntry.self, from: data)
    }
}
