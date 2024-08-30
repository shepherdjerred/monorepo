import Foundation

func arrayFromContentsOfFileWithName(fileName: String) -> [String]? {
    guard let url = Bundle.module.url(forResource: fileName, withExtension: "txt") else {
        return nil
    }

    do {
        let content = try String(contentsOf: url, encoding: String.Encoding.utf8)
        return content.components(separatedBy: "\n")
    } catch {
        return nil
    }
}

struct PasswordEntry {
    init(minimum: Int, maximum: Int, letter: String, password: String) {
        self.minimum = minimum
        self.maximum = maximum
        self.letter = letter
        self.password = password
    }

    let minimum: Int
    let maximum: Int
    let letter: String
    let password: String
}

func parseEntry(input: String) -> PasswordEntry? {
    let pattern = "([0-9]+)\\-([0-9]+) (.): (.+)"

    let regex = try? NSRegularExpression(
            pattern: pattern
    )

    if let match = regex?.firstMatch(in: input, options: [], range: NSRange(location: 0, length: input.utf8.count)) {
        var minimum: Int?
        var maximum: Int?
        var letter: String?
        var password: String?

        if let minRange = Range(match.range(at: 1), in: input) {
            minimum = Int(input[minRange])
        }

        if let maxRange = Range(match.range(at: 2), in: input) {
            maximum = Int(input[maxRange])
        }

        if let letterRange = Range(match.range(at: 3), in: input) {
            letter = String(input[letterRange])
        }

        if let passwordRange = Range(match.range(at: 4), in: input) {
            password = String(input[passwordRange])
        }

        if let minimum = minimum, let maximum = maximum, let letter = letter, let password = password {
            return PasswordEntry(minimum: minimum, maximum: maximum, letter: letter, password: password)
        }
    }

    return nil
}

func parseEntries(input: [String]) -> [PasswordEntry] {
    input.compactMap {
        parseEntry(input: $0)
    }
}

// Number of occurrences of substring in string in Swift
// https://stackoverflow.com/questions/31746223/number-of-occurrences-of-substring-in-string-in-swift/45073012#45073012
extension String {
    func count(of target: String) -> Int {
        assert(!target.isEmpty)
        var count = 0
        var searchRange: Range<String.Index>?
        while let foundRange = range(of: target, options: [], range: searchRange) {
            count += 1
            searchRange = Range(uncheckedBounds: (lower: foundRange.upperBound, upper: endIndex))
        }
        return count
    }
}

func checkEntryMeetsMinMax(entry: PasswordEntry) -> Bool {
    let count = entry.password.count(of: entry.letter)
    return count <= entry.maximum && count >= entry.minimum
}

// Get a character from string using its index in Swift
// https://www.simpleswiftguide.com/get-character-from-string-using-its-index-in-swift/
extension String {
    subscript(offset: Int) -> String {
        String(self[index(startIndex, offsetBy: offset)])
    }
}

// XOR in Swift 5?
// https://stackoverflow.com/questions/55478274/xor-in-swift-5
extension Bool {
    static func ^ (left: Bool, right: Bool) -> Bool {
        left != right
    }
}

func checkEntryMeetsIndex(entry: PasswordEntry) -> Bool {
    let password = entry.password
    let letter = entry.letter
    return (password[entry.minimum - 1] == letter) ^ (password[entry.maximum - 1] == letter)
}

func checkEntries(entry: [PasswordEntry], fn: (PasswordEntry) -> Bool) -> [(PasswordEntry, Bool)] {
    entries.map {
        ($0, fn($0))
    }
}

func getFailedEntries(entries: [(PasswordEntry, Bool)]) -> [PasswordEntry] {
    entries.filter {
        !$0.1
    }.map {
        $0.0
    }
}

func solve(entries: [PasswordEntry], fn: (PasswordEntry) -> Bool) -> Int {
    let checkedEntries = checkEntries(entry: entries, fn: fn)
    let failedEntries = getFailedEntries(entries: checkedEntries)

    let validEntriesCount = entries.count - failedEntries.count
    return validEntriesCount
}

let passwordEntries = arrayFromContentsOfFileWithName(fileName: "input")
let entries = parseEntries(input: passwordEntries ?? [])

let minMaxSolution = solve(entries: entries, fn: checkEntryMeetsMinMax)
let indexSolution = solve(entries: entries, fn: checkEntryMeetsIndex)

print(minMaxSolution)
print(indexSolution)
