import SwiftUI
import WidgetKit

// MARK: - Priority Color

private func priorityColor(_ priority: String) -> Color {
  switch priority {
  case "highest": return .red
  case "high": return .orange
  case "medium": return .yellow
  case "low": return .blue
  case "lowest": return .gray
  default: return .secondary
  }
}

// MARK: - Small Widget

private struct SmallWidgetView: View {
  let data: WidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image(systemName: "checkmark.circle")
          .font(.title2)
          .foregroundStyle(.blue)
        Spacer()
      }

      Spacer()

      if data.stats.overdue > 0 {
        HStack(spacing: 4) {
          Image(systemName: "exclamationmark.circle.fill")
            .foregroundStyle(.red)
            .font(.caption)
          Text("\(data.stats.overdue) overdue")
            .font(.caption)
            .foregroundStyle(.red)
        }
      }

      Text("\(data.stats.today) due today")
        .font(.headline)

      Text("\(data.stats.total) total")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Task Row

private struct TaskRowView: View {
  let task: WidgetTask
  let showProject: Bool

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
        .foregroundStyle(task.completed ? .green : priorityColor(task.priority))
        .font(.body)

      VStack(alignment: .leading, spacing: 1) {
        Text(task.title)
          .font(.subheadline)
          .strikethrough(task.completed)
          .opacity(task.completed ? 0.5 : 1)
          .lineLimit(1)

        if showProject, let project = task.project {
          Text(project)
            .font(.caption2)
            .foregroundStyle(.blue)
        }
      }

      Spacer()

      if let due = task.due {
        Text(due)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Medium Widget

private struct MediumWidgetView: View {
  let data: WidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("Today's Tasks")
          .font(.headline)
        Spacer()
        Text("\(data.stats.today)")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      .padding(.bottom, 2)

      if data.todayTasks.isEmpty {
        Spacer()
        HStack {
          Spacer()
          Text("All caught up!")
            .foregroundStyle(.secondary)
          Spacer()
        }
        Spacer()
      } else {
        ForEach(data.todayTasks.prefix(4)) { task in
          TaskRowView(task: task, showProject: false)
        }
      }
    }
  }
}

// MARK: - Large Widget

private struct LargeWidgetView: View {
  let data: WidgetData

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("Today's Tasks")
          .font(.headline)
        Spacer()
        if data.stats.overdue > 0 {
          Text("\(data.stats.overdue) overdue")
            .font(.caption)
            .foregroundStyle(.red)
        }
        Text("\(data.stats.today) today")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(.bottom, 4)

      if data.todayTasks.isEmpty {
        Spacer()
        HStack {
          Spacer()
          VStack(spacing: 8) {
            Image(systemName: "checkmark.circle")
              .font(.largeTitle)
              .foregroundStyle(.green)
            Text("All caught up!")
              .foregroundStyle(.secondary)
          }
          Spacer()
        }
        Spacer()
      } else {
        ForEach(data.todayTasks.prefix(8)) { task in
          TaskRowView(task: task, showProject: true)
          if task.id != data.todayTasks.prefix(8).last?.id {
            Divider()
          }
        }
        Spacer(minLength: 0)
      }
    }
  }
}

// MARK: - Widget Definition

struct TodayTasksWidget: Widget {
  let kind = "TodayTasksWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TodayTasksProvider()) { entry in
      Group {
        switch entry.data {
        default:
          TodayTasksEntryView(entry: entry)
        }
      }
      .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Today's Tasks")
    .description("View your tasks due today.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private struct TodayTasksEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: TodayTasksEntry

  var body: some View {
    switch family {
    case .systemSmall:
      SmallWidgetView(data: entry.data)
    case .systemMedium:
      MediumWidgetView(data: entry.data)
    case .systemLarge:
      LargeWidgetView(data: entry.data)
    default:
      MediumWidgetView(data: entry.data)
    }
  }
}
