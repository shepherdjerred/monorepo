import SwiftUI
import TaskNotesKit

/// Common-pattern controls reuse the retained native editor; Rust parses and builds rules.
internal struct FacetRecurrenceField: View {
    @Binding var rule: String
    @Binding var scheduled: String
    @Binding var anchor: String
    let dateCreated: String
    @State private var projection: FacetRecurrenceProjection?
    @State private var editing = false

    var body: some View {
        Group {
            Button {
                editing = true
            } label: {
                LabeledContent(
                    "Repeat", value: rule.isEmpty ? "Never" : (projection?.summary ?? rule))
            }.buttonStyle(.plain).disabled(projection == nil || parsedAnchor == nil)
            if !rule.isEmpty {
                Picker("Measured from", selection: $anchor) {
                    Text("Planned date").tag("scheduled")
                    Text("Completion date").tag("completion")
                }
                Button("Remove repeat", role: .destructive) { rule = "" }
            }
            if parsedAnchor == nil {
                Label(
                    "The stored recurrence anchor ‘\(anchor)’ is unsupported. "
                        + "Correct it in the vault note before changing repeat.",
                    systemImage: "exclamationmark.triangle")
            }
        }
        // All generated recurrence calls execute away from the UI actor.
        .task(id: [rule, scheduled, dateCreated]) {
            let storedRule = rule.isEmpty ? nil : rule
            let planned = scheduled.isEmpty ? nil : scheduled
            let created = dateCreated.isEmpty ? nil : dateCreated
            let today = FacetCivilDay.iso(of: Date.now)
            let loaded = await _Concurrency.Task.detached {
                FacetRecurrenceProjection.load(
                    rule: storedRule, scheduled: planned, dateCreated: created, today: today)
            }.value
            guard !_Concurrency.Task.isCancelled else { return }
            projection = loaded
        }
        .sheet(isPresented: $editing) {
            if let projection, let parsedAnchor {
                FacetRecurrenceEditorSheet(
                    existingRule: rule.isEmpty ? nil : rule,
                    editableDraft: projection.editableDraft,
                    storedScheduled: scheduled.isEmpty ? nil : scheduled,
                    start: projection.start, anchor: parsedAnchor
                ) { edit in
                    rule = edit.rule
                    anchor = edit.anchor == .scheduled ? "scheduled" : "completion"
                    if edit.writesScheduled { scheduled = edit.start }
                }
            }
        }
    }
    private var parsedAnchor: FacetRecurrenceAnchor? {
        if anchor == "scheduled" { return .scheduled }
        if anchor == "completion" { return .completion }
        return nil
    }
}
