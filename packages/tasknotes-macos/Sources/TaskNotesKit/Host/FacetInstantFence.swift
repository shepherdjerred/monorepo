import Foundation

/// Compare the producer's civil instant exactly through nanoseconds. `Date`
/// alone rounds neighboring fractional instants at contemporary epoch values.
internal struct FacetInstantFence: Equatable {
    let seconds: Int64
    let nanoseconds: UInt32

    init(_ text: String) throws {
        let pattern =
            "^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$"
        let expression = try NSRegularExpression(pattern: pattern)
        guard
            let match = expression.firstMatch(
                in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)),
            let baseRange = Range(match.range(at: 1), in: text),
            let zoneRange = Range(match.range(at: 3), in: text)
        else { throw FacetContractError.unsupportedResponse }
        let base = String(text[baseRange])
        let zone = String(text[zoneRange])
        let date: Date
        do { date = try Date.ISO8601FormatStyle().parse(base + zone) } catch {
            throw FacetContractError.unsupportedResponse
        }
        guard let wholeSeconds = Int64(exactly: date.timeIntervalSince1970) else {
            throw FacetContractError.unsupportedResponse
        }
        seconds = wholeSeconds
        if let fractionalRange = Range(match.range(at: 2), in: text) {
            let digits = String(text[fractionalRange])
            guard let nanos = UInt32(digits + String(repeating: "0", count: 9 - digits.count))
            else {
                throw FacetContractError.unsupportedResponse
            }
            nanoseconds = nanos
        } else {
            nanoseconds = 0
        }
    }
}
