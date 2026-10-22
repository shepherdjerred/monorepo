import SwiftUI

internal struct FacetFilters: View {
    @Bindable var store: FacetStore

    var body: some View {
        #if os(iOS)
            HStack {
                scopePicker.pickerStyle(.menu)
                Spacer()
                Menu {
                    statusPicker
                    priorityPicker
                    Toggle("Show completed tasks", isOn: $store.showCompleted)
                    Toggle("Include archived tasks", isOn: $store.includeArchived)
                } label: {
                    Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
                }
            }.padding(.horizontal).padding(.vertical, 8)
        #else
            HStack {
                scopePicker
                statusPicker
                priorityPicker
                Toggle("Completed", isOn: $store.showCompleted)
            }.padding().controlSize(.small)
        #endif
    }

    private var scopePicker: some View {
        Picker("View", selection: $store.scope) {
            Text("All").tag("all")
            Text("Today").tag("today")
            Text("Agenda").tag("agenda")
            Text("Inbox").tag("inbox")
            Text("Upcoming").tag("upcoming")
            Text("Overdue").tag("overdue")
            Text("Completed").tag("completed")
            Text("Undated").tag("undated")
        }
    }

    private var statusPicker: some View {
        Picker("Status", selection: $store.status) {
            Text("All statuses").tag("")
            ForEach(store.statuses, id: \.value) { Text($0.label).tag($0.value) }
        }
    }

    private var priorityPicker: some View {
        Picker("Priority", selection: $store.priority) {
            Text("All priorities").tag("")
            ForEach(store.priorities, id: \.value) { Text($0.label).tag($0.value) }
        }
    }
}
