import Foundation

public struct OTPParser {
    private struct Candidate {
        let code: String
        let range: NSRange
        let score: Int
    }

    private static let keywordPattern = makeExpression(
        "(?i)(verification|verificaci[oó]n|v[eé]rification|verifizierung|sicherheitscode|one[- ]?time|authentication|authentifizierung|auth|login|sign[- ]?in|passcode|otp|two[- ]?factor|2fa|c[oó]de|pin|验证码|認証コード)"
    )
    private static let candidatePattern = makeExpression(
        "(?<![A-Za-z0-9])([A-Za-z0-9](?:[ -]?[A-Za-z0-9]){3,7})(?![A-Za-z0-9])"
    )
    private static let urlPattern = makeExpression("(?i)https?://\\S+")
    private static let emailPattern = makeExpression("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}")
    private static let senderDomainPattern = makeExpression("@([A-Za-z0-9.-]+)")

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
        let sanitizedBody = Self.urlPattern.stringByReplacingMatches(
            in: body,
            range: NSRange(body.startIndex..., in: body),
            withTemplate: " "
        )
        let keywordRanges = Self.keywordPattern.matches(
            in: sanitizedBody,
            range: NSRange(sanitizedBody.startIndex..., in: sanitizedBody)
        )
        let candidates = Self.candidatePattern.matches(
            in: sanitizedBody,
            range: NSRange(sanitizedBody.startIndex..., in: sanitizedBody)
        ).compactMap { match -> Candidate? in
            guard let codeRange = Range(match.range, in: sanitizedBody) else {
                return nil
            }
            let rawCode = String(sanitizedBody[codeRange])
            guard let normalized = Self.normalizeCandidate(rawCode: rawCode, range: match.range) else {
                return nil
            }
            let code = normalized.code
            guard code.count >= 4, code.count <= 8, code.rangeOfCharacter(from: .decimalDigits) != nil else {
                return nil
            }
            guard !Self.isFalsePositive(code: code, rawCode: rawCode, body: sanitizedBody, range: normalized.range) else {
                return nil
            }

            let hasNearbyKeyword = keywordRanges.contains { keywordRange in
                NSMaxRange(keywordRange.range) >= match.range.location - 48 &&
                    keywordRange.range.location <= NSMaxRange(match.range) + 48
            }
            let contextStart = max(0, match.range.location - 28)
            let contextRange = NSRange(location: contextStart, length: match.range.location - contextStart)
            let context = NSString(string: sanitizedBody).substring(with: contextRange).lowercased()
            let explicitLabel = context.contains("code") || context.contains("otp") || context.contains("pin") || context.contains("passcode")
            let score = (explicitLabel ? 4 : 0) + (hasNearbyKeyword ? 2 : 0) + (code.allSatisfy(\.isNumber) ? 1 : 0)
            return Candidate(code: code, range: normalized.range, score: score)
        }

        guard let candidate = candidates.sorted(by: { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
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

    private static func isFalsePositive(code: String, rawCode: String, body: String, range: NSRange) -> Bool {
        let beforeStart = max(0, range.location - 18)
        let beforeRange = NSRange(location: beforeStart, length: range.location - beforeStart)
        let afterStart = NSMaxRange(range)
        let afterLength = min(18, body.utf16.count - afterStart)
        let bodyNSString = NSString(string: body)
        let context = (bodyNSString.substring(with: beforeRange) + bodyNSString.substring(with: NSRange(location: afterStart, length: afterLength))).lowercased()
        let falsePositiveWords = ["phone", "tel", "date", "order", "invoice", "amount", "price", "year", "http", "www", "reference", "ticket"]
        guard !falsePositiveWords.contains(where: context.contains) else { return true }
        if rawCode.contains(" ") || rawCode.contains("-") { return false }
        guard code.count >= 7 else { return false }
        return Self.overlapsEmailAddress(body: body, range: range)
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

    private static func normalizeCandidate(rawCode: String, range: NSRange) -> (code: String, range: NSRange)? {
        let compact = rawCode.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
        guard compact.count >= 4 else { return nil }
        if compact.allSatisfy(\.isNumber) {
            return (compact, range)
        }

        // A separator can cause a numeric code followed by a short word ("482913 to") to be
        // captured as one candidate. Keep the numeric code in that case, but preserve compact
        // digit-led alphanumeric codes such as "1234AB".
        if rawCode.contains(where: { $0 == " " || $0 == "-" }),
           let firstLetterIndex = compact.firstIndex(where: { !$0.isNumber }),
           compact[..<firstLetterIndex].count >= 4 {
            let numericPrefix = String(compact[..<firstLetterIndex])
            return (numericPrefix, NSRange(location: range.location, length: numericPrefix.utf16.count))
        }

        // The candidate pattern tolerates single separators, so a preceding word can be captured
        // together with the code ("is 482913"). Drop such a prefix only when a separator actually
        // divided it from the rest — scanning for the first digit would truncate a genuine
        // alphanumeric code that starts with letters, such as "abcd1234".
        guard let separatorIndex = rawCode.firstIndex(where: { $0 == " " || $0 == "-" }) else {
            return (compact, range)
        }
        let word = rawCode[rawCode.startIndex..<separatorIndex]
        guard !word.isEmpty, word.allSatisfy(\.isLetter) else {
            return (compact, range)
        }
        let remainder = String(rawCode[rawCode.index(after: separatorIndex)...])
        let suffix = remainder.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
        guard suffix.count >= 4, suffix.count <= 8, suffix.contains(where: \.isNumber) else {
            return (compact, range)
        }
        let offset = String(rawCode[rawCode.startIndex...separatorIndex]).utf16.count
        return (suffix, NSRange(location: range.location + offset, length: remainder.utf16.count))
    }

    private static func service(from metadata: MessageMetadata) -> String? {
        if let domainMatch = senderDomainPattern.firstMatch(in: metadata.sender, range: NSRange(metadata.sender.startIndex..., in: metadata.sender)),
           let domainRange = Range(domainMatch.range(at: 1), in: metadata.sender) {
            return String(metadata.sender[domainRange]).lowercased()
        }
        let subject = metadata.subject.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ServiceIdentity.isUsableService(subject) ? subject : nil
    }

    private static func senderLabel(from sender: String) -> String {
        let trimmed = sender.trimmingCharacters(in: .whitespacesAndNewlines)
        if let bracket = trimmed.firstIndex(of: "<") {
            return String(trimmed[..<bracket]).trimmingCharacters(in: .whitespacesAndNewlines)
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
