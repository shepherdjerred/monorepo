import Foundation
import SwiftUI
import TaskNotesKit

struct FacetTaskExtras: Equatable {
    var tags: String
    var recurrence: String
    var skipped: String
    var attachments: String
    var estimate: String
    var reminders: FacetValue
    var dependencies: FacetValue
    var dateCreated: String

    init(properties: [String: FacetValue]) {
        tags = Self.tokens(properties["tags"])
        recurrence = properties["recurrence"]?.text ?? ""
        skipped = Self.tokens(properties["skippedInstances"])
        attachments = Self.tokens(properties["attachments"])
        if let value = properties["timeEstimate"] {
            switch value {
            case .integer(let minutes): estimate = String(minutes)
            case .unsigned(let minutes): estimate = String(minutes)
            case .rawNumber(let minutes): estimate = minutes
            case .number(let minutes): estimate = NSDecimalNumber(decimal: minutes).stringValue
            case .null: estimate = ""
            case .bool, .string, .array, .object: estimate = "Invalid estimate in this note"
            }
        } else {
            estimate = ""
        }
        reminders = properties["reminders"] ?? .array([])
        dependencies = properties["blockedBy"] ?? .array([])
        dateCreated = properties["dateCreated"]?.text ?? ""
    }

    func changes(from original: [String: FacetValue]) throws -> [String: FacetValue] {
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
        if estimate != previous.estimate {
            if estimate.isEmpty {
                changes["timeEstimate"] = .null
            } else {
                let value = try FacetFeatureProjection.parseJSON(estimate)
                switch value {
                case .integer, .unsigned, .number, .rawNumber: changes["timeEstimate"] = value
                case .null, .bool, .string, .array, .object: throw FacetEditorError.estimate
                }
            }
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

enum FacetEditorError: Error, LocalizedError {
    case estimate
    var errorDescription: String? { "Enter the estimate as a number of minutes." }
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
        Section("Estimate") { TextField("Minutes", text: $draft.estimate) }
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
