import Foundation

func arrayFromContentsOfFileWithName(fileName: String) -> [String] {
    guard let url = Bundle.module.url(forResource: fileName, withExtension: "txt") else {
        return []
    }

    do {
        let content = try String(contentsOf: url, encoding: String.Encoding.utf8)
        return content.components(separatedBy: "\n")
    } catch {
        return []
    }
}

func readBag(value: String) -> BagAppearance {
    let input = "([a-z]+) ([a-z]+) bags contain ([a-z1-9, ]+)."

    let regex = try? NSRegularExpression(pattern: bagPattern)
    if let match = regex?.firstMatch(in: value, options: [], range: NSRange(location: 0, length: value.utf8.count)) {
        print(match)
    }

    let bagContentsRegex = "([0-9]+) ([a-z]+) ([a-z]+) bag[s]{0,1}|(no other bags)"

    return BagAppearance(adjective: "", color: "")
}

func readBags() -> [BagAppearance] {
    let strings = arrayFromContentsOfFileWithName(fileName: "input")
    return strings.map {
        readBag(value: $0)
    }
}

struct Bag {
    let appearance: BagAppearance
    let contents: BagContents

    init(appearance: BagAppearance, contents: BagContents) {
        self.appearance = appearance
        self.contents = contents
    }
}

struct BagAppearance {
    let adjective: String
    let color: String

    init(adjective: String, color: String) {
        self.adjective = adjective
        self.color = color
    }
}

struct BagAppearanceQuantity {
    let appearance: BagAppearance
    let quantity: Int

    init(appearance: BagAppearance, quantity: Int) {
        self.appearance = appearance
        self.quantity = quantity
    }
}

struct BagContents {
    let contents: [BagAppearanceQuantity]

    init(contents: [BagAppearanceQuantity]) {
        self.contents = contents
    }
}

let bags: [BagAppearanceQuantity] = []

// Read in all different BagDescriptions
// Create adjacency matrix
