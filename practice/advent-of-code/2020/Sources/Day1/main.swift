import Foundation

func arrayFromContentsOfFileWithName(fileName: String) -> [Int]? {
    guard let url = Bundle.module.url(forResource: fileName, withExtension: "txt") else {
        return nil
    }

    do {
        let content = try String(contentsOf: url, encoding: String.Encoding.utf8)
        let strings = content.components(separatedBy: "\n")
        return strings.flatMap {
            Int($0)
        }
    } catch {
        return nil
    }
}

let input = arrayFromContentsOfFileWithName(fileName: "input") ?? []

// yay, an O(n^2) algorithm!
for x in input {
    for y in input {
        if x + y == 2020 {
            print(x * y)
        }
    }
}

// even better, an O(n^3)!!!!
// I would think of a better algorithm, but it's 1am and I have work tomorrow
for x in input {
    for y in input {
        for z in input {
            if x + y + z == 2020 {
                print(x * y * z)
            }
        }
    }
}
