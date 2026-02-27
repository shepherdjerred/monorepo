import Foundation

struct WidgetTask: Codable, Identifiable {
  let id: String
  let title: String
  let priority: String
  let completed: Bool
  let due: String?
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

  static func load() -> WidgetData? {
    guard let defaults = UserDefaults(suiteName: "group.com.tasksforobsidian"),
          let data = defaults.data(forKey: "widgetData") else {
      return nil
    }
    return try? JSONDecoder().decode(WidgetData.self, from: data)
  }

  static var placeholder: WidgetData {
    WidgetData(
      todayTasks: [
        WidgetTask(id: "1", title: "Review pull request", priority: "medium", completed: false, due: nil, project: "Work"),
        WidgetTask(id: "2", title: "Buy groceries", priority: "low", completed: false, due: nil, project: "Personal"),
        WidgetTask(id: "3", title: "Call dentist", priority: "high", completed: true, due: nil, project: nil),
      ],
      stats: WidgetStats(total: 12, overdue: 2, today: 5)
    )
  }
}
