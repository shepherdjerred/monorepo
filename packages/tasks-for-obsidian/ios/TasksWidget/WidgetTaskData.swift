import Foundation

struct WidgetTask: Codable, Identifiable {
  let id: String
  let title: String
  let priority: String
  let completed: Bool
  let due: String?
  let dateLabel: String?
  let project: String?
}

struct WidgetStats: Codable {
  let total: Int
  let overdue: Int
  let today: Int
}

struct WidgetData: Codable {
  let todayTasks: [WidgetTask]
  let stats: WidgetStats

  static var empty: WidgetData {
    WidgetData(
      todayTasks: [],
      stats: WidgetStats(total: 0, overdue: 0, today: 0)
    )
  }

  static var placeholder: WidgetData {
    WidgetData(
      todayTasks: [
        WidgetTask(
          id: "1", title: "Review pull request", priority: "medium",
          completed: false, due: nil, dateLabel: "Planned · Today", project: "Work"
        ),
        WidgetTask(
          id: "2", title: "Buy groceries", priority: "low", completed: false,
          due: nil, dateLabel: "Deadline · Today", project: "Personal"
        ),
        WidgetTask(
          id: "3", title: "Call dentist", priority: "high", completed: true,
          due: nil, dateLabel: nil, project: nil
        )
      ],
      stats: WidgetStats(total: 12, overdue: 2, today: 5)
    )
  }
}

struct WidgetDataEnvelope: Codable {
  let schemaVersion: Int
  let generatedAt: String
  let projections: [String: WidgetData]

  static func load() -> WidgetDataEnvelope? {
    guard let defaults = UserDefaults(suiteName: "group.com.tasksforobsidian"),
          let data = defaults.data(forKey: "widgetData") else {
      return nil
    }
    guard let envelope = try? JSONDecoder().decode(WidgetDataEnvelope.self, from: data),
          envelope.schemaVersion == 2 else {
      return nil
    }
    return envelope
  }

  func projection(for date: Date, calendar: Calendar = .current) -> WidgetData? {
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    guard let year = components.year,
          let month = components.month,
          let day = components.day else {
      return nil
    }
    let key = String(format: "%04d-%02d-%02d", year, month, day)
    return projections[key]
  }
}
