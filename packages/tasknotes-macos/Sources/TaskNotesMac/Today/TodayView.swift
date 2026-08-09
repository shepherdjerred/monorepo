internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

internal import struct Foundation.Date
internal import struct Foundation.DateComponents

/// The Today screen.
///
/// ## What was translated, and what was deleted
///
/// The React Native screen's *capabilities* are all here — today plus overdue,
/// the day heading with a count, the "all clear" celebration that only appears
/// after an interaction, completion, deletion, scheduling, priority, bulk
/// actions, refresh, create. Its *interactions* are not: swipes, a floating
/// action button, pull-to-refresh, a bottom sheet, an explicit selection mode
/// and a bulk action bar are all touch scaffolding, and each has a desktop
/// idiom that already exists and is better.
///
/// The one that changes the shape of the screen most is **multi-select**. The
/// touch app needs a mode — tap to open, or tap to select, never both — so it
/// has an "enter selection" button and a bar of bulk actions at the bottom. A
/// `List` with a `Set` selection has ⌘-click and ⇧-click natively, needs no
/// mode at all, and `contextMenu(forSelectionType:)` then applies the *same*
/// menu to one row or to fifty. So the bulk action bar is not ported, it is
/// deleted, and nothing is lost.
///
/// ## Scrolling is `List`'s, on purpose
///
/// Momentum, rubber-banding, Page Up/Down, Home/End, live scroll bars, and the
/// selection de-emphasis when the list loses focus all come from `NSTableView`
/// underneath. A hand-rolled `ScrollView` of rows loses every one of them
/// silently, which is why this is a `List` even though the row content is
/// custom.
struct TodayView: View {
    let store: TaskNotesStore

    /// The viewer's day and offset, held rather than re-read per redraw so the
    /// heading, the buckets, and every completion target describe one instant.
    @State private var calendar: ViewerCalendar

    @State private var selection: Set<TaskId> = []
    @State private var composeText = ""
    @State private var isComposing = false
    @State private var isRefreshing = false

    /// Whether anything has been completed on this screen in this session.
    ///
    /// The whole point of the "all clear" celebration is that it distinguishes
    /// *you cleared the day* from *there was never anything here*, and only
    /// this flag can tell those apart.
    @State private var hasInteracted = false

    @FocusState private var isComposeFocused: Bool

    init(store: TaskNotesStore) {
        self.store = store
        _calendar = State(initialValue: store.viewerCalendar())
    }

    var body: some View {
        content
            .navigationTitle("Today")
            .navigationSubtitle(subtitle)
            .toolbar { toolbar }
            .focusedSceneValue(\.taskListActions, actions)
            .task(id: calendar.today) { await rollOverAtMidnight() }
            .accessibilityIdentifier(AccessibilityIdentifier.detail(.today))
    }

    @ViewBuilder
    private var content: some View {
        switch derived {
        case .success(let list):
            VStack(spacing: 0) {
                if let message = SyncMessage.of(
                    status: store.status,
                    pendingCount: store.pendingCount,
                    storeError: store.lastStoreError
                ) {
                    SyncBannerView(message: message, onRetry: refresh)
                    Divider()
                }
                TodayHeader(list: list)
                Divider()
                if isComposing {
                    TaskComposeRow(
                        text: $composeText,
                        focus: $isComposeFocused,
                        onSubmit: create,
                        onCancel: cancelCompose
                    )
                    Divider()
                }
                if list.isEmpty {
                    TodayEmptyState(hasInteracted: hasInteracted, onNewTask: beginCompose)
                } else {
                    rows(list)
                }
            }
        case .failure(let error):
            // A derivation failure means the core rejected the vault's own
            // data. That is not a banner — nothing below it would be
            // trustworthy — so the screen says so instead of rendering a
            // plausible subset.
            ContentUnavailableView {
                Label("This list cannot be shown", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error.userMessage)
            }
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.empty)
        }
    }

    // ── Pieces ─────────────────────────────────────────────────────────────

    private func rows(_ list: TodayList) -> some View {
        List(list.rows, selection: $selection) { row in
            TaskRowView(
                row: row,
                onToggle: { toggle(row) },
                onDelete: { delete([row.id]) },
                onSchedule: { schedule([row.id], to: $0) },
                onScheduleDate: { scheduleDate([row.id], to: $0) }
            )
            .tag(row.id)
        }
        .listStyle(.inset)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        // One menu that serves both a right-click on a single row and a
        // right-click inside a multi-selection. This is what replaces the
        // touch app's selection mode and bulk action bar outright — and it is
        // also where `onTaskEdit` and `onTaskSetPriority`, which are dead code
        // in the React Native app because nothing ever passes them, finally
        // reach a user.
        .contextMenu(forSelectionType: TaskId.self) { ids in
            TaskRowMenu(
                targets: list.rows.filter { ids.contains($0.id) },
                onNewTask: beginCompose,
                onToggle: { rows in for row in rows { toggle(row) } },
                onSchedule: { schedule(ids, to: $0) },
                onPriority: { setPriority(ids, to: $0) },
                onDelete: { delete(ids) }
            )
        }
        // Space completes, matching the brief. `NSTableView` leaves it unbound
        // and SwiftUI's `List` implements no type-select on macOS, so nothing
        // is being taken away from the user here.
        .onKeyPress(.space) {
            guard !selection.isEmpty else { return .ignored }
            completeSelection(in: list)
            return .handled
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button("New Task", systemImage: "plus") { beginCompose() }
                .help("New Task (⌘N)")
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)
        }
        ToolbarItem(placement: .primaryAction) {
            Button("Refresh", systemImage: "arrow.clockwise") { refresh() }
                .help("Refresh (⌘R)")
                .disabled(isRefreshing)
                // The spinner state the touch app got from pull-to-refresh,
                // kept rather than dropped: the gesture is gone, the feedback
                // that work is happening is not.
                .symbolEffect(.rotate, options: .repeating, isActive: isRefreshing)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.refresh)
        }
    }

    // ── Derivation ─────────────────────────────────────────────────────────

    private var derived: Result<TodayList, CoreError> {
        TodayList.of(
            tasks: store.tasks,
            pendingTaskIds: store.pendingTaskIds,
            calendar: calendar
        )
    }

    private var subtitle: String {
        store.pendingCount == 0 ? "TaskNotes" : "\(store.pendingCount) waiting to sync"
    }

    // ── Actions ────────────────────────────────────────────────────────────

    private var actions: TaskListActions {
        TaskListActions(
            newTask: beginCompose,
            refresh: refresh,
            complete: { if case .success(let list) = derived { completeSelection(in: list) } },
            delete: { delete(selection) },
            hasSelection: !selection.isEmpty,
            isRefreshing: isRefreshing
        )
    }

    private func beginCompose() {
        isComposing = true
        isComposeFocused = true
    }

    private func cancelCompose() {
        composeText = ""
        isComposing = false
        isComposeFocused = false
    }

    private func create() {
        switch QuickAdd.parsing(composeText, calendar: calendar) {
        case .success(let command):
            guard let command else {
                cancelCompose()
                return
            }
            store.dispatch(command)
            composeText = ""
            // Focus is kept rather than dismissed: adding three tasks in a row
            // is the common case, and a field that closes after each one turns
            // that into three ⌘N presses.
            isComposeFocused = true
            settle()
        case .failure(let error):
            store.report(error)
        }
    }

    private func toggle(_ row: TaskRowState) {
        hasInteracted = true
        withAnimation(.snappy(duration: 0.2)) {
            _ = store.dispatch(row.completionCommand)
        }
        settle()
    }

    private func completeSelection(in list: TodayList) {
        for row in list.rows where selection.contains(row.id) {
            toggle(row)
        }
    }

    private func delete(_ ids: Set<TaskId>) {
        withAnimation(.snappy(duration: 0.2)) {
            for id in ids {
                store.dispatch(.delete(taskId: id))
            }
        }
        selection.subtract(ids)
        settle()
    }

    private func schedule(_ ids: Set<TaskId>, to choice: ScheduleChoice) {
        switch choice.resolving(on: calendar) {
        case .success(let date): scheduleDate(ids, to: date)
        case .failure(let error): store.report(error)
        }
    }

    private func scheduleDate(_ ids: Set<TaskId>, to date: String?) {
        for id in ids {
            store.dispatch(.update(taskId: id, payload: .settingDue(date)))
        }
        settle()
    }

    private func setPriority(_ ids: Set<TaskId>, to priority: Priority) {
        for id in ids {
            store.dispatch(.update(taskId: id, payload: .settingPriority(priority)))
        }
        settle()
    }

    /// Run the pass a dispatch armed, without blocking the gesture on it.
    ///
    /// `autoSync` arms a pass on every dispatch but runs nothing; this is what
    /// makes work actually happen. Detached from the caller so a burst of
    /// dispatches — a bulk complete over fifty rows — coalesces into one drain
    /// instead of fifty.
    private func settle() {
        _Concurrency.Task { await store.settle() }
    }

    private func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        _Concurrency.Task {
            await store.sync()
            calendar = store.viewerCalendar()
            isRefreshing = false
        }
    }

    /// Re-read the viewer's day shortly after the next local midnight.
    ///
    /// Without this, a window left open overnight keeps showing yesterday —
    /// the heading, the overdue colouring, and every completion target all stay
    /// on the previous day, and nothing on screen suggests they are stale. The
    /// `.task(id:)` re-arms because its identity is the day it is waiting past.
    private func rollOverAtMidnight() async {
        guard let midnight = Self.nextMidnight() else { return }
        let seconds = midnight.timeIntervalSinceNow + 1
        guard seconds > 0 else { return }
        switch await Result(catching: {
            try await _Concurrency.Task.sleep(for: .seconds(seconds))
        }) {
        case .success: calendar = store.viewerCalendar()
        // Cancelled, because the view went away. Nothing to do and nothing to
        // report — this is the one place a discarded error is the whole design.
        case .failure: return
        }
    }

    private static func nextMidnight() -> Date? {
        Foundation.Calendar.autoupdatingCurrent.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime
        )
    }
}
