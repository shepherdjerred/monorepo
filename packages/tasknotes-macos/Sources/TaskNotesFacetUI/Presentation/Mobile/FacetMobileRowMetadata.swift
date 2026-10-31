#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileRowMetadata: View {
        let task: FacetTask
        let presentation: FacetTaskPresentation
        let viewer: ViewerCalendar
        @Environment(\.dynamicTypeSize) private var dynamicType

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                if let selectedDate = presentation.date {
                    let day = String(selectedDate.prefix(10))
                    let label = FacetMobileDateText.heading(
                        day, today: viewer.today, timeZone: viewer.timeZone)
                    Label(
                        "\(dateKind) · \(label)",
                        systemImage: task.agendaDateKind == "deadline" ? "flag" : "calendar"
                    )
                    .foregroundStyle(
                        !task.completed && day < viewer.today
                            ? Color.red : FacetNativeStyle.secondaryText
                    )
                    .accessibilityLabel(
                        "\(dateKind), \(label)\(!task.completed && day < viewer.today ? ", overdue" : "")"
                    )
                }
                organization
                if presentation.recurring || presentation.pending || presentation.blocked {
                    HStack(spacing: 8) {
                        if presentation.recurring { Label("Repeats", systemImage: "repeat") }
                        if presentation.pending {
                            Label("Pending Sync", systemImage: "arrow.up.circle")
                        }
                        if presentation.blocked { Label("Blocked", systemImage: "lock") }
                    }
                    .labelStyle(.iconOnly).foregroundStyle(.secondary)
                }
            }
            .font(.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        @ViewBuilder private var organization: some View {
            let projects = FacetTaskPresentation.tokens(task.properties["projects"])
            let contexts = FacetTaskPresentation.tokens(task.properties["contexts"])
            let tags = FacetTaskPresentation.tokens(task.properties["tags"])
            if dynamicType.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    project(projects.first)
                    secondary(context: contexts.first, tag: tags.first)
                }
            } else {
                HStack(spacing: 8) {
                    project(projects.first)
                    secondary(context: contexts.first, tag: tags.first)
                }
            }
        }

        @ViewBuilder private func project(_ value: String?) -> some View {
            if let value {
                Label(value, systemImage: "folder").foregroundStyle(FacetNativeStyle.brand)
                    .multilineTextAlignment(.leading).accessibilityLabel("Project \(value)")
            }
        }

        @ViewBuilder private func secondary(context: String?, tag: String?) -> some View {
            if let context {
                Text("@\(context)").foregroundStyle(.secondary).accessibilityLabel(
                    "Context \(context)")
            } else if let tag {
                Text(tag.hasPrefix("#") ? tag : "#\(tag)").foregroundStyle(.secondary)
                    .accessibilityLabel("Tag \(tag)")
            }
        }

        private var dateKind: String {
            if task.agendaDateKind == "planned" { return "Planned" }
            return task.agendaDateKind == "deadline" ? "Deadline" : "Date"
        }
    }
#endif
