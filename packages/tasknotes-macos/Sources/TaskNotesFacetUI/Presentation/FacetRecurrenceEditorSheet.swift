import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetRecurrenceEditorSheet: View {
    private enum EndMode: String, CaseIterable {
        case never = "Never"
        case onDate = "On Date"
        case afterCount = "After Count"
    }

    let currentRule: String?
    let calendar: ViewerCalendar
    let onApply: (String, RecurrenceBasis) -> Void
    @State private var basis: RecurrenceBasis
    let onClear: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var frequency: FacetRecurrenceFrequency
    @State private var interval: Int
    @State private var selectedWeekdays: Set<FacetWeekday>
    @State private var endMode: EndMode
    @State private var untilDate: Date
    @State private var occurrenceCount: Int

    init(
        currentRule: String?,
        calendar: ViewerCalendar,
        basis: RecurrenceBasis = .scheduled,
        onApply: @escaping (String, RecurrenceBasis) -> Void,
        onClear: @escaping () -> Void
    ) {
        self.currentRule = currentRule
        self.calendar = calendar
        self.onApply = onApply
        self.onClear = onClear
        _basis = State(initialValue: basis)

        let parsed = currentRule.flatMap(FacetRecurrenceCodec.parse) ?? FacetRecurrenceDraft()
        _frequency = State(initialValue: parsed.frequency)
        _interval = State(initialValue: parsed.interval)
        _selectedWeekdays = State(initialValue: Set(parsed.byDay.map(\.weekday)))

        switch parsed.end {
        case .never:
            _endMode = State(initialValue: .never)
            _untilDate = State(initialValue: calendar.instant)
            _occurrenceCount = State(initialValue: 10)
        case .until(let dateText):
            _endMode = State(initialValue: .onDate)
            let resolved =
                ViewerCalendar.date(fromCivil: dateText, timeZone: calendar.timeZone)
                ?? calendar.instant
            _untilDate = State(initialValue: resolved)
            _occurrenceCount = State(initialValue: 10)
        case .count(let total):
            _endMode = State(initialValue: .afterCount)
            _untilDate = State(initialValue: calendar.instant)
            _occurrenceCount = State(initialValue: max(1, total))
        }
    }

    private var builtDraft: FacetRecurrenceDraft {
        let daySpecs: [FacetByDaySpec]
        if frequency == .weekly && !selectedWeekdays.isEmpty {
            daySpecs = FacetWeekday.mondayFirst
                .filter { selectedWeekdays.contains($0) }
                .map { FacetByDaySpec(weekday: $0) }
        } else {
            daySpecs = []
        }

        let endSpec: FacetRecurrenceEnd
        switch endMode {
        case .never:
            endSpec = .never
        case .onDate:
            endSpec = .until(
                ViewerCalendar.civilDateString(for: untilDate, timeZone: calendar.timeZone)
            )
        case .afterCount:
            endSpec = .count(max(1, occurrenceCount))
        }

        return FacetRecurrenceDraft(
            frequency: frequency,
            interval: interval,
            byDay: daySpecs,
            end: endSpec
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section("Cadence") {
                    Picker("Based on", selection: $basis) {
                        Text("Scheduled date").tag(RecurrenceBasis.scheduled)
                        Text("Completion date").tag(RecurrenceBasis.completion)
                    }
                    Picker("Repeat", selection: $frequency) {
                        ForEach(FacetRecurrenceFrequency.allCases, id: \.self) { item in
                            Text(item.title).tag(item)
                        }
                    }

                    Stepper("Every \(interval) \(unitLabel)", value: $interval, in: 1...99)

                    if frequency == .weekly {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Days of week")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack(spacing: 6) {
                                ForEach(FacetWeekday.mondayFirst, id: \.self) { day in
                                    let active = selectedWeekdays.contains(day)
                                    Button(day.shortName) {
                                        if active {
                                            selectedWeekdays.remove(day)
                                        } else {
                                            selectedWeekdays.insert(day)
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(active ? .accentColor : .secondary)
                                }
                            }
                        }
                    }
                }

                SwiftUI.Section("Ends") {
                    Picker("Ends", selection: $endMode) {
                        ForEach(EndMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }

                    switch endMode {
                    case .never:
                        EmptyView()
                    case .onDate:
                        DatePicker(
                            "End Date",
                            selection: $untilDate,
                            displayedComponents: [.date]
                        )
                    case .afterCount:
                        Stepper(
                            "Occurrences: \(occurrenceCount)",
                            value: $occurrenceCount,
                            in: 1...365
                        )
                    }
                }

                SwiftUI.Section("Summary") {
                    Text(FacetRecurrenceCodec.summary(for: builtDraft))
                        .font(.subheadline.weight(.medium))
                }

                if currentRule != nil {
                    SwiftUI.Section {
                        Button("Stop Repeating", role: .destructive) {
                            onClear()
                            dismiss()
                        }
                        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.stopRepeating)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Repeat")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onApply(builtDraft.rruleString, basis)
                        dismiss()
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceApply)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 420, minHeight: 380)
        #endif
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceSheet)
    }

    private var unitLabel: String {
        switch frequency {
        case .daily: interval == 1 ? "day" : "days"
        case .weekly: interval == 1 ? "week" : "weeks"
        case .monthly: interval == 1 ? "month" : "months"
        case .yearly: interval == 1 ? "year" : "years"
        }
    }
}
