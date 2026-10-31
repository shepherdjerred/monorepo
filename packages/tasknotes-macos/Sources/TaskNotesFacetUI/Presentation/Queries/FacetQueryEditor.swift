import SwiftUI
import TaskNotesKit

/// An editor for the shared query contract. Changing a field preserves every
/// other query value, including imported filters this shell does not edit.
internal struct FacetQueryEditor: View {
    @Binding var query: [String: FacetValue]
    let configuration: FacetValue
    let vocabulary: [String: [String]]

    var body: some View {
        Section("Status and priority") {
            multipleChoices("Status", key: "statuses", choices: configured("statuses"))
            multipleChoices("Priority", key: "priorities", choices: configured("priorities"))
            Picker("Completion", selection: completion) {
                Text("Any").tag("any")
                Text("Incomplete").tag("incomplete")
                Text("Completed").tag("completed")
            }.accessibilityIdentifier("facet.query.completion")
        }
        Section("Organize") {
            ForEach(["projects", "contexts", "tags"], id: \.self) { key in
                multipleChoices(label(key), key: key, choices: tokens(key).map { ($0, $0) })
            }
            optionalBoolean(
                "Project", key: "hasNoProject", absent: "No project", present: "Has project")
        }
        Section("Dates") {
            optionalBoolean(
                "Due date", key: "hasNoDueDate", absent: "No due date", present: "Has due date")
            FacetQueryDateField(title: "Due before", key: "dueBefore", query: $query)
            FacetQueryDateField(title: "Due after", key: "dueAfter", query: $query)
        }
        Section("Sort and group") {
            Picker("Sort by", selection: text("sortField")) {
                Text("Default order").tag("")
                Text("Date").tag("effectiveDate")
                Text("Due date").tag("dueDate")
                Text("Planned date").tag("scheduledDate")
                Text("Created date").tag("createdDate")
                Text("Completed date").tag("completedDate")
                Text("Priority").tag("priority")
                Text("Status").tag("status")
                Text("Title").tag("title")
                Text("Manual order").tag("manual")
            }.accessibilityIdentifier("facet.query.sortField")
            Picker("Direction", selection: text("sortDirection")) {
                Text("Default").tag("")
                Text("Ascending").tag("asc")
                Text("Descending").tag("desc")
            }.accessibilityIdentifier("facet.query.sortDirection")
            Picker("Group by", selection: text("groupBy")) {
                Text("Default grouping").tag("")
                Text("Date").tag("effectiveDate")
                if query["scope"] == .string("todayAgenda") {
                    Text("Today sections").tag("agendaSection")
                } else if query["groupBy"] == .string("agendaSection") {
                    Text("Today sections (requires Today)").tag("agendaSection")
                }
                Text("Status").tag("status")
                Text("Priority").tag("priority")
                Text("Project").tag("project")
                Text("Context").tag("context")
            }.accessibilityIdentifier("facet.query.groupBy")
            if query["groupBy"] == .string("agendaSection"),
                query["scope"] != .string("todayAgenda")
            {
                Text(
                    "Today sections require a Today collection. Choose another grouping for this view."
                )
                .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var completion: Binding<String> {
        Binding(
            get: {
                if query["completed"] == .bool(true) { return "completed" }
                return query["completed"] == .bool(false) ? "incomplete" : "any"
            },
            set: { value in
                if value == "any" {
                    query["completed"] = .null
                } else {
                    query["completed"] = .bool(value == "completed")
                }
            })
    }

    private func text(_ key: String) -> Binding<String> {
        Binding(
            get: { query[key]?.text ?? "" },
            set: { value in query[key] = value.isEmpty ? nil : .string(value) })
    }

    private func optionalBoolean(_ title: String, key: String, absent: String, present: String)
        -> some View
    {
        Picker(
            title,
            selection: Binding(
                get: {
                    if query[key] == .bool(true) { return "absent" }
                    return query[key] == .bool(false) ? "present" : "any"
                },
                set: { value in
                    query[key] = value == "any" ? nil : .bool(value == "absent")
                })
        ) {
            Text("Any").tag("any")
            Text(absent).tag("absent")
            Text(present).tag("present")
        }.accessibilityIdentifier("facet.query.\(key)")
    }

    private func multipleChoices(_ title: String, key: String, choices: [(String, String)])
        -> some View
    {
        DisclosureGroup {
            if choices.isEmpty {
                Text("No \(title.lowercased()) values in this vault").foregroundStyle(.secondary)
            }
            ForEach(choices, id: \.0) { value, name in
                Toggle(name, isOn: selected(value, key: key))
                    .accessibilityIdentifier("facet.query.\(key).\(value)")
            }
        } label: {
            HStack {
                Text(title)
                Spacer()
                let count = query[key]?.array?.elements.count ?? 0
                if count > 0 { Text("\(count)").foregroundStyle(.secondary) }
            }
        }
    }

    private func selected(_ value: String, key: String) -> Binding<Bool> {
        Binding(
            get: { query[key]?.array?.elements.contains(.string(value)) == true },
            set: { enabled in
                var values = query[key]?.array?.elements ?? []
                values.removeAll { $0 == .string(value) }
                if enabled { values.append(.string(value)) }
                query[key] = values.isEmpty ? nil : .array(values)
            })
    }

    private func configured(_ key: String) -> [(String, String)] {
        do {
            let configured = try FacetConfiguredChoice.choices(
                in: configuration, key: key,
                including: query[key]?.array?.elements.compactMap(\.text) ?? [])
            return configured.map { ($0.value, $0.label) }
        } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
    }

    private func tokens(_ key: String) -> [String] {
        Array(Set((vocabulary[key] ?? []) + (query[key]?.array?.elements.compactMap(\.text) ?? [])))
            .sorted()
    }

    private func label(_ key: String) -> String {
        if key == "projects" { return "Projects" }
        return key == "contexts" ? "Contexts" : "Tags"
    }
}
