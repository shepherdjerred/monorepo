import SwiftUI
import WidgetKit

private let widgetPriorityColors: [String: Color] = [
    "P1": .red,
    "P2": .orange,
    "P3": .blue,
    "P4": .secondary,
    "highest": .red,
    "high": .orange,
    "medium": .blue,
    "low": .secondary,
]

private func priorityColor(_ priority: String) -> Color {
    widgetPriorityColors[priority] ?? .secondary
}

private struct SmallWidgetView: View {
    let data: WidgetData

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.circle")
                    .font(.title2)
                    .foregroundStyle(.indigo)
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

            Text("\(data.stats.today) today")
                .font(.headline)

            Text("\(data.stats.total) open")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

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
                        .foregroundStyle(.indigo)
                }
            }

            Spacer()

            if let dateLabel = task.dateLabel ?? task.due {
                Text(dateLabel)
                    .font(.caption2)
                    .foregroundStyle(dateLabel == "Overdue" ? .red : .secondary)
            }
        }
    }
}

private struct MediumWidgetView: View {
    let data: WidgetData

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Today")
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

private struct LargeWidgetView: View {
    let data: WidgetData

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Today")
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

struct TodayTasksWidget: Widget {
    let kind = "TodayTasksWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayTasksProvider()) { entry in
            TodayTasksEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's Tasks")
        .description("View tasks scheduled for today or overdue in Facet.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct TodayTasksEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayTasksEntry

    var body: some View {
        if entry.isStale {
            VStack(spacing: 8) {
                Image(systemName: "arrow.clockwise.circle")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("Open Facet to refresh")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if family == .systemSmall {
            SmallWidgetView(data: entry.data)
        } else if family == .systemLarge {
            LargeWidgetView(data: entry.data)
        } else {
            MediumWidgetView(data: entry.data)
        }
    }
}
