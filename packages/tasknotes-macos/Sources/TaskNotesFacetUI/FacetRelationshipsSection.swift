import Foundation
import SwiftUI
import TaskNotesKit

struct FacetRelationshipsSection: View {
    let store: FacetStore
    let profileID: String
    let owningEngine: FacetEngine?
    let draftID: UUID
    @Binding var dependencies: FacetValue
    @Binding var reminders: FacetValue
    @State private var options = FacetDependencyEditorState()

    private struct Owner: Hashable {
        let engine: ObjectIdentifier?
        let selectedProfile: String?
        let draft: UUID
        let snapshotVersion: UInt64?
    }

    var body: some View {
        Group {
            dependencySection
            reminderSection
        }
        .task(
            id: Owner(
                engine: store.engine.map(ObjectIdentifier.init),
                selectedProfile: store.selectedProfileID, draft: draftID,
                snapshotVersion: store.snapshot?.version)
        ) { await loadOptions() }
        .onDisappear { options.invalidate() }
    }

    private var dependencySection: some View {
        Section("Dependencies") {
            if let error = options.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .accessibilityIdentifier("facet.dependencies.error")
                Button("Retry relationship options") {
                    _Concurrency.Task { await loadOptions() }
                }
                .disabled(options.isLoading)
                .accessibilityIdentifier("facet.dependencies.retry")
            } else if options.metadata == nil {
                ProgressView("Loading relationship options…")
            }
            if let items = dependencies.array?.elements {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    VStack(alignment: .leading) {
                        if item.object != nil {
                            TextField("Task identity", text: field($dependencies, index, "uid"))
                                .accessibilityIdentifier("facet.dependencies.uid.\(index)")
                            if let metadata = options.metadata {
                                relationship(index, metadata: metadata)
                            } else {
                                Text(
                                    item.object?.fields["reltype"]?.text
                                        ?? "No relationship selected")
                            }
                            TextField("Gap duration", text: field($dependencies, index, "gap"))
                                .accessibilityIdentifier("facet.dependencies.gap.\(index)")
                        } else {
                            Text("This unsupported dependency record is retained unchanged.")
                        }
                        Button("Remove dependency", role: .destructive) {
                            remove($dependencies, index)
                        }
                    }
                    .disabled(options.metadata == nil || !ownsDraft)
                }
                Button("Add dependency") {
                    guard ownsDraft, let metadata = options.metadata,
                        let currentItems = dependencies.array?.elements
                    else { return }
                    dependencies = .array(currentItems + [metadata.newDependency])
                }
                .disabled(options.metadata == nil || !ownsDraft)
                .accessibilityIdentifier("facet.dependencies.add")
            } else {
                Text(
                    "The dependency value needs correction in this vault note before it can be edited here."
                )
            }
        }
    }

    private var reminderSection: some View {
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

    private var ownsDraft: Bool {
        store.engine === owningEngine && owningEngine != nil && store.selectedProfileID == profileID
    }

    private func loadOptions() async {
        await options.load(
            ownsDraft: { ownsDraft },
            read: {
                guard let owningEngine else { throw FacetContractError.unsupportedResponse }
                return try await owningEngine.features(
                    profileID: profileID,
                    request: .object([
                        "schemaVersion": .integer(1), "kind": .string("dependency_editor"),
                    ]))
            })
    }

    private func relationship(_ index: Int, metadata: FacetDependencyEditor) -> some View {
        let value = field($dependencies, index, "reltype")
        let known = metadata.relationshipTypes.contains { $0.rawValue == value.wrappedValue }
        return VStack(alignment: .leading) {
            Picker(
                "Relationship",
                selection: Binding<String?>(
                    get: { known ? value.wrappedValue : nil },
                    set: { selected in
                        guard ownsDraft, var items = dependencies.array?.elements,
                            items.indices.contains(index), var record = items[index].object?.fields
                        else { return }
                        record["reltype"] = .string(selected ?? "")
                        items[index] = .object(record)
                        dependencies = .array(items)
                    })
            ) {
                Text("Choose a relationship").tag(String?.none)
                ForEach(metadata.relationshipTypes, id: \.rawValue) { choice in
                    Text(choice.label).tag(Optional(choice.rawValue))
                }
            }
            .accessibilityIdentifier("facet.dependencies.relationship.\(index)")
            if !known && !value.wrappedValue.isEmpty {
                Text(
                    "Stored relationship ‘\(value.wrappedValue)’ is retained until you choose a supported value."
                )
                .font(.caption).foregroundStyle(.secondary)
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
