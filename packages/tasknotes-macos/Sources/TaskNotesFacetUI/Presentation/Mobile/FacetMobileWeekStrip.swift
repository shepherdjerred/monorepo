#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileWeekStrip: View {
        let store: FacetStore
        @Bindable var window: FacetWindowState
        let goToToday: (() -> Void)?

        var body: some View {
            let viewer = store.clock.viewerCalendar()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if let goToToday {
                        Button("Today", action: goToToday)
                            .frame(minWidth: 52, minHeight: 58)
                            .accessibilityIdentifier("facet.upcoming.today")
                    }
                    dayButton("All", number: nil, value: nil, label: "Show all upcoming tasks")
                    ForEach(
                        FacetMobileDateText.week(today: viewer.today, timeZone: viewer.timeZone),
                        id: \.self
                    ) { day in
                        if let date = FacetMobileDateText.date(day, timeZone: viewer.timeZone) {
                            dayButton(
                                FacetMobileDateText.label(
                                    date, template: "EEEEE", timeZone: viewer.timeZone),
                                number: FacetMobileDateText.label(
                                    date, template: "d", timeZone: viewer.timeZone),
                                value: day,
                                label: FacetMobileDateText.heading(
                                    day, today: viewer.today, timeZone: viewer.timeZone))
                        }
                    }
                }.padding(.horizontal, 12).padding(.vertical, 8)
            }
            .accessibilityIdentifier("facet.upcoming.week")
        }

        private func dayButton(_ weekday: String, number: String?, value: String?, label: String)
            -> some View
        {
            let selected = window.savedQuery["effectiveDay"]?.text == value
            return Button {
                window.savedQuery["effectiveDay"] =
                    value == window.savedQuery["effectiveDay"]?.text
                    ? nil : value.map(FacetValue.string)
                window.selectedTaskIDs = []
                _Concurrency.Task { await window.reload(store: store) }
            } label: {
                VStack(spacing: 4) {
                    Text(weekday).font(.caption)
                    if let number { Text(number).font(.subheadline.weight(.semibold)) }
                }
                .frame(minWidth: 48, minHeight: 58)
                .foregroundStyle(selected ? Color.white : Color.primary)
                .background(
                    selected ? FacetNativeStyle.brand : Color.clear,
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .overlay { RoundedRectangle(cornerRadius: 14).stroke(.quaternary) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier("facet.upcoming.day.\(value ?? "all")")
        }
    }
#endif
