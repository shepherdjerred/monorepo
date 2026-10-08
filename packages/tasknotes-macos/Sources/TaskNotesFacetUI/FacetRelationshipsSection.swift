import Foundation
import SwiftUI
import TaskNotesKit

struct FacetRelationshipsSection: View {
    @Binding var dependencies: FacetValue
    @Binding var reminders: FacetValue

    var body: some View {
        Section("Dependencies") {
            if let items = dependencies.array?.elements {
                ForEach(Array(items.enumerated()), id: \.offset) { index, _ in
                    VStack(alignment: .leading) {
                        TextField("Task identity", text: field($dependencies, index, "uid"))
                        Picker("Relationship", selection: field($dependencies, index, "reltype")) {
                            Text("Finish to start").tag("FINISHTOSTART")
                            Text("Finish to finish").tag("FINISHTOFINISH")
                            Text("Start to start").tag("STARTTOSTART")
                            Text("Start to finish").tag("STARTTOFINISH")
                        }
                        TextField("Gap duration", text: field($dependencies, index, "gap"))
                        Button("Remove dependency", role: .destructive) {
                            remove($dependencies, index)
                        }
                    }
                }
                Button("Add dependency") {
                    dependencies = .array(
                        items + [
                            .object([
                                "uid": .string(""), "reltype": .string("FINISHTOSTART"),
                            ])
                        ])
                }
            } else {
                Text(
                    "The dependency value needs correction in this vault note before it can be edited here."
                )
            }
        }
        Section("Reminders") {
            if let items = reminders.array?.elements {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    VStack(alignment: .leading) {
                        TextField("Description", text: field($reminders, index, "description"))
                        if item.object?.fields["type"] == .string("absolute") {
                            TextField(
                                "Reminder date-time", text: field($reminders, index, "absoluteTime")
                            )
                        } else {
                            Picker("Relative to", selection: field($reminders, index, "relatedTo"))
                            {
                                Text("Due date").tag("due")
                                Text("Scheduled date").tag("scheduled")
                            }
                            TextField("Offset duration", text: field($reminders, index, "offset"))
                        }
                        Button("Remove reminder", role: .destructive) { remove($reminders, index) }
                    }
                }
                Button("Add reminder at a date-time") {
                    reminders = .array(
                        items + [
                            .object([
                                "id": .string(UUID().uuidString), "type": .string("absolute"),
                                "absoluteTime": .string(Date.now.ISO8601Format()),
                            ])
                        ])
                }
                Button("Add relative reminder") {
                    reminders = .array(
                        items + [
                            .object([
                                "id": .string(UUID().uuidString), "type": .string("relative"),
                                "relatedTo": .string("due"), "offset": .string("-PT15M"),
                            ])
                        ])
                }
            } else {
                Text(
                    "The reminder value needs correction in this vault note before it can be edited here."
                )
            }
        }
    }

    private func field(_ value: Binding<FacetValue>, _ index: Int, _ key: String) -> Binding<String>
    {
        Binding(
            get: {
                guard let items = value.wrappedValue.array?.elements, items.indices.contains(index)
                else {
                    return ""
                }
                return items[index].object?.fields[key]?.text ?? ""
            },
            set: { text in
                guard var items = value.wrappedValue.array?.elements, items.indices.contains(index),
                    var record = items[index].object?.fields
                else { return }
                record[key] = text.isEmpty ? nil : .string(text)
                items[index] = .object(record)
                value.wrappedValue = .array(items)
            })
    }

    private func remove(_ value: Binding<FacetValue>, _ index: Int) {
        guard var items = value.wrappedValue.array?.elements, items.indices.contains(index) else {
            return
        }
        items.remove(at: index)
        value.wrappedValue = .array(items)
    }
}
