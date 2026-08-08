import WidgetKit

struct TodayTasksEntry: TimelineEntry {
  let date: Date
  let data: WidgetData
  let isStale: Bool
}

struct TodayTasksProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayTasksEntry {
    TodayTasksEntry(date: .now, data: .placeholder, isStale: false)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayTasksEntry) -> Void) {
    let now = Date.now
    if context.isPreview {
      completion(TodayTasksEntry(date: now, data: .placeholder, isStale: false))
      return
    }
    let data = WidgetDataEnvelope.load()?.projection(for: now)
    completion(TodayTasksEntry(date: now, data: data ?? .empty, isStale: data == nil))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayTasksEntry>) -> Void) {
    let calendar = Calendar.current
    let now = Date.now
    guard let envelope = WidgetDataEnvelope.load() else {
      let entry = TodayTasksEntry(date: now, data: .empty, isStale: true)
      let nextUpdate = calendar.date(byAdding: .minute, value: 15, to: now) ?? now
      completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
      return
    }

    let start = calendar.startOfDay(for: now)
    var entries: [TodayTasksEntry] = []
    for offset in 0 ... 32 {
      guard let day = calendar.date(byAdding: .day, value: offset, to: start) else {
        break
      }
      let entryDate = offset == 0 ? now : day
      guard let data = envelope.projection(for: day, calendar: calendar) else {
        entries.append(TodayTasksEntry(date: entryDate, data: .empty, isStale: true))
        break
      }
      entries.append(TodayTasksEntry(date: entryDate, data: data, isStale: false))
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}
