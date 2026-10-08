import ActivityKit
import Foundation

nonisolated struct TimeTrackingAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let taskTitle: String
    let projectLabels: [String]
    let taskRevision: String
    let elapsedSeconds: UInt64
    let observedAt: Date
  }

  let profileID: String
  let engineIdentity: String
  let sessionID: String
  let taskPath: String
  let startedAt: Date
}
