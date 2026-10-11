import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

@Suite @MainActor struct FacetAccountResponseDiagnosticTests {
    @Test(arguments: [
        (
            Data("{\"error\":\"private account response\"}".utf8), "account_rejected",
            "account_rejected"
        ),
        (Data("{\"unexpected\":\"private token\"}".utf8), "internal_contract", "protocol"),
        (Data([0xFF]), "internal_contract", nil),
    ])
    func actualAccountDecodeFailureRetainsHTTPStatusAndExactRequest(
        body: Data, classification: String, code: String?
    ) async throws {
        let account = FfiObsidianAccount()
        let request = try account.signIn(
            email: "synthetic@example.invalid", password: "synthetic", mfa: "")
        var observed: [FacetAccountExchangeDiagnostic] = []
        let response = try await FacetAccountHTTP.perform(
            request, ownsAttempt: { true }, send: { _ in (200, body) },
            diagnostic: { observed.append($0) })
        let completed = try #require(observed.last)
        #expect(completed.failureClassification == nil && completed.statusCode == 200)
        do {
            _ = try FacetAccountHTTP.decoded(
                response, diagnostic: completed,
                decode: {
                    try account.response(requestId: request.requestId, status: $0, body: $1)
                },
                publish: { observed.append($0) })
            Issue.record("The malformed or rejected account response must fail.")
        } catch {
            #expect(FacetFailureDiagnostic(error).classification == classification)
        }
        let failure = try #require(observed.last)
        #expect(failure.stage == .post && failure.statusCode == 200)
        #expect(failure.failureClassification == classification && failure.boundaryCode == code)
        #expect(Set(observed.map(\.requestID)).count == 1)
        #expect(failure.requestID == completed.requestID)
        #expect(failure.capturedAt >= completed.capturedAt)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        #expect(formatter.date(from: failure.capturedAt) != nil)
        let json = try #require(String(data: JSONEncoder().encode(observed), encoding: .utf8))
        #expect(!json.contains("private") && !json.contains("synthetic"))
        #expect(!json.contains("obsidian.md"))
    }

    @Test func onlyKnownBoundaryCodesCanEnterDiagnostics() throws {
        let privateText = "private email token and URL"
        let rejected = FacetFailureDiagnostic(
            ObsidianBoundaryError.Boundary(code: "account_rejected", detail: privateText))
        #expect(rejected.classification == "account_rejected")
        #expect(rejected.boundaryCode == "account_rejected")
        let unknown = FacetFailureDiagnostic(
            ObsidianBoundaryError.Boundary(code: privateText, detail: privateText))
        #expect(unknown.classification == "sync_boundary" && unknown.boundaryCode == nil)
        #expect(!unknown.chain.contains(privateText) && !unknown.action.contains(privateText))
    }
}
