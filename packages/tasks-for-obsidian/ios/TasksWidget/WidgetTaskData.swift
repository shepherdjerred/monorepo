import Foundation
import OSLog

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
    guard let group = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian") else {
      return nil
    }
    do {
      let data = try read(group.appendingPathComponent("FacetWidgetSnapshot.json"))
      let envelope = try JSONDecoder().decode(WidgetDataEnvelope.self, from: data)
      guard envelope.schemaVersion == 2 else { throw WidgetSnapshotError.invalidEnvelope }
      return envelope
    } catch let error as NSError
      where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
      return nil
    } catch {
      Logger(subsystem: "red.sjer.facet", category: "Widget")
        .error("The widget snapshot could not be read. Open Facet to refresh it.")
      return nil
    }
  }

  private static func read(_ url: URL) throws -> Data {
    let handle = try FileHandle(forReadingFrom: url)
    do {
      let limit = 4 * 1024 * 1024
      var bytes = Data()
      while let chunk = try handle.read(upToCount: min(1024 * 1024, limit + 1 - bytes.count)),
        !chunk.isEmpty {
        bytes.append(chunk)
        guard bytes.count <= limit else { throw WidgetSnapshotError.invalidEnvelope }
      }
      try handle.close()
      return bytes
    } catch {
      let failure = error
      do { try handle.close() } catch {
        Logger(subsystem: "red.sjer.facet", category: "Widget").error("Widget snapshot cleanup failed.")
      }
      throw failure
    }
  }

  func projection(for date: Date, calendar: Calendar = .gregorianLocal) -> WidgetData? {
    let key = date.formatted(
      Date.ISO8601FormatStyle(timeZone: calendar.timeZone).year().month().day())
    return projections[key]
  }
}

private enum WidgetSnapshotError: Error { case invalidEnvelope }

extension Calendar {
  static var gregorianLocal: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = .current
    return value
  }
}
