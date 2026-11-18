public import Foundation

/// Evaluates JSON Schema definitions used by bundled presentation and feedback contracts.
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

    public func validate(_ value: FacetValue, definition: String) throws {
        guard let rule = definitions[definition]?.object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        try check(rule, value)
    }

    private func require(_ condition: Bool) throws {
        if !condition { throw FacetContractError.unsupportedResponse }
    }

    private func inspect(_ value: FacetValue) throws {
        if case .bool = value { return }
        guard let rule = value.object?.fields else { throw FacetContractError.unsupportedResponse }
        let supported: Set<String> = [
            "$ref", "$schema", "$id", "$defs", "$comment", "title", "description", "default",
            "examples", "const", "enum", "anyOf", "oneOf", "allOf", "not", "type", "properties",
            "required", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems",
            "minLength", "maxLength", "pattern", "format", "minimum", "maximum",
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
        if let expectedType = rule["type"] {
            let choices = expectedType.array?.elements ?? [expectedType]
            try require(choices.contains { matches($0.text, value) })
        }
    }

    private func checkComposition(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        if let rules = rule["allOf"]?.array?.elements {
            for child in rules { try evaluate(child, value) }
        }
        if let excluded = rule["not"]?.object?.fields {
            let matchedExcluded: Bool
            do {
                try check(excluded, value)
                matchedExcluded = true
            } catch { matchedExcluded = false }
            try require(!matchedExcluded)
        }
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

    private func evaluate(_ schema: FacetValue, _ value: FacetValue) throws {
        if case .bool(let permitted) = schema {
            try require(permitted)
            return
        }
        guard let rule = schema.object?.fields else { throw FacetContractError.unsupportedResponse }
        try check(rule, value)
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
        }
    }

    private func checkBounds(_ rule: [String: FacetValue], _ value: FacetValue) throws {
        switch value {
        case .integer, .unsigned, .number, .rawNumber: break
        case .null, .bool, .string, .array, .object: return
        }
        for (key, isMinimum) in [("minimum", true), ("maximum", false)] {
            if let bound = rule[key] {
                guard let order = FacetJSONNumbers.compare(value, bound) else {
                    throw FacetContractError.unsupportedResponse
                }
                try require(isMinimum ? order >= 0 : order <= 0)
            }
        }
    }

    private func number(_ value: FacetValue) -> Decimal? {
        switch value {
        case .integer(let integerValue): Decimal(string: String(integerValue))
        case .unsigned(let unsignedValue): Decimal(string: String(unsignedValue))
        case .number(let decimalValue): decimalValue.isNaN ? nil : decimalValue
        case .rawNumber(let rawText):
            Decimal(string: rawText, locale: Locale(identifier: "en_US_POSIX"))
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

    private func matches(_ expected: String?, _ value: FacetValue) -> Bool {
        switch value {
        case .object: expected == "object"
        case .array: expected == "array"
        case .null: expected == "null"
        case .string: expected == "string"
        case .bool: expected == "boolean"
        case .integer, .unsigned: expected == "integer" || expected == "number"
        case .number, .rawNumber:
            expected == "number" || (expected == "integer" && FacetJSONNumbers.isInteger(value))
        }
    }
}
