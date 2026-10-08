import Foundation

/// Preserves numeric tokens in open maps; Foundation's numeric decoder can round
/// a token before a schema sees it. Typed DTO decoding uses this exact tree too.
enum FacetJSON {
    static func documentKey() throws -> CodingUserInfoKey {
        guard let key = CodingUserInfoKey(rawValue: "facet.rawDocument") else {
            throw FacetContractError.unsupportedResponse
        }
        return key
    }

    static func parse(_ data: Data) throws -> FacetValue {
        var parser = Parser(bytes: Array(data))
        let value = try parser.value(depth: 0)
        parser.whitespace()
        guard parser.index == parser.bytes.count else {
            throw FacetContractError.unsupportedResponse
        }
        return value
    }

    static func decoder(_ data: Data) throws -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.userInfo[try documentKey()] = try parse(data)
        return decoder
    }

    static func encode(_ value: FacetValue) throws -> String {
        switch value {
        case .null: return "null"
        case .bool(let value): return value ? "true" : "false"
        case .integer(let value): return String(value)
        case .unsigned(let value): return String(value)
        case .number(let value): return try decimalText(value)
        case .rawNumber(let value): return try rawNumericText(value)
        case .string(let value): return try quotedText(value)
        case .array(let values): return "[" + (try values.map(encode)).joined(separator: ",") + "]"
        case .object(let values):
            return try encodeObject(values)
        }
    }

    private static func decimalText(_ value: Decimal) throws -> String {
        guard !value.isNaN else { throw FacetContractError.unsupportedResponse }
        return NSDecimalNumber(decimal: value).stringValue
    }

    private static func rawNumericText(_ value: String) throws -> String {
        guard FacetJSONNumbers.isToken(value) else { throw FacetContractError.unsupportedResponse }
        return value
    }

    private static func quotedText(_ value: String) throws -> String {
        guard let text = String(data: try JSONEncoder().encode(value), encoding: .utf8) else {
            throw FacetContractError.unsupportedResponse
        }
        return text
    }

    private static func encodeObject(_ fields: [String: FacetValue]) throws -> String {
        let members = try fields.keys.sorted().map { key in
            guard let child = fields[key] else { throw FacetContractError.unsupportedResponse }
            return try encode(.string(key)) + ":" + encode(child)
        }
        return "{" + members.joined(separator: ",") + "}"
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        mutating func whitespace() {
            while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
        }
        mutating func consume(_ byte: UInt8) -> Bool {
            whitespace()
            guard index < bytes.count, bytes[index] == byte else { return false }
            index += 1
            return true
        }

        mutating func value(depth: Int) throws -> FacetValue {
            whitespace()
            guard depth <= 128, index < bytes.count else {
                throw FacetContractError.unsupportedResponse
            }
            let first = bytes[index]
            if first == 34 { return .string(try string()) }
            if first == 123 { return try object(depth: depth) }
            if first == 91 { return try array(depth: depth) }
            if first == 110 {
                try literal("null")
                return .null
            }
            if first == 116 {
                try literal("true")
                return .bool(true)
            }
            if first == 102 {
                try literal("false")
                return .bool(false)
            }
            return try number()
        }

        private mutating func object(depth: Int) throws -> FacetValue {
            index += 1
            var fields: [String: FacetValue] = [:]
            if consume(125) { return .object(fields) }
            repeat {
                whitespace()
                let key = try string()
                guard fields[key] == nil, consume(58) else {
                    throw FacetContractError.unsupportedResponse
                }
                fields[key] = try value(depth: depth + 1)
            } while consume(44)
            guard consume(125) else { throw FacetContractError.unsupportedResponse }
            return .object(fields)
        }

        private mutating func array(depth: Int) throws -> FacetValue {
            index += 1
            var values: [FacetValue] = []
            if consume(93) { return .array(values) }
            repeat { values.append(try value(depth: depth + 1)) } while consume(44)
            guard consume(93) else { throw FacetContractError.unsupportedResponse }
            return .array(values)
        }

        private mutating func number() throws -> FacetValue {
            let start = index
            while index < bytes.count, FacetJSONNumbers.numericByte(bytes[index]) { index += 1 }
            guard let token = String(bytes: bytes[start..<index], encoding: .utf8),
                FacetJSONNumbers.isToken(token)
            else {
                throw FacetContractError.unsupportedResponse
            }
            if let integer = Int64(token) { return .integer(integer) }
            if let unsigned = UInt64(token) { return .unsigned(unsigned) }
            return .rawNumber(token)
        }

        private mutating func literal(_ text: String) throws {
            let literal = Array(text.utf8)
            guard bytes.count - index >= literal.count,
                Array(bytes[index..<(index + literal.count)]) == literal
            else { throw FacetContractError.unsupportedResponse }
            index += literal.count
        }

        private mutating func string() throws -> String {
            guard index < bytes.count, bytes[index] == 34 else {
                throw FacetContractError.unsupportedResponse
            }
            let start = index
            index += 1
            while index < bytes.count {
                if bytes[index] == 92 {
                    index += 2
                    continue
                }
                if bytes[index] == 34 {
                    index += 1
                    return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
                }
                index += 1
            }
            throw FacetContractError.unsupportedResponse
        }
    }
}
