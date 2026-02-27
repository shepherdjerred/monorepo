import Foundation
import React
import ActivityKit

@objc(LiveActivityBridge)
class LiveActivityBridge: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private var currentActivityId: String?

  @objc func startTimeTracking(
    _ taskId: String,
    title: String,
    project: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.2, *) {
      let attributes = TimeTrackingAttributes(
        taskId: taskId,
        taskTitle: title,
        projectName: project,
        startTime: Date()
      )
      let state = TimeTrackingAttributes.ContentState(
        elapsedSeconds: 0,
        isPaused: false
      )
      let content = ActivityContent(state: state, staleDate: nil)

      do {
        let activity = try Activity.request(
          attributes: attributes,
          content: content,
          pushType: nil
        )
        currentActivityId = activity.id
        resolve(activity.id)
      } catch {
        reject("LIVE_ACTIVITY_ERROR", "Failed to start Live Activity: \(error.localizedDescription)", error)
      }
    } else {
      reject("UNSUPPORTED", "Live Activities require iOS 16.2+", nil)
    }
  }

  @objc func updateTimeTracking(
    _ elapsedSeconds: Int,
    isPaused: Bool,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.2, *) {
      let state = TimeTrackingAttributes.ContentState(
        elapsedSeconds: elapsedSeconds,
        isPaused: isPaused
      )
      let content = ActivityContent(state: state, staleDate: nil)

      Task {
        for activity in Activity<TimeTrackingAttributes>.activities {
          if activity.id == currentActivityId {
            await activity.update(content)
            break
          }
        }
        resolve(nil)
      }
    } else {
      reject("UNSUPPORTED", "Live Activities require iOS 16.2+", nil)
    }
  }

  @objc func stopTimeTracking(
    _ elapsedSeconds: Int,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if #available(iOS 16.2, *) {
      let state = TimeTrackingAttributes.ContentState(
        elapsedSeconds: elapsedSeconds,
        isPaused: true
      )
      let content = ActivityContent(state: state, staleDate: nil)

      Task {
        for activity in Activity<TimeTrackingAttributes>.activities {
          if activity.id == currentActivityId {
            await activity.end(content, dismissalPolicy: .default)
            break
          }
        }
        currentActivityId = nil
        resolve(nil)
      }
    } else {
      reject("UNSUPPORTED", "Live Activities require iOS 16.2+", nil)
    }
  }
}
