import SwiftUI
import TaskNotesKit

internal struct FacetInspectorRecurrence: View {
    let task: FacetTask
    let commit: ([String: FacetValue]) async -> Bool
    @State private var projection: FacetRecurrenceProjection?
    @State private var editing = false
    @State private var saving = false

    private var rule: String? { task.properties["recurrence"]?.text }
    private var scheduled: String? { task.properties["scheduled"]?.text }
    private var anchor: FacetRecurrenceAnchor? {
        let value = task.properties["recurrenceAnchor"]?.text ?? "scheduled"
        if value == "scheduled" { return .scheduled }
        if value == "completion" { return .completion }
        return nil
    }

    var body: some View {
        Button {
            editing = true
        } label: {
            LabeledContent("Repeat", value: projection?.summary ?? rule ?? "Never")
        }.buttonStyle(.plain).disabled(projection == nil || anchor == nil || saving)
        if rule != nil {
            Picker(
                "Measured from",
                selection: Binding(
                    get: { task.properties["recurrenceAnchor"]?.text ?? "scheduled" },
                    set: { submit(["recurrenceAnchor": .string($0)]) })
            ) {
                Text("Planned date").tag("scheduled")
                Text("Completion date").tag("completion")
            }.disabled(anchor == nil || saving)
            Button("Remove repeat", role: .destructive) { submit(["recurrence": .null]) }
                .disabled(saving)
        }
        if anchor == nil {
            Label(
                "The stored repeat anchor is unsupported. "
                    + "Correct recurrenceAnchor in the vault note before editing repeat.",
                systemImage: "exclamationmark.triangle"
            ).font(.caption)
        }
        Color.clear.frame(height: 0)
            .task(id: [rule, scheduled, task.properties["dateCreated"]?.text]) {
                let created = task.properties["dateCreated"]?.text
                let storedRule = rule
                let planned = scheduled
                let today = FacetCivilDay.iso(of: Date.now)
                let loaded = await _Concurrency.Task.detached {
                    FacetRecurrenceProjection.load(
                        rule: storedRule, scheduled: planned, dateCreated: created, today: today)
                }.value
                guard !_Concurrency.Task.isCancelled else { return }
                projection = loaded
            }
            .sheet(isPresented: $editing) {
                if let projection, let anchor {
                    FacetRecurrenceEditorSheet(
                        existingRule: rule, editableDraft: projection.editableDraft,
                        storedScheduled: scheduled, start: projection.start, anchor: anchor
                    ) { edit in
                        var properties: [String: FacetValue] = [
                            "recurrence": .string(edit.rule),
                            "recurrenceAnchor": .string(
                                edit.anchor == .scheduled ? "scheduled" : "completion"),
                        ]
                        if edit.writesScheduled { properties["scheduled"] = .string(edit.start) }
                        submit(properties)
                    }
                }
            }
    }

    private func submit(_ properties: [String: FacetValue]) {
        guard !saving else { return }
        saving = true
        _Concurrency.Task {
            _ = await commit(properties)
            saving = false
        }
    }
}
