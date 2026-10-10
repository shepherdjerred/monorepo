import SwiftUI
import TaskNotesKit

internal struct FacetOptionalDatePicker: View {
    let label: String
    let value: String?
    let changed: (FacetValue) -> Void
    private var date: Date? {
        guard let value else { return nil }
        if value.count == 10 {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.isLenient = false
            return formatter.date(from: value)
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                if let date {
                    DatePicker(
                        label,
                        selection: Binding(
                            get: { date },
                            set: {
                                changed(.string(includesTime ? $0.ISO8601Format() : Self.day($0)))
                            }),
                        displayedComponents: includesTime ? [.date, .hourAndMinute] : .date)
                    Button("Clear \(label)", systemImage: "xmark.circle.fill") { changed(.null) }
                        .labelStyle(.iconOnly).buttonStyle(.borderless)
                } else if let value {
                    Text("\(label): \(value)")
                    Text("Open the advanced editor to correct this date.").font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(label)
                    Spacer()
                    Button("Add date…") { changed(.string(Self.day(Date.now))) }.buttonStyle(
                        .borderless)
                }
            }
            if let date {
                Toggle(
                    "Include time",
                    isOn: Binding(
                        get: { includesTime },
                        set: { enabled in
                            changed(.string(enabled ? date.ISO8601Format() : Self.day(date)))
                        })
                ).font(.caption)
            }
        }
    }
    private var includesTime: Bool { (value?.count ?? 0) > 10 }
    private static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
