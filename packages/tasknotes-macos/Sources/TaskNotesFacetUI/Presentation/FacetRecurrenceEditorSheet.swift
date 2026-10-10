internal import SwiftUI
internal import TaskNotesKit

internal import struct Foundation.Date

/// The scoped common-pattern recurrence editor.
///
/// The Swift state below is presentation state only. Validation, parsing and
/// RRULE construction cross the shared-core boundary; no RFC grammar lives in
/// the app target.
struct FacetRecurrenceEditorSheet: View {
    let existingRule: String?
    let storedScheduled: String?
    let initialStart: String
    let onApply: (FacetRecurrenceEdit) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var isReplacingUnsupported: Bool
    @State private var cadence: FacetRecurrenceCadence
    @State private var interval: UInt32
    @State private var weekdays: Set<FacetCommonWeekday>
    @State private var monthlyMode: FacetRecurrenceMonthlyMode
    @State private var monthDay: UInt8
    @State private var ordinal: FacetMonthlyOrdinal
    @State private var ordinalWeekday: FacetCommonWeekday
    @State private var yearlyMonth: UInt8
    @State private var yearlyDay: UInt8
    @State private var ending: FacetRecurrenceEnding
    @State private var occurrenceCount: UInt32
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var anchor: FacetRecurrenceAnchor
    @State private var validationMessage: String?
    @State private var invalidInitialStart: Bool
    @State private var isApplying = false

    private let unsupported: Bool

    init(
        existingRule: String?,
        editableDraft: FacetCommonRecurrenceDraft?,
        storedScheduled: String?,
        start: String,
        anchor: FacetRecurrenceAnchor,
        onApply: @escaping (FacetRecurrenceEdit) -> Void
    ) {
        self.existingRule = existingRule
        self.storedScheduled = storedScheduled
        initialStart = start
        self.onApply = onApply
        unsupported = existingRule != nil && editableDraft == nil
        _isReplacingUnsupported = State(initialValue: existingRule == nil || editableDraft != nil)

        let seedDraft =
            editableDraft
            ?? FacetCommonRecurrenceDraft(
                interval: 1,
                pattern: .daily,
                ending: .never
            )
        let pattern = FacetRecurrencePatternSeed(pattern: seedDraft.pattern, start: start)
        let parsedStartDate = FacetCivilDay.date(of: start)
        let initialStartDate = parsedStartDate ?? Date(timeIntervalSince1970: 0)
        let end = FacetFacetRecurrenceEndingSeed(
            ending: seedDraft.ending, startDate: initialStartDate)
        _interval = State(initialValue: seedDraft.interval)
        _cadence = State(initialValue: pattern.cadence)
        _weekdays = State(initialValue: pattern.weekdays)
        _monthlyMode = State(initialValue: pattern.monthlyMode)
        _monthDay = State(initialValue: pattern.monthDay)
        _ordinal = State(initialValue: pattern.ordinal)
        _ordinalWeekday = State(initialValue: pattern.ordinalWeekday)
        _yearlyMonth = State(initialValue: pattern.yearlyMonth)
        _yearlyDay = State(initialValue: pattern.yearlyDay)
        _startDate = State(initialValue: initialStartDate)
        _anchor = State(initialValue: anchor)
        _ending = State(initialValue: end.ending)
        _endDate = State(initialValue: end.date)
        _occurrenceCount = State(initialValue: end.count)
        _invalidInitialStart = State(initialValue: parsedStartDate == nil)
        _validationMessage = State(
            initialValue: parsedStartDate == nil
                ? "The stored Scheduled date is invalid. Choose a valid date before applying."
                : nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                if unsupported && !isReplacingUnsupported {
                    Section("Stored Rule") {
                        Text("This rule uses recurrence fields the common editor cannot preserve.")
                            .foregroundStyle(.secondary)
                        if let storedRule = existingRule {
                            Text(storedRule)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        Button("Replace with a Common Pattern") {
                            isReplacingUnsupported = true
                        }
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.Inspector.recurrenceReplace)
                    }
                } else {
                    recurrenceFields
                }
            }
            .formStyle(.grouped)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Apply", action: apply)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!isReplacingUnsupported || invalidInitialStart || isApplying)
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceApply)
            }
            .padding()
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        #if os(macOS)
            .frame(minWidth: 420, idealWidth: 480, minHeight: 520, idealHeight: 610)
        #endif
        .interactiveDismissDisabled()
        // Keep the sheet identifier on this container. Without `.contain`,
        // SwiftUI pushes it down and replaces the Apply button identifier when
        // the form changes shape (for example, Daily to Weekly).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceSheet)
    }
}

extension FacetRecurrenceEditorSheet {
    @ViewBuilder
    fileprivate var recurrenceFields: some View {
        Section("Starts") {
            DatePicker("Scheduled", selection: $startDate, displayedComponents: .date)
                .onChange(of: startDate) { _, _ in
                    invalidInitialStart = false
                    if validationMessage?.hasPrefix("The stored Scheduled date") == true {
                        validationMessage = nil
                    }
                }
            Picker("Measured From", selection: $anchor) {
                Text("Scheduled Date")
                    .tag(FacetRecurrenceAnchor.scheduled)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Inspector.recurrenceAnchorOption("scheduled"))
                Text("Completion Date")
                    .tag(FacetRecurrenceAnchor.completion)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Inspector.recurrenceAnchorOption("completion"))
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceAnchor)
        }

        Section("Pattern") {
            Picker("Frequency", selection: $cadence) {
                ForEach(FacetRecurrenceCadence.allCases) { value in
                    Text(value.label)
                        .tag(value)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.Inspector.recurrenceFrequencyOption(
                                value.rawValue))
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceFrequency)
            Stepper(value: $interval, in: 1...999) {
                Text("Every \(interval) \(unitLabel)")
            }

            switch cadence {
            case .daily:
                EmptyView()
            case .weekly:
                weekdaySelection
            case .monthly:
                monthlySelection
            case .yearly:
                yearlySelection
            }
        }

        Section("Ends") {
            Picker("Ending", selection: $ending) {
                ForEach(FacetRecurrenceEnding.allCases) { value in
                    Text(value.label).tag(value)
                }
            }
            switch ending {
            case .never:
                EmptyView()
            case .onDate:
                DatePicker("End Date", selection: $endDate, displayedComponents: .date)
            case .afterOccurrences:
                Stepper(value: $occurrenceCount, in: 1...10_000) {
                    Text("\(occurrenceCount) occurrences")
                }
            }
        }

        if let validationMessage {
            Section {
                Label(validationMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }
        }
    }

    fileprivate var weekdaySelection: some View {
        HStack {
            ForEach(Self.allWeekdays, id: \.self) { weekday in
                Toggle(Self.shortLabel(weekday), isOn: weekdayBinding(weekday))
                    .toggleStyle(.button)
                    .help(Self.longLabel(weekday))
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceWeekdays)
    }

    @ViewBuilder
    fileprivate var monthlySelection: some View {
        Picker("On", selection: $monthlyMode) {
            ForEach(FacetRecurrenceMonthlyMode.allCases) { mode in
                Text(mode.label).tag(mode)
            }
        }
        switch monthlyMode {
        case .dayOfMonth:
            Stepper("Day \(monthDay)", value: $monthDay, in: 1...31)
        case .ordinalWeekday:
            Picker("Occurrence", selection: $ordinal) {
                ForEach(Self.allOrdinals, id: \.self) { value in
                    Text(Self.ordinalLabel(value)).tag(value)
                }
            }
            Picker("Weekday", selection: $ordinalWeekday) {
                ForEach(Self.allWeekdays, id: \.self) { value in
                    Text(Self.longLabel(value)).tag(value)
                }
            }
        }
    }

    fileprivate var yearlySelection: some View {
        HStack {
            Picker("Month", selection: $yearlyMonth) {
                ForEach(UInt8(1)...UInt8(12), id: \.self) { value in
                    Text(Self.monthLabel(value)).tag(value)
                }
            }
            Stepper("Day \(yearlyDay)", value: $yearlyDay, in: 1...31)
        }
    }

    fileprivate var unitLabel: String {
        let singular: String
        switch cadence {
        case .daily: singular = "day"
        case .weekly: singular = "week"
        case .monthly: singular = "month"
        case .yearly: singular = "year"
        }
        return interval == 1 ? singular : "\(singular)s"
    }

    fileprivate func weekdayBinding(_ weekday: FacetCommonWeekday) -> Binding<Bool> {
        Binding(
            get: { weekdays.contains(weekday) },
            set: { selected in
                if selected {
                    weekdays.insert(weekday)
                } else {
                    weekdays.remove(weekday)
                }
            }
        )
    }

    fileprivate var draft: FacetCommonRecurrenceDraft {
        let pattern: FacetCommonRecurrencePattern
        switch cadence {
        case .daily:
            pattern = .daily
        case .weekly:
            pattern = .weekly(weekdays: Self.allWeekdays.filter(weekdays.contains))
        case .monthly:
            switch monthlyMode {
            case .dayOfMonth:
                pattern = .monthlyDayOfMonth(day: monthDay)
            case .ordinalWeekday:
                pattern = .monthlyOrdinalWeekday(ordinal: ordinal, weekday: ordinalWeekday)
            }
        case .yearly:
            pattern = .yearlyMonthDay(month: yearlyMonth, day: yearlyDay)
        }
        let recurrenceEnd: FacetCommonRecurrenceEnd
        switch ending {
        case .never:
            recurrenceEnd = .never
        case .onDate:
            recurrenceEnd = .onDate(FacetCivilDay.iso(of: endDate))
        case .afterOccurrences:
            recurrenceEnd = .afterOccurrences(occurrenceCount)
        }
        return FacetCommonRecurrenceDraft(
            interval: interval, pattern: pattern, ending: recurrenceEnd)
    }

    fileprivate func apply() {
        guard !invalidInitialStart else {
            validationMessage =
                "The stored Scheduled date is invalid. Choose a valid date before applying."
            return
        }
        let selectedStart = FacetCivilDay.iso(of: startDate)
        let submittedDraft = draft
        let submittedAnchor = anchor
        let writesScheduled = storedScheduled == nil || selectedStart != initialStart
        isApplying = true
        _Concurrency.Task {
            let result = await _Concurrency.Task.detached {
                FacetRecurrenceEdit.build(
                    draft: submittedDraft, start: selectedStart, anchor: submittedAnchor,
                    writesScheduled: writesScheduled)
            }.value
            isApplying = false
            switch result {
            case .success(let edit):
                validationMessage = nil
                onApply(edit)
                dismiss()
            case .failure(let error):
                validationMessage = error.userMessage
            }
        }
    }
}
