#if os(iOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal struct FacetBulkScheduleRequest: Identifiable {
        let id = UUID()
        let ids: [String]
    }

    internal struct FacetBulkScheduleSheet: View {
        let store: FacetStore
        let request: FacetBulkScheduleRequest
        @State private var pickedDay: Date

        init(store: FacetStore, request: FacetBulkScheduleRequest) {
            self.store = store
            self.request = request
            _pickedDay = State(initialValue: store.calendar.instant)
        }

        var body: some View {
            NavigationStack {
                ScrollView {
                    DatePicker("New date", selection: $pickedDay, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .environment(\.timeZone, store.calendar.timeZone)
                        .padding(.horizontal)
                }
                .navigationTitle("Reschedule \(request.ids.count) tasks")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { store.bulkScheduleRequest = nil }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Apply") {
                            let day = ViewerCalendar.civilDateString(
                                for: pickedDay, timeZone: store.calendar.timeZone)
                            store.rescheduleGroup(request.ids.compactMap(store.task(for:)), to: day)
                            store.bulkScheduleRequest = nil
                        }
                    }
                }
            }
            .tint(FacetNativeStyle.brand)
            .presentationDetents([.height(490), .large])
        }
    }
#endif
