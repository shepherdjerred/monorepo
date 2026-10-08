import ActivityKit
import SwiftUI
import WidgetKit

struct TimeTrackingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TimeTrackingAttributes.self) { context in
      HStack(spacing: 16) {
        Image(systemName: "timer").font(.title).foregroundStyle(.green)
        trackingLabel(context.state)
        Spacer()
        TrackingElapsed(startedAt: context.attributes.startedAt, observedAt: context.state.observedAt)
        stopButton(context)
      }
      .padding()
      .activityBackgroundTint(.black.opacity(0.7))
      .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "timer").font(.title2).foregroundStyle(.green)
        }
        DynamicIslandExpandedRegion(.center) { trackingLabel(context.state) }
        DynamicIslandExpandedRegion(.trailing) {
          TrackingElapsed(startedAt: context.attributes.startedAt, observedAt: context.state.observedAt)
        }
        DynamicIslandExpandedRegion(.bottom) { stopButton(context) }
      } compactLeading: {
        Image(systemName: "timer").foregroundStyle(.green)
      } compactTrailing: {
        TrackingElapsed(startedAt: context.attributes.startedAt, observedAt: context.state.observedAt)
          .font(.system(.caption, design: .monospaced))
      } minimal: {
        Image(systemName: "timer").foregroundStyle(.green)
      }
    }
  }

  private func trackingLabel(_ state: TimeTrackingAttributes.ContentState) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(state.taskTitle).font(.headline).lineLimit(1)
      if let project = state.projectLabels.first {
        Text(project).font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Text("Tracking").font(.caption).foregroundStyle(.secondary)
    }
  }

  private func stopButton(_ context: ActivityViewContext<TimeTrackingAttributes>) -> some View {
    Button(
      intent: StopTrackingIntent(
        profileID: context.attributes.profileID,
        engineIdentity: context.attributes.engineIdentity,
        sessionID: context.attributes.sessionID,
        taskPath: context.attributes.taskPath,
        taskRevision: context.state.taskRevision)
    ) { Label("Stop", systemImage: "stop.fill") }
    .accessibilityLabel("Stop this tracking session")
  }
}

private struct TrackingElapsed: View {
  let startedAt: Date
  let observedAt: Date
  var body: some View {
    if startedAt > observedAt {
      // Rust clamps future starts to zero; don't invent a countdown.
      Text("00:00").monospacedDigit()
    } else {
      Text(timerInterval: startedAt...Date.distantFuture, countsDown: false).monospacedDigit()
    }
  }
}
