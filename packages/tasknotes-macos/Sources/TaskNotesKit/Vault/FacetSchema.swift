public import Foundation

/// Evaluates the normative contract's JSON Schema keywords at the native seam.
/// Schema resources link to the shared source instead of maintaining copies.
public struct FacetSchema: Sendable {
    private let definitions: [String: FacetValue]

    public init(data: Data) throws {
        let root = try FacetJSON.parse(data)
        guard let rules = root.object?.fields["$defs"]?.object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        self.definitions = rules
        for definition in rules.values { try inspect(definition) }
    }

    public static func bundled() throws -> FacetSchema {
        guard let url = Bundle.module.url(forResource: "FacetContractSchema", withExtension: "json")
        else { throw FacetContractError.unsupportedResponse }
        return try FacetSchema(data: Data(contentsOf: url))
    }

    public func validate(_ value: FacetValue, definition: String) throws {
        guard let rule = definitions[definition]?.object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        try check(rule, value)
    }

    public func validate(json: String, definition: String) throws {
        let data = Data(json.utf8)
        try validate(FacetJSON.parse(data), definition: definition)
    }

    private func require(_ condition: Bool) throws {
        if !condition { throw FacetContractError.unsupportedResponse }
    }

    private func inspect(_ value: FacetValue) throws {
        if case .bool = value { return }
        guard let rule = value.object?.fields else { throw FacetContractError.unsupportedResponse }
        let supported: Set<String> = [
            "$ref", "$schema", "$id", "$defs", "$comment", "title", "description", "default",
            "examples",
            "const", "enum", "anyOf", "oneOf", "allOf", "not", "type", "properties", "required",
            "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "minLength",
            "maxLength", "pattern", "format", "minimum", "maximum",
        ]
        try require(rule.keys.allSatisfy { supported.contains($0) })
        for keyword in ["properties", "$defs"] {
            if let children = rule[keyword]?.object?.fields {
                for child in children.values { try inspect(child) }
            }
        }
        for keyword in ["items", "not", "additionalProperties"] {
            if let child = rule[keyword] { try inspect(child) }
        }
        for keyword in ["anyOf", "oneOf", "allOf"] {
            if let children = rule[keyword]?.array?.elements {
                for child in children { try inspect(child) }
            }
        }
    }

    private func check(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        try checkIdentity(rule, value)
        try checkComposition(rule, value)
        try checkObject(rule, value)
        try checkArray(rule, value)
        try checkString(rule, value)
        try checkBounds(rule, value)
    }

    private func checkIdentity(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if let reference = rule["$ref"]?.text {
            try require(reference.hasPrefix("#/$defs/"))
            try validate(value, definition: String(reference.dropFirst("#/$defs/".count)))
        }
        if let constant = rule["const"] { try require(equal(constant, value)) }
        if let values = rule["enum"]?.array?.elements {
            try require(values.contains { equal($0, value) })
        }
        if let type = rule["type"] {
            let choices = type.array?.elements ?? [type]
            try require(choices.contains { matches($0.text, value) })
        }
    }

    private func checkComposition(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if let rules = rule["allOf"]?.array?.elements {
            for child in rules { try evaluate(child, value) }
        }
        if let excluded = rule["not"]?.object?.fields {
            let matches: Bool
            do {
                try check(excluded, value)
                matches = true
            } catch { matches = false }
            try require(!matches)
        }
        try checkAlternatives(rule, value)
    }

    private func evaluate(_ schema: FacetValue, _ value: FacetValue) throws {
        if case .bool(let permitted) = schema {
            try require(permitted)
            return
        }
        guard let rule = schema.object?.fields else { throw FacetContractError.unsupportedResponse }
        try check(rule, value)
    }

    private func checkAlternatives(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        for keyword in ["anyOf", "oneOf"] {
            if let alternatives = rule[keyword]?.array?.elements {
                let count = try alternatives.filter { candidate in
                    do {
                        try evaluate(candidate, value)
                        return true
                    } catch is FacetContractError { return false }
                }.count
                try require(keyword == "oneOf" ? count == 1 : count >= 1)
            }
        }
    }

    private func checkObject(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if case .object(let fields) = value {
            let properties = rule["properties"]?.object?.fields ?? [:]
            if let required = rule["required"]?.array?.elements {
                for key in required { try require(key.text.map { fields[$0] != nil } ?? false) }
            }
            if rule["additionalProperties"] == .bool(false) {
                try require(fields.keys.allSatisfy { properties[$0] != nil })
            }
            for (name, child) in fields {
                if let property = properties[name] { try evaluate(property, child) }
            }
            if let additional = rule["additionalProperties"]?.object?.fields {
                for (name, child) in fields where properties[name] == nil {
                    try check(additional, child)
                }
            }
        }
    }

    private func checkArray(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if case .array(let values) = value {
            if let items = rule["items"]?.object?.fields {
                for child in values { try check(items, child) }
            }
            if let minimum = rule["minItems"].flatMap(number) {
                try require(Decimal(values.count) >= minimum)
            }
            if let maximum = rule["maxItems"].flatMap(number) {
                try require(Decimal(values.count) <= maximum)
            }
            if rule["uniqueItems"] == .bool(true) {
                for (index, child) in values.enumerated() {
                    try require(!values.prefix(index).contains { equal($0, child) })
                }
            }
        }
    }

    private func checkString(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if let text = value.text {
            let length = Decimal(text.unicodeScalars.count)
            if let minimum = rule["minLength"].flatMap(number) { try require(length >= minimum) }
            if let maximum = rule["maxLength"].flatMap(number) { try require(length <= maximum) }
            if let pattern = rule["pattern"]?.text {
                let expression = try NSRegularExpression(pattern: pattern)
                try require(
                    expression.firstMatch(
                        in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)) != nil)
            }
            if let format = rule["format"]?.text { try checkFormat(text, format: format) }
        }
    }

    private func checkFormat(_ text: String, format: String) throws {
        let formatter = ISO8601DateFormatter()
        if format == "date" {
            formatter.formatOptions = [.withFullDate, .withDashSeparatorInDate]
            guard let date = formatter.date(from: text), formatter.string(from: date) == text else {
                throw FacetContractError.unsupportedResponse
            }
        } else {
            try require(format == "date-time")
            let timestamp =
                #"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"#
                + #"(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])\z"#
            try require(text.range(of: timestamp, options: .regularExpression) != nil)
            try checkWrittenDate(text)
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if formatter.date(from: text) == nil {
                formatter.formatOptions = [.withInternetDateTime]
                try require(formatter.date(from: text) != nil)
            }
        }
    }

    private func checkWrittenDate(_ text: String) throws {
        // ISO8601DateFormatter can roll impossible days into the next month.
        // Check the written date independently: offsets may cross a UTC day.
        let parts = text.prefix(10).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].utf8.count == 4, parts[1].utf8.count == 2,
            parts[2].utf8.count == 2,
            parts.allSatisfy({ $0.utf8.allSatisfy { (48...57).contains($0) } }),
            let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
            (1...12).contains(month)
        else { throw FacetContractError.unsupportedResponse }
        let leapYear =
            year.isMultiple(of: 4)
            && (!year.isMultiple(of: 100) || year.isMultiple(of: 400))
        let days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        try require((1...days[month - 1]).contains(day))
    }

    private func checkBounds(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        switch value {
        case .integer, .unsigned, .number, .rawNumber: break
        case .null, .bool, .string, .array, .object: return
        }
        for (key, minimum) in [("minimum", true), ("maximum", false)] {
            if let bound = rule[key] {
                guard let order = FacetJSONNumbers.compare(value, bound) else {
                    throw FacetContractError.unsupportedResponse
                }
                try require(minimum ? order >= 0 : order <= 0)
            }
        }
    }

    private func number(_ value: FacetValue) -> Decimal? {
        switch value {
        case .integer(let number): Decimal(string: String(number))
        case .unsigned(let number): Decimal(string: String(number))
        case .number(let number): number.isNaN ? nil : number
        case .rawNumber(let number):
            Decimal(string: number, locale: Locale(identifier: "en_US_POSIX"))
        case .null, .bool, .string, .array, .object: nil
        }
    }

    private func equal(_ left: FacetValue, _ right: FacetValue) -> Bool {
        if let order = FacetJSONNumbers.compare(left, right) { return order == 0 }
        if case .array(let leftItems) = left, case .array(let rightItems) = right {
            return leftItems.count == rightItems.count
                && zip(leftItems, rightItems).allSatisfy { equal($0.0, $0.1) }
        }
        if case .object(let leftFields) = left, case .object(let rightFields) = right {
            return Set(leftFields.keys) == Set(rightFields.keys)
                && leftFields.allSatisfy { entry in
                    rightFields[entry.key].map { equal(entry.value, $0) } ?? false
                }
        }
        return left == right
    }

    private func matches(_ type: String?, _ value: FacetValue) -> Bool {
        switch value {
        case .object: return type == "object"
        case .array: return type == "array"
        case .null: return type == "null"
        case .string: return type == "string"
        case .bool: return type == "boolean"
        case .integer, .unsigned: return type == "integer" || type == "number"
        case .number, .rawNumber:
            return type == "number" || (type == "integer" && FacetJSONNumbers.isInteger(value))
        }
    }
}
