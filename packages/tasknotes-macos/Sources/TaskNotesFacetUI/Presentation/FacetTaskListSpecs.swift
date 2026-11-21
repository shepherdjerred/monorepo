import SwiftUI
import TaskNotesKit

extension FacetTaskListView {
    var inboxSpec: FacetFlatListSpec {
        FacetFlatListSpec(
            heading: "Inbox",
            subtitle: "",
            tasks: store.inboxTasks(from: store.openListPresentationTasks),
            showProjectBadge: false,
            emptyTitle: "Your Inbox is clear",
            emptyMessage: "Capture tasks with Quick Add and organize them later."
        )
    }

    var todaySpec: FacetGroupedListSpec {
        FacetGroupedListSpec(
            heading: "Today",
            subtitle: store.calendar.instant.formatted(
                Date.FormatStyle(date: .complete, time: .omitted, timeZone: store.calendar.timeZone)
            ),
            groups: store.todayGroups(from: store.openListPresentationTasks),
            showProjectBadge: true,
            showWeekStrip: false,
            projectIdForSections: nil,
            emptyTitle: "All clear for today",
            emptyMessage: "Enjoy your day or add a task scheduled for today."
        )
    }

    var upcomingSpec: FacetGroupedListSpec {
        FacetGroupedListSpec(
            heading: "Upcoming",
            subtitle: "",
            groups: store.upcomingGroups(from: store.openListPresentationTasks),
            showProjectBadge: true,
            showWeekStrip: true,
            projectIdForSections: nil,
            emptyTitle: "Nothing scheduled ahead",
            emptyMessage: "Assign due dates to tasks to plan your week."
        )
    }

    var completedSpec: FacetFlatListSpec {
        FacetFlatListSpec(
            heading: "Completed",
            subtitle: "Finished tasks",
            tasks: store.completedTasks(from: store.listPresentationTasks),
            showProjectBadge: true,
            allowInlineCompose: false,
            emptyTitle: "No completed tasks yet",
            emptyMessage: "Check off a task to see your progress here."
        )
    }

    func boardHeader(title: String, subtitle: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }
}
