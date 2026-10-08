import AppIntents
import Foundation
import TaskNotesKit

struct StopTrackingIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop Tracking"
  static let openAppWhenRun = true
  static let isDiscoverable = false

  @Parameter(title: "Vault") var profileID: String
  @Parameter(title: "Engine") var engineIdentity: String
  @Parameter(title: "Session") var sessionID: String
  @Parameter(title: "Task") var taskPath: String
  @Parameter(title: "Revision") var taskRevision: String

  init() {}
  init(
    profileID: String, engineIdentity: String, sessionID: String, taskPath: String,
    taskRevision: String
  ) {
    self.profileID = profileID
    self.engineIdentity = engineIdentity
    self.sessionID = sessionID
    self.taskPath = taskPath
    self.taskRevision = taskRevision
  }

  func perform() async throws -> some IntentResult & ProvidesDialog & OpensIntent {
    guard
      let group = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.tasksforobsidian")
    else { throw FacetIntentError.unavailableGroup }
    let queue = try FacetIntentQueue(directory: group.appendingPathComponent("FacetIntentActions"))
    let stop = try queue.enqueueTrackingStop(
      profileID: profileID, engineIdentity: engineIdentity, sessionID: sessionID,
      taskPath: taskPath, taskRevision: taskRevision)
    var route = URLComponents()
    route.scheme = "tasknotes"
    route.host = "queued-capture"
    route.queryItems = [URLQueryItem(name: "actionID", value: stop.id)]
    guard let url = route.url else { throw FacetContractError.unsupportedResponse }
    return .result(
      opensIntent: OpenURLIntent(url),
      dialog: "Stop queued for this session. Facet will verify and save it when it opens.")
  }
}
