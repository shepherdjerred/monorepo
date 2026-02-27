import WidgetKit

struct TodayTasksEntry: TimelineEntry {
  let date: Date
  let data: WidgetData
}

struct TodayTasksProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayTasksEntry {
    TodayTasksEntry(date: .now, data: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayTasksEntry) -> Void) {
    let data = WidgetData.load() ?? .placeholder
    completion(TodayTasksEntry(date: .now, data: data))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayTasksEntry>) -> Void) {
    let data = WidgetData.load() ?? .placeholder
    let entry = TodayTasksEntry(date: .now, data: data)
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? .now
    let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
    completion(timeline)
  }
}
