import SwiftUI
import WidgetKit

// MARK: - GlanceWidgetBundle

@main
struct GlanceWidgetBundle: WidgetBundle {
    var body: some Widget {
        GlanceUsageWidget()
    }
}

// MARK: - GlanceUsageWidget

struct GlanceUsageWidget: Widget {
    let kind = "GlanceUsageWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: self.kind, provider: UsageTimelineProvider()) { entry in
            UsageWidgetView(entry: entry)
        }
        .configurationDisplayName("AI Usage")
        .description("Claude Code and Codex plan usage.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
