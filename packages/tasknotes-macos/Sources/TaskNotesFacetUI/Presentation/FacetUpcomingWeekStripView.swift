import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetUpcomingWeekStripView: View {
    let store: FacetStore
    @Environment(\.dynamicTypeSize) private var textSize

    private var accessibilityLayout: Bool { textSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if accessibilityLayout {
                datePicker
                navigationControls
                ScrollViewReader { scroll in
                    ScrollView(.horizontal, showsIndicators: false) { days }
                        .onChange(of: store.upcomingSelectedDayOffset, initial: true) {
                            scroll.scrollTo(store.upcomingSelectedDayOffset, anchor: .center)
                        }
                }
            } else {
                HStack {
                    datePicker
                    Spacer()
                    navigationControls
                }
                days.simultaneousGesture(
                    DragGesture(minimumDistance: 36).onEnded { drag in
                        guard abs(drag.translation.width) > abs(drag.translation.height) else {
                            return
                        }
                        store.upcomingSelectedDayOffset += drag.translation.width < 0 ? 7 : -7
                    })
            }
        }
    }

    private var datePicker: some View {
        DatePicker(
            "Jump to date",
            selection: Binding(
                get: {
                    ViewerCalendar.date(
                        fromCivil: store.upcomingSelectedDate ?? store.calendar.today,
                        timeZone: store.calendar.timeZone) ?? store.calendar.instant
                },
                set: {
                    store.upcomingSelectedDate = ViewerCalendar.civilDateString(
                        for: $0, timeZone: store.calendar.timeZone)
                }
            ), displayedComponents: .date
        )
        .labelsHidden()
        .environment(\.timeZone, store.calendar.timeZone)
    }

    private var navigationControls: some View {
        HStack {
            weekButton(-1)
            if store.upcomingSelectedDayOffset != 0 {
                Button("Today") { store.upcomingSelectedDate = nil }
                    .accessibilityLabel("Return to today")
                    .buttonStyle(.borderless)
            }
            weekButton(1)
        }
    }

    private var days: some View {
        HStack(spacing: 2) {
            ForEach(store.upcomingWeekSlots) { slot in
                let selected = store.upcomingSelectedDayOffset == slot.offset
                Button {
                    store.upcomingSelectedDayOffset = slot.offset
                } label: {
                    VStack(spacing: 4) {
                        Text(slot.weekdayShort)
                            .font(.caption2)
                            .foregroundStyle(selected ? .white : .secondary)
                        Text(slot.dayNumber)
                            .font(.headline)
                            .foregroundStyle(selected ? .white : .primary)
                        Circle()
                            .fill(
                                slot.taskCount > 0
                                    ? (selected ? Color.white : FacetNativeStyle.brand)
                                    : Color.clear
                            )
                            .frame(width: 5, height: 5)
                    }
                    .fixedSize(horizontal: accessibilityLayout, vertical: true)
                    .frame(
                        minWidth: accessibilityLayout ? 74 : nil,
                        maxWidth: accessibilityLayout ? nil : .infinity
                    )
                    .padding(.vertical, 8)
                    .background(
                        selected ? FacetNativeStyle.brand : Color.secondary.opacity(0.08),
                        in: .rect(cornerRadius: 10)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(slot.civilDate)
                .accessibilityLabel(dayName(slot.civilDate))
                .accessibilityValue(slot.taskCount == 1 ? "1 task" : "\(slot.taskCount) tasks")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .facetCaptureTarget(.day(slot.civilDate))
                .id(slot.offset)
            }
        }
    }

    private func dayName(_ civil: String) -> String {
        guard let date = ViewerCalendar.date(fromCivil: civil, timeZone: store.calendar.timeZone)
        else { return civil }
        return date.formatted(
            Date.FormatStyle(date: .complete, time: .omitted, timeZone: store.calendar.timeZone))
    }

    private func weekButton(_ direction: Int) -> some View {
        Button {
            store.upcomingSelectedDayOffset += direction * 7
        } label: {
            Image(systemName: direction < 0 ? "chevron.left" : "chevron.right")
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(direction < 0 ? "Previous week" : "Next week")
    }
}
