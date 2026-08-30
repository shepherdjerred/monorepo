internal import SwiftUI
internal import TaskNotesKit

internal import struct Foundation.Calendar
internal import struct Foundation.Date
internal import struct Foundation.TimeZone

/// The scheduling surface, as a popover anchored to the control that opened it.
///
/// The React Native app raises a bottom sheet, which is a phone answer to "the
/// screen is small and the thumb is at the bottom". Neither is true here. A
/// popover keeps the row it belongs to visible and on screen, points at it, and
/// dismisses on click-away or Escape without any code — which is what makes the
/// association obvious instead of asserted.
struct SchedulePopover: View {
    /// The date currently set, so the calendar opens where the task already is.
    let current: String?

    /// A named choice — today, tomorrow, this weekend, next week, no date.
    let onChoose: (ScheduleChoice) -> Void

    /// An arbitrary date from the calendar, as `YYYY-MM-DD`.
    let onPick: (String?) -> Void

    @State private var picked: Date

    init(
        current: String?,
        onChoose: @escaping (ScheduleChoice) -> Void,
        onPick: @escaping (String?) -> Void
    ) {
        self.current = current
        self.onChoose = onChoose
        self.onPick = onPick
        _picked = State(initialValue: Self.initialDate(current: current))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(ScheduleChoice.allCases, id: \.self) { choice in
                Button {
                    onChoose(choice)
                } label: {
                    Label(choice.title, systemImage: choice.systemImage)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier(AccessibilityIdentifier.Schedule.shortcut(choice.rawValue))
            }

            Divider()

            DatePicker(
                "Pick a date",
                selection: $picked,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .labelsHidden()
            .accessibilityIdentifier(AccessibilityIdentifier.Schedule.picker)
            .onChange(of: picked) { _, chosen in
                guard let selected = Self.changedDate(chosen, from: current) else { return }
                onPick(selected)
            }
        }
        .padding(12)
        .frame(width: 260)
        // ⚠️ `.contain`. The popover *is* five buttons and a calendar;
        // `.combine` would flatten the entire scheduling surface into one
        // unpressable element.
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Schedule")
        .accessibilityIdentifier(AccessibilityIdentifier.Schedule.popover)
    }

    static func initialDate(current: String?, now: Date = Date()) -> Date {
        current.flatMap(CivilDay.date(of:)) ?? now
    }

    static func changedDate(_ chosen: Date, from current: String?) -> String? {
        let selected = CivilDay.iso(of: chosen)
        return selected == current ? nil : selected
    }
}

/// Carrying a civil date through `DatePicker`, which only speaks `Date`.
///
/// Pinned to the **viewer's own zone** at both ends, which is the opposite of
/// `TaskDateText`'s GMT pinning and correct for the opposite reason. There the
/// `Date` is a carrier for a string that already exists and must not move; here
/// the user is pointing at a square on a calendar drawn in their zone, so "the
/// day they pointed at" is a local reading. Formatting and parsing both in
/// `.current` makes the round trip exact.
///
/// The zone is read per call rather than captured, so a user who changes zone
/// mid-session picks dates in the zone they are actually in.
enum CivilDay {
    private static var iso: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(timeZone: .current).year().month().day()
    }

    /// The civil day a picked instant falls on, for this viewer.
    static func iso(of date: Date) -> String {
        iso.format(date)
    }

    /// Local midnight on a civil day, so the picker opens on the right square.
    ///
    /// `nil` for anything that is not a civil date. The only caller uses it to
    /// decide whether to move the picker at all, so a miss leaves it on today
    /// — which is a presentation default, not a data fallback.
    static func date(of civil: String) -> Date? {
        switch Result(catching: { try iso.parse(civil) }) {
        case .success(let date): return date
        case .failure: return nil
        }
    }
}
