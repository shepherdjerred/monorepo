import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct TimeTrackingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TimeTrackingAttributes.self) { context in
      // Lock Screen / StandBy view
      LockScreenView(context: context)
        .padding()
        .activityBackgroundTint(.black.opacity(0.7))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        // Expanded view
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.state.isPaused ? "pause.circle.fill" : "timer")
            .foregroundStyle(context.state.isPaused ? .orange : .green)
            .font(.title2)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(context.attributes.taskTitle)
              .font(.headline)
              .lineLimit(1)
            if let project = context.attributes.projectName {
              Text(project)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(formatElapsed(context.state.elapsedSeconds))
            .font(.system(.title3, design: .monospaced))
            .foregroundStyle(context.state.isPaused ? .orange : .green)
        }
      } compactLeading: {
        Image(systemName: context.state.isPaused ? "pause.circle.fill" : "timer")
          .foregroundStyle(context.state.isPaused ? .orange : .green)
      } compactTrailing: {
        Text(formatElapsed(context.state.elapsedSeconds))
          .font(.system(.caption, design: .monospaced))
      } minimal: {
        Image(systemName: "timer")
          .foregroundStyle(.green)
      }
    }
  }
}

// MARK: - Lock Screen View

@available(iOS 16.2, *)
private struct LockScreenView: View {
  let context: ActivityViewContext<TimeTrackingAttributes>

  var body: some View {
    HStack(spacing: 16) {
      Image(systemName: context.state.isPaused ? "pause.circle.fill" : "timer")
        .font(.title)
        .foregroundStyle(context.state.isPaused ? .orange : .green)

      VStack(alignment: .leading, spacing: 4) {
        Text(context.attributes.taskTitle)
          .font(.headline)
          .lineLimit(1)
        if let project = context.attributes.projectName {
          Text(project)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
      }

      Spacer()

      VStack(alignment: .trailing) {
        Text(formatElapsed(context.state.elapsedSeconds))
          .font(.system(.title2, design: .monospaced))
          .foregroundStyle(context.state.isPaused ? .orange : .green)
        Text(context.state.isPaused ? "Paused" : "Tracking")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Helpers

private func formatElapsed(_ totalSeconds: Int) -> String {
  let hours = totalSeconds / 3600
  let minutes = (totalSeconds % 3600) / 60
  let seconds = totalSeconds % 60
  if hours > 0 {
    return String(format: "%d:%02d:%02d", hours, minutes, seconds)
  }
  return String(format: "%02d:%02d", minutes, seconds)
}
