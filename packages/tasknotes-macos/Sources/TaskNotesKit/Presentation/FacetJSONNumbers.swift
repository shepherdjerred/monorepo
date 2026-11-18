import Foundation

/// Exact decimal comparisons at typed schema boundaries.
enum FacetJSONNumbers {
    private struct Normalized {
        let negative: Bool
        let coefficient: String
        let exponent: Int
    }

    static func numericByte(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || [45, 43, 46, 69, 101].contains(byte)
    }

    static func isToken(_ token: String) -> Bool {
        let bytes = Array(token.utf8)
        var index = 0
        if index < bytes.count, bytes[index] == 45 { index += 1 }
        guard index < bytes.count else { return false }
        if bytes[index] == 48 {
            index += 1
        } else {
            guard (49...57).contains(bytes[index]) else { return false }
            while index < bytes.count, (48...57).contains(bytes[index]) { index += 1 }
        }
        guard fraction(bytes, index: &index), exponent(bytes, index: &index) else { return false }
        return index == bytes.count
    }

    private static func fraction(_ bytes: [UInt8], index: inout Int) -> Bool {
        if index < bytes.count, bytes[index] == 46 {
            index += 1
            let start = index
            while index < bytes.count, (48...57).contains(bytes[index]) { index += 1 }
            guard index > start else { return false }
        }
        return true
    }

    private static func exponent(_ bytes: [UInt8], index: inout Int) -> Bool {
        if index < bytes.count, bytes[index] == 69 || bytes[index] == 101 {
            index += 1
            if index < bytes.count, bytes[index] == 43 || bytes[index] == 45 { index += 1 }
            let start = index
            while index < bytes.count, (48...57).contains(bytes[index]) { index += 1 }
            guard index > start else { return false }
        }
        return true
    }

    static func isInteger(_ value: FacetValue) -> Bool {
        guard let raw = token(value), let parsed = normalized(raw) else { return false }
        return parsed.coefficient == "0" || parsed.exponent >= 0
    }

    static func compare(_ leftValue: FacetValue, _ rightValue: FacetValue) -> Int? {
        guard let left = token(leftValue).flatMap(normalized),
            let right = token(rightValue).flatMap(normalized)
        else { return nil }
        if left.coefficient == "0", right.coefficient == "0" { return 0 }
        if left.negative != right.negative { return left.negative ? -1 : 1 }
        let order = compareMagnitude(left, right)
        return order.map { left.negative ? -$0 : $0 }
    }

    private static func compareMagnitude(_ left: Normalized, _ right: Normalized) -> Int? {
        if left.coefficient == "0" { return -1 }
        if right.coefficient == "0" { return 1 }
        let leftMagnitude = left.exponent.addingReportingOverflow(left.coefficient.count)
        let rightMagnitude = right.exponent.addingReportingOverflow(right.coefficient.count)
        guard !leftMagnitude.overflow, !rightMagnitude.overflow else { return nil }
        if leftMagnitude.partialValue != rightMagnitude.partialValue {
            return leftMagnitude.partialValue < rightMagnitude.partialValue ? -1 : 1
        }
        return compareDigits(left.coefficient, right.coefficient)
    }

    private static func compareDigits(_ left: String, _ right: String) -> Int {
        let firstDigits = Array(left.utf8)
        let secondDigits = Array(right.utf8)
        for index in 0..<max(firstDigits.count, secondDigits.count) {
            let first: UInt8 = index < firstDigits.count ? firstDigits[index] : 48
            let second: UInt8 = index < secondDigits.count ? secondDigits[index] : 48
            if first != second { return first < second ? -1 : 1 }
        }
        return 0
    }

    private static func token(_ value: FacetValue) -> String? {
        switch value {
        case .integer(let number): String(number)
        case .unsigned(let number): String(number)
        case .number(let number): number.isNaN ? nil : NSDecimalNumber(decimal: number).stringValue
        case .rawNumber(let number): number
        case .null, .bool, .string, .array, .object: nil
        }
    }

    private static func normalized(_ raw: String) -> Normalized? {
        guard isToken(raw) else { return nil }
        var value = raw.lowercased()
        let negative = value.hasPrefix("-")
        if negative { value.removeFirst() }
        let components = value.split(separator: "e", omittingEmptySubsequences: false)
        var exponent = 0
        if components.count == 2 {
            guard let parsed = Int(components[1]) else { return nil }
            exponent = parsed
        }
        let mantissa = components[0].split(separator: ".", omittingEmptySubsequences: false)
        if mantissa.count == 2 {
            let result = exponent.subtractingReportingOverflow(mantissa[1].count)
            guard !result.overflow else { return nil }
            exponent = result.partialValue
        }
        var digits = String(mantissa.joined().drop(while: { $0 == "0" }))
        if digits.isEmpty { return Normalized(negative: false, coefficient: "0", exponent: 0) }
        while digits.last == "0" {
            digits.removeLast()
            let result = exponent.addingReportingOverflow(1)
            guard !result.overflow else { return nil }
            exponent = result.partialValue
        }
        return Normalized(negative: negative, coefficient: digits, exponent: exponent)
    }
}
