import SwiftUI
import TaskNotesKit

internal struct FacetQueryDateField: View {
    let title: String
    let key: String
    @Binding var query: [String: FacetValue]
    @Environment(\.timeZone) private var timeZone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let value = query[key]?.text,
                let date = FacetMobileDateText.date(value, timeZone: timeZone)
            {
                DatePicker(
                    title,
                    selection: Binding(get: { date }, set: { query[key] = .string(day($0)) }),
                    displayedComponents: .date)
                Button("Clear \(title.lowercased())") { query.removeValue(forKey: key) }
            } else {
                HStack {
                    Text(title)
                    Spacer()
                    Button("Choose date…") { query[key] = .string(day(Date.now)) }
                }
                if let value = query[key]?.text {
                    Text(value).font(.caption).textSelection(.enabled)
                    Text("This date needs review. Choose a date to replace it, or clear it.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Clear \(title.lowercased())") { query.removeValue(forKey: key) }
                }
            }
        }.accessibilityIdentifier("facet.query.\(key)")
    }

    private func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
