#if os(iOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileTaskSection<Rows: View>: View {
        let group: FacetTaskGroup
        let store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void
        let showHeader: Bool
        @ViewBuilder var rows: () -> Rows
        @State private var expanded = true

        var body: some View {
            SwiftUI.Section {
                if expanded { rows() }
            } header: {
                if group.isOverdue {
                    HStack {
                        Button {
                            expanded.toggle()
                        } label: {
                            Label(
                                "Overdue", systemImage: expanded ? "chevron.down" : "chevron.right"
                            )
                            .font(.subheadline.bold())
                        }
                        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
                        Spacer()
                        Button("Reschedule") {
                            store.bulkScheduleRequest = FacetBulkScheduleRequest(
                                ids: group.tasks.map(\.id))
                        }
                        .tint(FacetNativeStyle.brand)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.group(group.title))
                } else if showHeader {
                    FacetTaskGroupHeader(group: group, store: store, onPresentModal: onPresentModal)
                }
            }
            .textCase(nil)
        }
    }

    internal struct FacetMobileAgenda: View {
        let store: FacetStore
        let onSelectTask: (Task) -> Void
        let onPresentModal: (FacetPresentedEntityModal) -> Void
        @State private var first = 0
        @State private var span = 28
        @State private var visibleHeaders: [String: CGFloat] = [:]
        @State private var scrolledDay: String?
        @State private var userScrolling = false

        var body: some View {
            VStack(spacing: 0) {
                FacetUpcomingWeekStripView(store: store)
                    .padding(.horizontal, 14)
                ScrollViewReader { scroll in
                    let groups = store.upcomingGroups(
                        from: store.openListPresentationTasks, days: first..<(first + span))
                    List {
                        ForEach(groups) { group in
                            if let day = group.civilDate {
                                dayHeader(group, day: day)
                                    .onAppear {
                                        if group.id == groups.last?.id { span += 28 }
                                    }
                                taskRows(group)
                            } else {
                                FacetMobileTaskSection(
                                    group: group, store: store, onPresentModal: onPresentModal,
                                    showHeader: true
                                ) {
                                    taskRows(group)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .coordinateSpace(name: "agenda")
                    .onPreferenceChange(AgendaHeaderPositions.self) { visibleHeaders = $0 }
                    .onScrollPhaseChange { _, phase in
                        if phase == .interacting { userScrolling = true }
                        if phase == .idle, userScrolling, let day = foremostDay {
                            userScrolling = false
                            scrolledDay = day
                            store.upcomingSelectedDate = day
                        }
                    }
                    .onChange(of: store.upcomingSelectedDate) {
                        let day = store.upcomingSelectedDate ?? store.calendar.today
                        if day == scrolledDay {
                            scrolledDay = nil
                            return
                        }
                        let target = store.upcomingSelectedDayOffset
                        if !(first..<(first + span)).contains(target) {
                            first = target
                            span = 28
                        }
                        _Concurrency.Task { @MainActor in
                            await _Concurrency.Task.yield()
                            scroll.scrollTo(day, anchor: .top)
                        }
                    }
                    .contentMargins(
                        .bottom, FacetNativeStyle.mobileListBottomMargin, for: .scrollContent
                    )
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
                }
            }
            .navigationTitle("Upcoming")
            .navigationBarTitleDisplayMode(.inline)
        }

        private var foremostDay: String? {
            if let current = visibleHeaders.filter({ $0.value <= 2 }).max(by: {
                $0.value < $1.value
            }) {
                return current.key
            }
            return visibleHeaders.min(by: { $0.value < $1.value })?.key
        }

        private func dayHeader(_ group: FacetTaskGroup, day: String) -> some View {
            FacetTaskGroupHeader(group: group, store: store, onPresentModal: onPresentModal)
                .dropDestination(for: String.self) { ids, _ in
                    let tasks = ids.compactMap(store.task(for:))
                    guard !tasks.isEmpty else { return false }
                    store.rescheduleGroup(tasks, to: day)
                    return true
                }
                .background {
                    GeometryReader { geometry in
                        Color.clear.preference(
                            key: AgendaHeaderPositions.self,
                            value: [day: geometry.frame(in: .named("agenda")).minY])
                    }
                }
                .id(day)
        }

        private func taskRows(_ group: FacetTaskGroup) -> some View {
            ForEach(group.tasks) { task in
                FacetTaskRowView(
                    task: task, store: store, showProjectBadge: true, isSelected: false
                ) {
                    onSelectTask(task)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 12))
                .draggable(task.id)
            }
        }
    }

    private enum AgendaHeaderPositions: PreferenceKey {
        static var defaultValue: [String: CGFloat] { [:] }

        static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
            value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
        }
    }
#endif
