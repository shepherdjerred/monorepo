import Foundation

/// Boolean expressions in a saved filter. AND binds more tightly than OR.
indirect enum FacetFilterExpression {
    case term(String)
    case negate(Self)
    case conjunction(Self, Self)
    case union(Self, Self)

    func evaluate(_ predicate: (String) -> Bool) -> Bool {
        switch self {
        case .term(let term): predicate(term)
        case .negate(let value): !value.evaluate(predicate)
        case .conjunction(let left, let right):
            left.evaluate(predicate) && right.evaluate(predicate)
        case .union(let left, let right): left.evaluate(predicate) || right.evaluate(predicate)
        }
    }

    var includesCompleted: Bool {
        switch self {
        case .term(let value): value.lowercased() == "completed"
        case .negate(let value): value.includesCompleted
        case .conjunction(let left, let right), .union(let left, let right):
            left.includesCompleted || right.includesCompleted
        }
    }
}

struct FacetFilterParser {
    struct InvalidQuery: Error {
        let message: String
    }

    private var tokens: ArraySlice<String>

    init(_ query: String) {
        var parts: [String] = []
        var word = ""
        func finishWord() {
            let trimmed = word.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { parts.append(trimmed) }
            word = ""
        }
        let normalized =
            query
            .replacingOccurrences(of: #"\bAND\b"#, with: "&", options: .regularExpression)
            .replacingOccurrences(of: #"\bOR\b"#, with: "|", options: .regularExpression)
            .replacingOccurrences(of: #"\bNOT\b"#, with: "!", options: .regularExpression)
            .replacingOccurrences(
                of: #"(?<=[^\s(&|!])\s+(?=[#@/])"#, with: " & ", options: .regularExpression)
        for character in normalized {
            if "()!&|".contains(character) {
                finishWord()
                parts.append(String(character))
            } else {
                word.append(character)
            }
        }
        finishWord()
        tokens = parts[...]
    }

    mutating func parse() throws(InvalidQuery) -> FacetFilterExpression {
        let expression = try union()
        guard tokens.isEmpty else {
            throw InvalidQuery(message: "Expected & or | between conditions.")
        }
        return expression
    }

    private mutating func consume(_ value: String) -> Bool {
        guard tokens.first == value else { return false }
        tokens.removeFirst()
        return true
    }

    private mutating func union() throws(InvalidQuery) -> FacetFilterExpression {
        var expression = try conjunction()
        while consume("|") { expression = try .union(expression, conjunction()) }
        return expression
    }

    private mutating func conjunction() throws(InvalidQuery) -> FacetFilterExpression {
        var expression = try primary()
        while consume("&") { expression = try .conjunction(expression, primary()) }
        return expression
    }

    private mutating func primary() throws(InvalidQuery) -> FacetFilterExpression {
        if consume("!") { return try .negate(primary()) }
        if consume("(") {
            let group = try union()
            guard consume(")") else { throw InvalidQuery(message: "Close the group with ).") }
            return group
        }
        guard let term = tokens.popFirst(), ![")", "|", "&"].contains(term) else {
            throw InvalidQuery(message: "Enter a condition, such as today or #Work.")
        }
        let lower = term.lowercased()
        let prefixes = ["due before:", "due after:", "deadline before:", "deadline after:"]
        if let prefix = prefixes.first(where: lower.hasPrefix) {
            let value = String(term.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            guard let date = ViewerCalendar.date(fromCivil: value, timeZone: .gmt),
                ViewerCalendar.civilDateString(for: date, timeZone: .gmt) == value
            else {
                throw InvalidQuery(message: "Enter a date as YYYY-MM-DD.")
            }
        } else if term.contains(":") || ["@", "#", "/"].contains(term) {
            throw InvalidQuery(message: "Unsupported condition: \(term)")
        }
        if prefixes.contains(where: lower.hasPrefix)
            || ["no date", "7 days", "next 7 days", "no deadline"].contains(lower)
            || ["@", "#", "/"].contains(where: term.hasPrefix)
        {
            return .term(term)
        }
        // Preserve implicit conjunctions used by existing saved filters.
        var words = term.split(whereSeparator: \.isWhitespace)[...]
        guard let first = words.popFirst() else {
            throw InvalidQuery(message: "Enter a condition.")
        }
        return words.reduce(.term(String(first))) { .conjunction($0, .term(String($1))) }
    }
}
