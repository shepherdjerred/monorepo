import Foundation
import SwiftUI
import TaskNotesKit

internal enum FacetScheduleField: String, CaseIterable {
    case scheduled, due

    var title: String {
        switch self {
        case .scheduled: "Planned"
        case .due: "Deadline"
        }
    }
}

internal struct FacetScheduleSheet: View {
    let store: FacetStore
    let task: FacetTask
    let profileID: String
    let applied: () -> Void
    private let owningEngine: FacetEngine?
    @State private var field: FacetScheduleField
    @State private var selectedDate: Date
    @State private var includesTime = false
    @State private var presets: [FacetSchedulePreset] = []
    @State private var loading = true
    @State private var failure: String?
    @State private var existingDateWarning: String?
    @State private var showsRecovery = false
    @State private var draft = FacetBulkDraft()
    @State private var lifecycleOwner = UUID()
    @Environment(\.dismiss) private var dismiss

    init(
        store: FacetStore, task: FacetTask, profileID: String,
        initialField: FacetScheduleField = .scheduled, applied: @escaping () -> Void = {}
    ) {
        self.store = store
        self.task = task
        self.profileID = profileID
        self.applied = applied
        owningEngine = store.engine
        _field = State(initialValue: initialField)
        _selectedDate = State(initialValue: store.clock.viewerCalendar().instant)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(task.title).font(.headline)
                    Picker("Date", selection: $field) {
                        ForEach(FacetScheduleField.allCases, id: \.self) { choice in
                            Text(choice.title).tag(choice)
                        }
                    }.pickerStyle(.segmented)
                }.disabled(draft.hasRetainedSubmission)
                Section {
                    if loading { ProgressView("Loading dates…") }
                    ForEach(presets) { preset in
                        Button {
                            apply(.string(preset.day))
                        } label: {
                            HStack {
                                Text(preset.label)
                                Spacer()
                                Text(preset.day).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }.accessibilityIdentifier("facet.schedule.\(preset.id)")
                    }
                }.disabled(draft.hasRetainedSubmission)
                Section("Choose a date") {
                    DatePicker("Date", selection: $selectedDate, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                    Toggle("Include time", isOn: $includesTime)
                    if includesTime {
                        DatePicker(
                            "Time", selection: $selectedDate, displayedComponents: .hourAndMinute)
                    }
                    Button("Apply date") {
                        let value =
                            includesTime
                            ? selectedDate.ISO8601Format()
                            : Self.day(selectedDate, zone: store.clock.viewerCalendar().timeZone)
                        apply(.string(value))
                    }.accessibilityIdentifier("facet.schedule.apply")
                    Button("Clear \(field.title.lowercased()) date") { apply(.null) }
                }.disabled(draft.hasRetainedSubmission)
                if let message = draft.error ?? failure ?? existingDateWarning {
                    Section("Date needs attention") {
                        Label(message, systemImage: "exclamationmark.triangle")
                        if draft.hasRetainedSubmission {
                            Button("Retry original date change") {
                                guard draft.beginRetry() else { return }
                                submit()
                            }
                            Button("Saved actions") { showsRecovery = true }
                            Button("Check resolution") {
                                _Concurrency.Task { _ = await draft.releaseResolved() }
                            }
                        } else if failure != nil {
                            Button("Reload date choices") { _Concurrency.Task { await load() } }
                        }
                    }
                }
            }
            .disabled(draft.isSubmitting || FacetDraftCoordinator.shared.isTransitioning)
            .navigationTitle("Schedule task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(draft.isSubmitting || draft.hasRetainedSubmission)
                }
            }
            .sheet(isPresented: $showsRecovery) { FacetCaptureRecoveryView(store: store) }
        }
        .interactiveDismissDisabled(draft.isSubmitting || draft.hasRetainedSubmission)
        .task {
            selectExistingDate()
            await load()
        }
        .onChange(of: field) { selectExistingDate() }
        .onAppear {
            FacetDraftCoordinator.shared.register(
                lifecycleOwner, owner: store, profileID: profileID,
                isDirty: { draft.isSubmitting || draft.hasRetainedSubmission },
                flush: { !draft.isSubmitting && !draft.hasRetainedSubmission })
        }
        .onDisappear { FacetDraftCoordinator.shared.unregister(lifecycleOwner) }
    }

    private func load() async {
        guard let engine = owningEngine, store.engine === engine,
            store.selectedProfileID == profileID
        else {
            failure = "Open this task’s original vault before changing its date."
            loading = false
            return
        }
        loading = true
        defer { loading = false }
        do {
            let choices = try await FacetSchedulePresets.load(
                calendar: store.clock.viewerCalendar()
            ) {
                try await engine.features(profileID: profileID, request: $0)
            }
            guard store.engine === engine, store.selectedProfileID == profileID else { return }
            presets = choices
            failure = nil
        } catch { failure = FacetFailureDiagnostic(error).action }
    }

    private func apply(_ value: FacetValue) {
        guard !draft.hasRetainedSubmission, store.engine === owningEngine,
            let operations = store.bulkOperations(profileID: profileID),
            draft.begin([task], action: .update(field.rawValue, value), operations: operations)
        else { return }
        submit()
    }

    private func submit() {
        _Concurrency.Task {
            if await draft.submit() {
                applied()
                dismiss()
            }
        }
    }

    private static func day(_ date: Date, zone: TimeZone) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: zone).year().month().day())
    }

    private func selectExistingDate() {
        let calendar = store.clock.viewerCalendar()
        guard let raw = task.properties[field.rawValue]?.text else {
            selectedDate = calendar.instant
            includesTime = false
            existingDateWarning = nil
            return
        }
        if raw.count == 10 {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.isLenient = false
            if let date = formatter.date(from: raw), formatter.string(from: date) == raw {
                selectedDate = date
                includesTime = false
                existingDateWarning = nil
                return
            }
        } else {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) {
                selectedDate = date
                includesTime = true
                existingDateWarning = nil
                return
            }
        }
        existingDateWarning =
            "The existing date cannot be displayed. Choose a replacement date or clear it."
    }
}
