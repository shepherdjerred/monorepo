import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetDeadlineControl: View {
    let task: Task
    let store: FacetStore
    @State private var picking = false
    @State private var selected = Date.now

    var body: some View {
        Button {
            selected =
                task.deadline.flatMap {
                    ViewerCalendar.date(fromCivil: $0, timeZone: store.calendar.timeZone)
                } ?? store.calendar.instant
            picking = true
        } label: {
            Label(
                task.deadline.map { "Deadline · \($0)" } ?? "Deadline",
                systemImage: "flag.checkered")
        }
        .popover(isPresented: $picking) {
            VStack(alignment: .leading, spacing: 14) {
                DatePicker("Deadline", selection: $selected, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.timeZone, store.calendar.timeZone)
                HStack {
                    if task.deadline != nil {
                        Button("Remove", role: .destructive) { save(.clear) }
                    }
                    Spacer()
                    Button("Cancel") { picking = false }
                    Button("Apply") {
                        save(
                            .set(
                                ViewerCalendar.civilDateString(
                                    for: selected, timeZone: store.calendar.timeZone)))
                    }.buttonStyle(.borderedProminent)
                        .tint(FacetNativeStyle.actionFill)
                }
            }
            .padding()
            .presentationCompactAdaptation(.sheet)
            .presentationDetents([.medium, .large])
        }
    }

    private func save(_ value: FacetFieldPatch<String>) {
        store.patchTask(id: task.id, patch: FacetTaskPatch(deadline: value))
        picking = false
    }
}
