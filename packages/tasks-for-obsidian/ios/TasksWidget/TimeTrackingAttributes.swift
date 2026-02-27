import ActivityKit
import Foundation

struct TimeTrackingAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var elapsedSeconds: Int
    var isPaused: Bool
  }

  var taskId: String
  var taskTitle: String
  var projectName: String?
  var startTime: Date
}
