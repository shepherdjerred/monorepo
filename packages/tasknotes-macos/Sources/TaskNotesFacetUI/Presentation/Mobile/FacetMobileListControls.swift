#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileListControls: View {
        let store: FacetStore
        @Bindable var window: FacetWindowState
        let snapshot: FacetSnapshot
        @State private var filters = false
        @State private var editedQuery: [String: FacetValue] = [:]
        @Environment(\.dynamicTypeSize) private var dynamicType

        var body: some View {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    sortMenu
                    filterButton
                    Spacer(minLength: 0)
                    selectionButton
                }
                VStack(alignment: .leading, spacing: 8) {
                    sortMenu
                    filterButton
                    selectionButton
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(dynamicType.isAccessibilitySize ? .body : .subheadline)
            .buttonStyle(.bordered)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(.bar)
            .sheet(isPresented: $filters) {
                NavigationStack {
                    Form {
                        FacetQueryEditor(
                            query: $editedQuery, configuration: snapshot.configuration,
                            vocabulary: window.vocabulary)
                        Section {
                            Button("Clear filters") {
                                editedQuery = FacetMobileQueryPolicy.clearedFilters(editedQuery)
                            }
                            .accessibilityIdentifier("facet.filters.clear")
                        }
                    }
                    .navigationTitle("Filters")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { filters = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Apply") {
                                window.replaceQueryOptions(editedQuery)
                                filters = false
                                _Concurrency.Task { await window.reload(store: store) }
                            }.accessibilityIdentifier("facet.filters.apply")
                        }
                    }
                }
            }
        }

        private var filterButton: some View {
            Button(action: editFilters) {
                Label {
                    let count = FacetMobileQueryPolicy.filterCount(
                        window.savedQuery, scope: window.scope)
                    Text(count == 0 ? "Filter" : "Filter (\(count))")
                } icon: {
                    Image(systemName: "line.3.horizontal.decrease")
                }
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Filters")
            .accessibilityIdentifier("facet.filters.open")
        }

        private var selectionButton: some View {
            Button {
                window.isSelecting.toggle()
                window.selectedTaskIDs = []
            } label: {
                Text(window.isSelecting ? "Done" : "Select").frame(minHeight: 44)
            }
            .accessibilityLabel(window.isSelecting ? "Done selecting" : "Select tasks")
            .accessibilityIdentifier("facet.selection.toggle")
        }

        private var sortMenu: some View {
            Menu {
                Button("Default order") { sort(field: nil) }
                Button("Date") { sort(field: "effectiveDate") }
                Button("Due date") { sort(field: "dueDate") }
                Button("Planned date") { sort(field: "scheduledDate") }
                Button("Created date") { sort(field: "createdDate") }
                Button("Completed date") { sort(field: "completedDate") }
                Button("Priority") { sort(field: "priority") }
                Button("Status") { sort(field: "status") }
                Button("Title") { sort(field: "title") }
                Button("Manual order") { sort(field: "manual") }
                Divider()
                Button("Ascending") { direction("asc") }
                Button("Descending") { direction("desc") }
            } label: {
                Label("Sort", systemImage: "slider.horizontal.3").frame(minHeight: 44)
            }
            .accessibilityLabel("Sort options")
            .accessibilityIdentifier("facet.sort.open")
        }

        private func editFilters() {
            do {
                guard case .object(let fields) = try window.query() else {
                    throw FacetContractError.unsupportedResponse
                }
                editedQuery = fields
                filters = true
            } catch { window.error = FacetFailureDiagnostic(error).action }
        }

        private func sort(field: String?) {
            window.savedQuery["sortField"] = field.map(FacetValue.string)
            if field == nil { window.savedQuery.removeValue(forKey: "sortDirection") }
            _Concurrency.Task { await window.reload(store: store) }
        }

        private func direction(_ value: String) {
            window.savedQuery["sortDirection"] = .string(value)
            _Concurrency.Task { await window.reload(store: store) }
        }
    }
#endif
