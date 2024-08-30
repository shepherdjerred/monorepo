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

struct StringEntry {
    let row: String
    let column: String
}

struct Entry {
    let row: Int
    let column: Int
}

func rowToInteger(row: String) -> Int? {
    var binaryString = ""
    for character in row {
        if character == "F" {
            binaryString.append("0")
        } else if character == "B" {
            binaryString.append("1")
        } else {
            return nil
        }
    }
    return Int(binaryString, radix: 2)
}

func columnToInteger(column: String) -> Int? {
    var binaryString = ""
    for character in column {
        if character == "R" {
            binaryString.append("1")
        } else if character == "L" {
            binaryString.append("0")
        } else {
            return nil
        }
    }
    return Int(binaryString, radix: 2)
}

func entryToId(entry: Entry) -> Int {
    (entry.row * 8) + entry.column
}

func getStringEntries() -> [StringEntry] {
    guard let lines = arrayFromContentsOfFileWithName(fileName: "input") else {
        return []
    }
    return lines.map {
        let row: String = String($0.prefix(7))
        let column: String = String($0.suffix(3))
        return StringEntry(row: row, column: column)
    }
}

func stringEntryToEntry(entry: StringEntry) -> Entry {
    let row: Int? = rowToInteger(row: entry.row)
    let column: Int? = columnToInteger(column: entry.column)

    guard let realRow = row, let realColumn = column else {
        exit(1)
    }
    return Entry(row: realRow, column: realColumn)
}

let entries = getStringEntries().map {
    let temp = stringEntryToEntry(entry: $0)
    return temp
}.map {
    entryToId(entry: $0)
}.sorted()

guard let first = entries.first, let last = entries.last else {
    exit(1)
}

for entry in (first)...(last) {
    if entries[entry - first] != entry {
        print(entry)
        break
    }
}
