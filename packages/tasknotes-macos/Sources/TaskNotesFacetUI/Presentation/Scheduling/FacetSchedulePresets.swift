import Foundation
import TaskNotesKit

internal struct FacetSchedulePreset: Identifiable, Equatable {
    let id: String
    let label: String
    let day: String
}

/// The shell labels date choices; Rust interprets their dates against one
/// captured viewer day, just as it does for natural-language capture.
internal enum FacetSchedulePresets {
    static let choices = [
        ("today", "Today", "today"), ("tomorrow", "Tomorrow", "tomorrow"),
        ("weekend", "This weekend", "this weekend"), ("next-week", "Next week", "next week"),
    ]

    static func load(
        calendar: ViewerCalendar, read: (FacetValue) async throws -> FacetValue
    ) async throws -> [FacetSchedulePreset] {
        var result: [FacetSchedulePreset] = []
        for (id, label, phrase) in choices {
            let preview = try await read(
                .object([
                    "kind": .string("capture_preview"), "input": .string(phrase),
                    "at": .string(calendar.instant.ISO8601Format()),
                    "today": .string(calendar.today),
                ]))
            guard let day = preview.object?.fields["properties"]?.object?.fields["due"]?.text else {
                throw FacetContractError.unsupportedResponse
            }
            result.append(FacetSchedulePreset(id: id, label: label, day: day))
        }
        return result
    }
}
