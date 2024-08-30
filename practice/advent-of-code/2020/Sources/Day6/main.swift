import Foundation

func arrayFromContentsOfFileWithName(fileName: String) -> [[String]] {
    guard let url = Bundle.module.url(forResource: fileName, withExtension: "txt") else {
        return []
    }

    do {
        let content = try String(contentsOf: url, encoding: String.Encoding.utf8)
        let answerGroups = content.components(separatedBy: "\n\n")
        return answerGroups.map {
            $0.components(separatedBy: "\n")
        }
    } catch {
        return []
    }
}

func answersToBitSet(answers: String) -> UInt32 {
    var value: UInt32 = 0
    let asciiLowercaseA: UInt32 = 97
    for answer in answers {
        guard let answerAscii = Character(String(answer)).asciiValue else {
            exit(1)
        }
        let answerBit: UInt32 = 1 << (UInt32(answerAscii) - asciiLowercaseA)
        value = value | answerBit
    }
    return value
}

func answerGroupToBitSet(answerGroup: [String]) -> [UInt32] {
    answerGroup.map {
        answersToBitSet(answers: $0)
    }
}

func answerGroupsToBitSet(answerGroups: [[String]]) -> [[UInt32]] {
    answerGroups.map {
        answerGroupToBitSet(answerGroup: $0)
    }
}

func bitwiseOrAnswerGroup(answerGroup: [UInt32]) -> UInt32 {
    answerGroup.reduce(UInt32.max, { left, right in
        left & right
    })
}

func bitwiseOrAnswerGroups(answerGroups: [[UInt32]]) -> [UInt32] {
    answerGroups.map {
        bitwiseOrAnswerGroup(answerGroup: $0)
    }
}

// Count number of 1's in binary representation
// https://stackoverflow.com/a/8871435
func countBits(int: UInt32) -> Int {
    var value = int
    var count = 0
    while value > 0 {
        count += 1
        value = value & (UInt32(value - 1))
    }
    return count
}

func countYesAnswers(ordAnswerGroups: [UInt32]) -> Int {
    ordAnswerGroups.map {
        let answer = countBits(int: $0)
        print(answer, $0)
        return answer
    }.reduce(0, { left, right in
        left + right
    })
}

let answerGroups = arrayFromContentsOfFileWithName(fileName: "input")
let answerGroupsBitSets = answerGroupsToBitSet(answerGroups: answerGroups)
let ordAnswerGroups = bitwiseOrAnswerGroups(answerGroups: answerGroupsBitSets)
let sum = countYesAnswers(ordAnswerGroups: ordAnswerGroups)
print(sum)
