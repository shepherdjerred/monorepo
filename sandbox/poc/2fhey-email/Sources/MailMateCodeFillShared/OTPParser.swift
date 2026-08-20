import Foundation

public struct OTPParser {
    private struct Candidate {
        let code: String
        let range: NSRange
        let score: Int
        let hasCodeLabel: Bool
    }

    private static let keywordPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(verification|verificaci[oó]n|v[eé]rification|verifizierung|sicherheitscode|one[- ]?time|authentication|authentifizierung|auth|login|sign[- ]?in|passcode|otp|two[- ]?factor|2fa|c[oó]de|pin|验证码|認証コード)(?![\\p{L}\\p{N}])"
    )
    private static let explicitLabelPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(code|otp|pin|passcode)(?![\\p{L}\\p{N}])"
    )
    private static let candidateDashCharacters = "\\x{002D}\\x{2010}-\\x{2015}"
    private static let candidateSeparatorCharacters = " \\x{00A0}\\x{2007}\\x{202F}\(candidateDashCharacters)"
    private static let candidateSpacePattern = "[ \\x{00A0}\\x{2007}\\x{202F}]"
    private static let candidateDashPattern = "[\(candidateDashCharacters)]"
    private static let candidateSeparatorPattern = "[\(candidateSeparatorCharacters)]"
    private static let candidatePattern = makeExpression(
        "(?<![\\p{L}\\p{N}\(candidateDashCharacters)])([A-Za-z0-9](?:\(candidateSeparatorPattern)?[A-Za-z0-9]){3,7})(?![\\p{L}\\p{N}]|\(candidateDashPattern)[A-Za-z0-9]|\(candidateSpacePattern)[A-Za-z0-9]*[0-9])"
    )
    private static let falsePositiveWordPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(phone|tel|date|order|invoice|amount|price|year|copyright|http|www|reference|ticket)(?![\\p{L}\\p{N}])"
    )
    private static let buildVersionNumberPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(build|version)[ \\x{00A0}\\x{2007}\\x{202F}]*\\d{1,4}(?![\\p{L}\\p{N}])"
    )
    private static let phoneDeliveryPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(phone|tel|mobile|texted|sent|called|call)(?![\\p{L}\\p{N}])"
    )
    private static let phoneNumberPattern = makeExpression(
        "(?<![\\p{L}\\p{N}])\\(?\\d{3}\\)?[ .-]\\d{4}(?![\\p{L}\\p{N}])"
    )
    private static let numericProsePattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])\\d{1,4}[ \\x{00A0}\\x{2007}\\x{202F}]+(?:sec(?:ond)?s?|min(?:ute)?s?|h(?:our)?s?|day?s?|week?s?|month?s?|year?s?|am|pm|utc|gmt|cet|cest|est|edt|pst|pdt|bst|jst|aest|aedt)(?![\\p{L}\\p{N}])"
    )
    private static let timePattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s?(?:am|pm))?(?:\\s+(?:utc|gmt|cet|cest|est|edt|pst|pdt|bst|jst|aest|aedt))?(?![\\p{L}\\p{N}])"
    )
    private static let datePattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(?:\\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\\d|3[01])|(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\\d|3[01])[-/]\\d{2,4}|(?:0?[1-9]|[12]\\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.]\\d{2,4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*|\\s+)\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{4})(?![\\p{L}\\p{N}])"
    )
    private static let uriPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}])(?!(?:code|otp|pin|passcode):)[A-Z][A-Z0-9+.-]*:\\S+"
    )
    private static let bareURLPattern = makeExpression(
        "(?i)(?<![\\p{L}\\p{N}@.])(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?::\\d{1,5})?(?:[/?#][^\\s]*)?"
    )
    private static let emailPattern = makeExpression("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}")
    private static let senderMailboxPattern = makeExpression("(?i)^[A-Z0-9._%+-]+@([A-Z0-9.-]+)$")

    public let lifetime: TimeInterval

    public init(lifetime: TimeInterval = 180) {
        self.lifetime = lifetime
    }

    public func parse(
        body: String,
        metadata: MessageMetadata,
        detectedAt: Date = Date()
    ) -> OTPRecord? {
        let recordDetectedAt = min(metadata.date ?? detectedAt, detectedAt)
        guard recordDetectedAt.addingTimeInterval(lifetime) > detectedAt else {
            return nil
        }
        let message = metadata.subject + "\n" + body
        let withoutURLs = Self.uriPattern.stringByReplacingMatches(
            in: message,
            range: NSRange(message.startIndex..., in: message),
            withTemplate: " "
        )
        let withoutTimes = Self.timePattern.stringByReplacingMatches(
            in: withoutURLs,
            range: NSRange(withoutURLs.startIndex..., in: withoutURLs),
            withTemplate: " "
        )
        let sanitizedBody = Self.bareURLPattern.stringByReplacingMatches(
            in: withoutTimes,
            range: NSRange(withoutTimes.startIndex..., in: withoutTimes),
            withTemplate: " "
        )
        let keywordRanges = Self.keywordPattern.matches(
            in: sanitizedBody,
            range: NSRange(sanitizedBody.startIndex..., in: sanitizedBody)
        )
        let explicitLabelRanges = Self.explicitLabelPattern.matches(
            in: sanitizedBody,
            range: NSRange(sanitizedBody.startIndex..., in: sanitizedBody)
        )
        let rawCandidates = Self.candidatePattern.matches(
            in: sanitizedBody,
            range: NSRange(sanitizedBody.startIndex..., in: sanitizedBody)
        ).compactMap { match -> Candidate? in
            guard let codeRange = Range(match.range, in: sanitizedBody) else {
                return nil
            }
            let rawCode = String(sanitizedBody[codeRange])
            guard !Self.isInsideGroupedToken(body: sanitizedBody, range: match.range, rawCode: rawCode) else {
                return nil
            }
            let explicitLabel = Self.hasExplicitLabel(
                body: sanitizedBody,
                labelRanges: explicitLabelRanges,
                candidateRange: match.range,
                maximumGap: 28
            )
            guard let normalized = Self.normalizeCandidate(rawCode: rawCode, range: match.range, hasExplicitLabel: explicitLabel) else {
                return nil
            }
            let code = normalized.code
            guard code.count >= 4, code.count <= 8, code.rangeOfCharacter(from: .decimalDigits) != nil else {
                return nil
            }
            let hasDirectExplicitLabel = Self.hasExplicitLabel(
                body: sanitizedBody,
                labelRanges: explicitLabelRanges,
                candidateRange: normalized.range,
                maximumGap: 8
            )
            guard !Self.isFalsePositive(
                body: sanitizedBody,
                range: normalized.range,
                code: code,
                hasDirectExplicitLabel: hasDirectExplicitLabel
            ) else {
                return nil
            }

            let hasNearbyKeyword = keywordRanges.contains { keywordRange in
                NSMaxRange(keywordRange.range) >= match.range.location - 48 &&
                    keywordRange.range.location <= NSMaxRange(match.range) + 48
            }
            let score = (explicitLabel ? 4 : 0) + (hasNearbyKeyword ? 2 : 0)
            return Candidate(
                code: code,
                range: normalized.range,
                score: score,
                hasCodeLabel: explicitLabel
            )
        }

        let candidates = rawCandidates.map { candidate -> Candidate in
            let hasFollowingExplicitLabel = Self.hasFollowingExplicitLabel(
                body: sanitizedBody,
                labelRanges: explicitLabelRanges,
                candidateRange: candidate.range,
                candidateRanges: rawCandidates.map(\.range),
                maximumGap: 28
            )
            guard hasFollowingExplicitLabel else { return candidate }
            return Candidate(
                code: candidate.code,
                range: candidate.range,
                score: candidate.score + 4,
                hasCodeLabel: true
            )
        }

        guard let candidate = candidates.sorted(by: { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            if lhs.hasCodeLabel != rhs.hasCodeLabel { return lhs.hasCodeLabel }
            let lhsIsNumeric = lhs.code.allSatisfy(\.isNumber)
            let rhsIsNumeric = rhs.code.allSatisfy(\.isNumber)
            if lhsIsNumeric != rhsIsNumeric { return lhsIsNumeric }
            return lhs.range.location < rhs.range.location
        }).first, candidate.score >= 2 else {
            return nil
        }

        return OTPRecord(
            code: candidate.code,
            service: Self.service(from: metadata),
            sender: Self.senderLabel(from: metadata.sender),
            messageID: metadata.messageID,
            detectedAt: recordDetectedAt,
            expiresAt: recordDetectedAt.addingTimeInterval(lifetime)
        )
    }

    private static func isFalsePositive(body: String, range: NSRange, code: String, hasDirectExplicitLabel: Bool) -> Bool {
        let beforeStart = max(0, range.location - 18)
        let beforeRange = NSRange(location: beforeStart, length: range.location - beforeStart)
        let afterStart = NSMaxRange(range)
        let afterLength = min(18, body.utf16.count - afterStart)
        let bodyNSString = NSString(string: body)
        let context = (bodyNSString.substring(with: beforeRange) + bodyNSString.substring(with: NSRange(location: afterStart, length: afterLength))).lowercased()
        guard !Self.overlapsEmailAddress(body: body, range: range) else { return true }
        if !hasDirectExplicitLabel,
           Self.falsePositiveWordPattern.firstMatch(in: context, range: NSRange(context.startIndex..., in: context)) != nil {
            return true
        }
        if !hasDirectExplicitLabel,
           Self.buildVersionNumberPattern.matches(in: body, range: NSRange(body.startIndex..., in: body)).contains(where: {
               NSIntersectionRange($0.range, range).length > 0
           }) {
            return true
        }
        if Self.phoneNumberPattern.matches(in: body, range: NSRange(body.startIndex..., in: body)).contains(where: {
            NSIntersectionRange($0.range, range).length > 0
        }) {
            return true
        }
        if Self.numericProsePattern.matches(in: body, range: NSRange(body.startIndex..., in: body)).contains(where: {
            NSIntersectionRange($0.range, range).length > 0
        }) {
            return true
        }
        if code.allSatisfy(\.isNumber), code.count >= 7, !hasDirectExplicitLabel,
           Self.phoneDeliveryPattern.firstMatch(in: context, range: NSRange(context.startIndex..., in: context)) != nil {
            return true
        }
        if Self.datePattern.matches(in: body, range: NSRange(body.startIndex..., in: body)).contains(where: { NSIntersectionRange($0.range, range).length > 0 }) {
            return true
        }
        return false
    }

    private static func hasExplicitLabel(
        body: String,
        labelRanges: [NSTextCheckingResult],
        candidateRange: NSRange,
        maximumGap: Int
    ) -> Bool {
        labelRanges.contains { labelRange in
            let labelEnd = NSMaxRange(labelRange.range)
            let gapLength = candidateRange.location - labelEnd
            guard gapLength >= 0, gapLength <= maximumGap,
                  let gapRange = Range(NSRange(location: labelEnd, length: gapLength), in: body) else {
                return false
            }
            return !body[gapRange].contains(where: \.isNewline)
        }
    }

    private static func hasFollowingExplicitLabel(
        body: String,
        labelRanges: [NSTextCheckingResult],
        candidateRange: NSRange,
        candidateRanges: [NSRange],
        maximumGap: Int
    ) -> Bool {
        labelRanges.contains { labelRange in
            let labelEnd = NSMaxRange(labelRange.range)
            let gapLength = labelRange.range.location - NSMaxRange(candidateRange)
            guard gapLength >= 0, gapLength <= maximumGap,
                  let gapRange = Range(NSRange(location: NSMaxRange(candidateRange), length: gapLength), in: body) else {
                return false
            }
            guard !body[gapRange].contains(where: \.isNewline) else { return false }
            return !candidateRanges.contains { otherRange in
                guard otherRange.location > candidateRange.location,
                      otherRange.location >= labelEnd else {
                    return false
                }
                let candidateGap = otherRange.location - labelEnd
                guard candidateGap <= maximumGap,
                      let candidateGapRange = Range(NSRange(location: labelEnd, length: candidateGap), in: body) else {
                    return false
                }
                return !body[candidateGapRange].contains(where: \.isNewline)
            }
        }
    }

    // Only a candidate that is part of an address is a false positive; an unrelated support address
    // elsewhere in the body must not reject a legitimate 7-8 character code.
    private static func overlapsEmailAddress(body: String, range: NSRange) -> Bool {
        emailPattern.matches(in: body, range: NSRange(body.startIndex..., in: body)).contains { match in
            NSIntersectionRange(match.range, range).length > 0 ||
                match.range.location == NSMaxRange(range) ||
                NSMaxRange(match.range) == range.location
        }
    }

    private static func isInsideGroupedToken(body: String, range: NSRange, rawCode: String) -> Bool {
        let start = String.Index(utf16Offset: range.location, in: body)
        if start > body.startIndex {
            let separatorIndex = body.index(before: start)
            if isSpaceSeparator(body[separatorIndex]), separatorIndex > body.startIndex {
                let preceding = body.index(before: separatorIndex)
                if body[preceding].isNumber { return true }
            }
        }

        guard rawCode.contains(where: isCandidateSeparator) else { return false }
        let endOffset = NSMaxRange(range)
        let end = String.Index(utf16Offset: endOffset, in: body)
        guard end < body.endIndex, isSpaceSeparator(body[end]) else { return false }
        let afterSeparator = body.index(after: end)
        guard afterSeparator < body.endIndex,
              body[afterSeparator].isLetter || body[afterSeparator].isNumber else { return false }
        if let separatorIndex = rawCode.firstIndex(where: isCandidateSeparator) {
            let prefix = rawCode[..<separatorIndex].filter { !isCandidateSeparator($0) }
            let suffix = rawCode[rawCode.index(after: separatorIndex)...].filter { !isCandidateSeparator($0) }
            if prefix.allSatisfy(\.isLetter), suffix.count >= 4, suffix.count <= 8,
               suffix.contains(where: \.isNumber) {
                return false
            }
            if prefix.count >= 4, prefix.count <= 8,
               prefix.contains(where: \.isNumber), suffix.allSatisfy(\.isLetter) {
                return false
            }
        }
        let compact = rawCode.filter { !isCandidateSeparator($0) }
        guard let firstLetter = compact.firstIndex(where: \.isLetter), firstLetter > compact.startIndex else { return true }
        let numericPrefix = compact[..<firstLetter]
        let alphaSuffix = compact[firstLetter...]
        return !(numericPrefix.allSatisfy(\.isNumber) && alphaSuffix.allSatisfy(\.isLetter))
    }

    private static func normalizeCandidate(rawCode: String, range: NSRange, hasExplicitLabel: Bool) -> (code: String, range: NSRange)? {
        let compact = rawCode.filter { !Self.isCandidateSeparator($0) }
        guard compact.count >= 4 else { return nil }
        if compact.allSatisfy(\.isNumber) {
            return (compact, range)
        }
        let firstSeparator = rawCode.firstIndex(where: Self.isCandidateSeparator)
        if let firstSeparator, Self.isDashSeparator(rawCode[firstSeparator]),
           compact.first?.isNumber == true, !hasExplicitLabel,
           compact.contains(where: \.isLetter) {
            return nil
        }
        if let firstSeparator, Self.isDashSeparator(rawCode[firstSeparator]), compact.count <= 8,
           (compact.first?.isNumber != true || hasExplicitLabel),
           compact.contains(where: \.isLetter), compact.contains(where: \.isNumber) {
            return (compact, range)
        }

        if let firstSeparator, Self.isSpaceSeparator(rawCode[firstSeparator]),
           compact.count <= 8, compact.contains(where: \.isLetter), compact.contains(where: \.isNumber) {
            let prefix = String(rawCode[..<firstSeparator]).lowercased()
            let suffix = rawCode[rawCode.index(after: firstSeparator)...]
            let originalPrefix = String(rawCode[..<firstSeparator])
            if (!prefix.isEmpty && originalPrefix.allSatisfy(\.isUppercase)) ||
                (prefix.count >= 4 && originalPrefix.allSatisfy(\.isLetter)) ||
                (prefix.contains(where: \.isNumber) && suffix.contains(where: \.isNumber)) {
                return (compact, range)
            }
        }

        // A separator can cause a numeric code followed by a short word ("482913 to") to be
        // captured as one candidate. Keep the numeric code in that case, but preserve compact
        // digit-led alphanumeric codes such as "1234AB".
        if rawCode.contains(where: Self.isCandidateSeparator),
           let firstLetterIndex = compact.firstIndex(where: { !$0.isNumber }),
           compact[..<firstLetterIndex].count >= 4 {
            let numericPrefix = String(compact[..<firstLetterIndex])
            return (numericPrefix, NSRange(location: range.location, length: numericPrefix.utf16.count))
        }

        if let separatorIndex = rawCode.firstIndex(where: Self.isSpaceSeparator) {
            let prefix = String(rawCode[..<separatorIndex])
            let suffix = String(rawCode[rawCode.index(after: separatorIndex)...])
            let compactPrefix = prefix.filter { !Self.isCandidateSeparator($0) }
            if compactPrefix.count >= 4, compactPrefix.count <= 8,
               compactPrefix.contains(where: \.isNumber), suffix.allSatisfy(\.isLetter) {
                return (compactPrefix, NSRange(location: range.location, length: prefix.utf16.count))
            }
        }

        // The candidate pattern tolerates single separators, so a preceding word can be captured
        // together with the code ("is 482913"). Drop such a prefix only when a separator actually
        // divided it from the rest — scanning for the first digit would truncate a genuine
        // alphanumeric code that starts with letters, such as "abcd1234".
        guard let separatorIndex = rawCode.firstIndex(where: Self.isCandidateSeparator) else {
            return (compact, range)
        }
        let word = rawCode[rawCode.startIndex..<separatorIndex]
        guard !word.isEmpty, word.allSatisfy(\.isLetter) else {
            return (compact, range)
        }
        let remainder = String(rawCode[rawCode.index(after: separatorIndex)...])
        let suffix = remainder.filter { !Self.isCandidateSeparator($0) }
        guard suffix.count >= 4, suffix.count <= 8, suffix.contains(where: \.isNumber) else {
            return nil
        }
        let offset = String(rawCode[rawCode.startIndex...separatorIndex]).utf16.count
        return (suffix, NSRange(location: range.location + offset, length: remainder.utf16.count))
    }

    private static func isSpaceSeparator(_ character: Character) -> Bool {
        character == " " || character == "\u{00A0}" || character == "\u{2007}" || character == "\u{202F}"
    }

    private static func isDashSeparator(_ character: Character) -> Bool {
        character == "-" || character == "\u{2010}" || character == "\u{2011}" || character == "\u{2012}" || character == "\u{2013}" || character == "\u{2014}" || character == "\u{2015}"
    }

    private static func isCandidateSeparator(_ character: Character) -> Bool {
        isSpaceSeparator(character) || isDashSeparator(character)
    }

    private static func service(from metadata: MessageMetadata) -> String? {
        if let mailbox = mailboxAddress(from: metadata.sender),
           let domainMatch = senderMailboxPattern.firstMatch(in: mailbox, range: NSRange(mailbox.startIndex..., in: mailbox)),
           let domainRange = Range(domainMatch.range(at: 1), in: mailbox) {
            let domain = String(mailbox[domainRange]).lowercased()
            if ServiceIdentity.isUsableService(domain) {
                return domain
            }
        }
        return nil
    }

    private static func mailboxAddress(from sender: String) -> String? {
        let trimmed = sender.trimmingCharacters(in: .whitespacesAndNewlines)
        if let openingBracket = trimmed.lastIndex(of: "<"),
           let closingBracket = trimmed[openingBracket...].firstIndex(of: ">"),
           openingBracket < closingBracket {
            let address = String(trimmed[trimmed.index(after: openingBracket)..<closingBracket])
            return senderMailboxPattern.firstMatch(in: address, range: NSRange(address.startIndex..., in: address)) == nil ? nil : address
        }
        return senderMailboxPattern.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) == nil ? nil : trimmed
    }

    private static func senderLabel(from sender: String) -> String {
        let trimmed = sender.trimmingCharacters(in: .whitespacesAndNewlines)
        if let bracket = trimmed.firstIndex(of: "<") {
            return String(trimmed[..<bracket]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if Self.senderMailboxPattern.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) != nil {
            return ""
        }
        return trimmed
    }

    private static func makeExpression(_ pattern: String) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern)
        } catch {
            preconditionFailure("Invalid bundled OTP expression: \(pattern)")
        }
    }
}

private extension NSRegularExpression {
    func matches(in string: String, range: NSRange) -> [NSTextCheckingResult] {
        var results: [NSTextCheckingResult] = []
        enumerateMatches(in: string, options: [], range: range) { result, _, _ in
            if let result { results.append(result) }
        }
        return results
    }

    func firstMatch(in string: String, range: NSRange) -> NSTextCheckingResult? {
        var first: NSTextCheckingResult?
        enumerateMatches(in: string, options: [], range: range) { result, _, stop in
            first = result
            stop.pointee = true
        }
        return first
    }
}
