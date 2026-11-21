import SwiftUI
import TaskNotesKit

internal struct FacetOverdueHeader: View {
    let store: FacetStore
    let group: FacetTaskGroup
    @Binding var expanded: Bool
    @State private var choosing = false
    @State private var date = Date.now

    var body: some View {
        HStack {
            Button {
                expanded.toggle()
            } label: {
                Label(group.title, systemImage: expanded ? "chevron.down" : "chevron.right")
                    .font(.headline)
            }
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            Spacer()
            Button("Reschedule") {
                date = store.calendar.instant
                choosing = true
            }
            .foregroundStyle(FacetNativeStyle.brand)
            .popover(isPresented: $choosing) {
                VStack(alignment: .trailing) {
                    DatePicker("New date", selection: $date, displayedComponents: .date)
                        .environment(\.timeZone, store.calendar.timeZone)
                        .datePickerStyle(.graphical)
                    Button("Apply") {
                        let civil = ViewerCalendar.civilDateString(
                            for: date, timeZone: store.calendar.timeZone)
                        store.rescheduleGroup(group.tasks, to: civil)
                        choosing = false
                    }
                }
                .padding()
            }
        }
        .buttonStyle(.borderless)
    }
}
