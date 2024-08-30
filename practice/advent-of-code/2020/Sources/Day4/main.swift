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

// Swift regex: does a string match a pattern?
// https://stackoverflow.com/a/29784455
extension String {
    func matches(_ regex: String) -> Bool {
        self.range(of: regex, options: .regularExpression, range: nil, locale: nil) != nil
    }
}

func isValid(passport: Passport) -> Bool {
    guard let birthYear = passport.birthYear,
          let issueYear = passport.issueYear,
          let expirationYear = passport.expirationYear,
          let height = passport.height,
          let hairColor = passport.hairColor,
          let eyeColor = passport.eyeColor,
          let passportId = passport.passportId else {
        return false
    }

    if birthYear < 1920 || birthYear > 2002 {
//        print("BY:", birthYear)
        return false
    }

    if issueYear < 2010 || issueYear > 2020 {
//        print("IY:", issueYear)
        return false
    }

    if expirationYear < 2020 || expirationYear > 2030 {
//        print("EY: ", expirationYear)
        return false
    }

    let heightUnit = height.suffix(2)
    guard let heightValue = Int(height.prefix(height.count - 2)) else {
        print("H: ", height)
        return false
    }

    switch heightUnit {
    case "in":
        if heightValue < 59 || heightValue > 76 {
//            print("HV: ", heightValue)
            return false
        }
        break
    case "cm":
        if heightValue < 150 || heightValue > 193 {
//            print("HV: ", heightValue)
            return false
        }
        break
    default:
//        print("HU: ", heightUnit)
        return false
    }

    if (!hairColor.matches("#[a-f0-9]{6}")) {
//        print("HC: ", hairColor)
        return false
    }

    let eyeColors = [
        "amb",
        "blu",
        "brn",
        "gry",
        "grn",
        "hzl",
        "oth"
    ]
    if !eyeColors.contains(eyeColor) {
//        print("EC: ", eyeColor)
        return false
    }

    if passportId.count != 9 {
        print("PID: ", passportId)
        return false
    }

    return true
}

func attributesToPassport(array: [String]) -> Passport? {
    var birthYear: Int?
    var issueYear: Int?
    var expirationYear: Int?
    var height: String?
    var hairColor: String?
    var eyeColor: String?
    var passportId: String?
    var countryId: String?

    for entry in array {
        let splitEntry = entry.components(separatedBy: ":")
        let key = splitEntry[0]
        let value = splitEntry[1]

        switch key {
        case "byr":
            birthYear = Int(value)
            break
        case "iyr":
            issueYear = Int(value)
            break
        case "eyr":
            expirationYear = Int(value)
            break
        case "hgt":
            height = value
            break
        case "hcl":
            hairColor = value
            break
        case "ecl":
            eyeColor = value
            break
        case "pid":
            passportId = value
            break
        case "cid":
            countryId = value
            break
        default:
            exit(1)
        }
    }

    return Passport(birthYear: birthYear,
            issueYear: issueYear,
            expirationYear: expirationYear,
            height: height,
            hairColor: hairColor,
            eyeColor: eyeColor,
            passportId: passportId,
            countryId: countryId)
}

struct Passport {
    let birthYear: Int?
    let issueYear: Int?
    let expirationYear: Int?
    let height: String?
    let hairColor: String?
    let eyeColor: String?
    let passportId: String?
    let countryId: String?
}

guard let lines = arrayFromContentsOfFileWithName(fileName: "input") else {
    exit(1)
}

let attributes = lines.flatMap {
    $0.components(separatedBy: " ")
}

var currentAttributes: [String] = []
var passports: [Passport] = []
for attribute in attributes {
    if attribute == "" {
        guard let passport = attributesToPassport(array: currentAttributes) else {
            exit(1)
        }
        passports.append(passport)
        currentAttributes = []
    } else {
        currentAttributes.append(attribute)
    }
}

if currentAttributes.count != 0 {
    guard let passport = attributesToPassport(array: currentAttributes) else {
        exit(1)
    }
    passports.append(passport)
    currentAttributes = []
}

let validatedPassports = passports.map {
    ($0, isValid(passport: $0))
}

let invalidPassports = validatedPassports.filter {
    !$0.1
}

let validPassports = validatedPassports.filter {
    $0.1
}

print(validPassports.count)
