import Foundation
import SwiftUI
import TaskNotesKit

struct FacetTaskExtras: Equatable {
    var tags: String
    var recurrence: String
    var skipped: String
    var attachments: String
    var reminders: FacetValue
    var dependencies: FacetValue
    var dateCreated: String

    init(properties: [String: FacetValue]) {
        tags = Self.tokens(properties["tags"])
        recurrence = properties["recurrence"]?.text ?? ""
        skipped = Self.tokens(properties["skippedInstances"])
        attachments = Self.tokens(properties["attachments"])

        reminders = properties["reminders"] ?? .array([])
        dependencies = properties["blockedBy"] ?? .array([])
        dateCreated = properties["dateCreated"]?.text ?? ""
    }

    func changes(from original: [String: FacetValue]) -> [String: FacetValue] {
        let previous = Self(properties: original)
        var changes: [String: FacetValue] = [:]
        for (key, value, before) in [
            ("tags", tags, previous.tags), ("skippedInstances", skipped, previous.skipped),
            ("attachments", attachments, previous.attachments),
        ] where value != before {
            changes[key] = .array(value.split(separator: "\n").map { .string(String($0)) })
        }
        if recurrence != previous.recurrence {
            changes["recurrence"] = recurrence.isEmpty ? .null : .string(recurrence)
        }
        if reminders != previous.reminders { changes["reminders"] = reminders }
        if dependencies != previous.dependencies { changes["blockedBy"] = dependencies }
        if dateCreated != previous.dateCreated {
            changes["dateCreated"] = dateCreated.isEmpty ? .null : .string(dateCreated)
        }
        return changes
    }

    private static func tokens(_ value: FacetValue?) -> String {
        if let text = value?.text { return text }
        return value?.array?.elements.compactMap(\.text).joined(separator: "\n") ?? ""
    }
}

struct FacetTaskExtrasFields: View {
    @Binding var draft: FacetTaskExtras
    var body: some View {
        Section("Tags and attachments") {
            TextField("Tags, one per line", text: $draft.tags, axis: .vertical)
            TextField(
                "Attachment vault paths, one per line", text: $draft.attachments, axis: .vertical)
        }
        Section("Recurrence") {
            TextField("Recurrence rule", text: $draft.recurrence, axis: .vertical)
            TextField(
                "Skipped occurrence dates, one per line", text: $draft.skipped, axis: .vertical)
        }
        Section("Creation date") {
            TextField("Created date-time", text: $draft.dateCreated)
            Text(
                "If this note is incomplete, enter its known original creation date-time before saving."
            )
            .font(.caption).foregroundStyle(.secondary)
        }
        FacetRelationshipsSection(dependencies: $draft.dependencies, reminders: $draft.reminders)
    }
}
