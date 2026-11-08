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
            request, requestKind: .signIn, ownsAttempt: { true }, send: { _ in (200, body) },
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
        #expect(observed.allSatisfy { $0.requestKind == .signIn })
        #expect(failure.capturedAt >= completed.capturedAt)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        #expect(formatter.date(from: failure.capturedAt) != nil)
        let json = try #require(String(data: JSONEncoder().encode(observed), encoding: .utf8))
        #expect(!json.contains("private") && !json.contains("synthetic"))
        #expect(!json.contains("obsidian.md"))
    }

    @Test(arguments: [
        FacetAccountExchangeDiagnostic.RequestKind.signIn, .listVaults,
    ])
    func identicalAccountRejectionsRetainTheTypedOperation(
        kind: FacetAccountExchangeDiagnostic.RequestKind
    ) async throws {
        let account = FfiObsidianAccount()
        let request: ObsidianHttpRequest
        switch kind {
        case .signIn:
            request = try account.signIn(
                email: "synthetic@example.invalid", password: "synthetic", mfa: "")
        case .listVaults:
            request = try account.listVaults(token: "synthetic-token")
        case .signOut, .vaultAccess, .userInfo:
            Issue.record("This regression exercises sign-in and subsequent vault discovery.")
            return
        }
        var observed: [FacetAccountExchangeDiagnostic] = []
        let response = try await FacetAccountHTTP.perform(
            request, requestKind: kind, ownsAttempt: { true },
            send: { _ in (200, Data("{\"error\":\"private rejection\"}".utf8)) },
            diagnostic: { observed.append($0) })
        let completed = try #require(observed.last)
        #expect(throws: ObsidianBoundaryError.self) {
            try FacetAccountHTTP.decoded(
                response, diagnostic: completed,
                decode: {
                    try account.response(requestId: request.requestId, status: $0, body: $1)
                }, publish: { observed.append($0) })
        }
        let failure = try #require(observed.last)
        #expect(failure.statusCode == 200 && failure.boundaryCode == "account_rejected")
        #expect(failure.failureClassification == "account_rejected")
        #expect(observed.allSatisfy { $0.requestKind == kind })
        #expect(Set(observed.map(\.requestID)).count == 1)
        #expect(observed.contains { $0.stage == .preflight } == (kind == .signIn))
        let encoded = try FacetJSON.parse(JSONEncoder().encode(failure))
        let fields = try #require(encoded.object?.fields)
        #expect(
            Set(fields.keys) == [
                "requestKind", "stage", "statusCode", "failureClassification", "boundaryCode",
                "requestID", "capturedAt",
            ])
        #expect(fields["requestKind"]?.text == kind.rawValue)
        let json = try FacetJSON.encode(encoded)
        #expect(!json.contains("private") && !json.contains("synthetic"))
        #expect(!json.contains("obsidian.md"))
    }

    @Test(arguments: FacetAccountExchangeDiagnostic.RequestKind.allCases)
    func serializedOperationsAreClosedAndRoundTrip(
        kind: FacetAccountExchangeDiagnostic.RequestKind
    ) throws {
        let diagnostic = FacetAccountExchangeDiagnostic(
            requestKind: kind, stage: .post, statusCode: 200, failureClassification: nil)
        let data = try JSONEncoder().encode(diagnostic)
        #expect(
            try JSONDecoder().decode(FacetAccountExchangeDiagnostic.self, from: data) == diagnostic)
        let unknown = try #require(String(data: data, encoding: .utf8)).replacingOccurrences(
            of: kind.rawValue, with: "unknown_private_operation")
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(FacetAccountExchangeDiagnostic.self, from: Data(unknown.utf8))
        }
    }

    @Test func successfulSignInThenRejectedVaultListNamesTheFailedOperation() async throws {
        let account = FfiObsidianAccount()
        var observed: [FacetAccountExchangeDiagnostic] = []
        func respond(
            _ request: ObsidianHttpRequest,
            kind: FacetAccountExchangeDiagnostic.RequestKind, body: String
        ) async throws -> ObsidianAccountResponse {
            let response = try await FacetAccountHTTP.perform(
                request, requestKind: kind, ownsAttempt: { true },
                send: { _ in (200, Data(body.utf8)) }, diagnostic: { observed.append($0) })
            let completed = try #require(observed.last)
            return try FacetAccountHTTP.decoded(
                response, diagnostic: completed,
                decode: {
                    try account.response(requestId: request.requestId, status: $0, body: $1)
                }, publish: { observed.append($0) })
        }
        let signedIn = try await respond(
            account.signIn(email: "synthetic@example.invalid", password: "synthetic", mfa: ""),
            kind: .signIn,
            body: """
                {"token":"synthetic-token","name":"Fixture","email":"synthetic@example.invalid"}
                """)
        guard case .signedIn(let token, _, _) = signedIn else {
            Issue.record("The synthetic sign-in must succeed before vault discovery.")
            return
        }
        let signInReceipt = try #require(observed.last)
        #expect(signInReceipt.requestKind == .signIn && signInReceipt.boundaryCode == nil)
        await #expect(throws: ObsidianBoundaryError.self) {
            try await respond(
                account.listVaults(token: token), kind: .listVaults,
                body: "{\"error\":\"private rejection\"}")
        }
        let failure = try #require(observed.last)
        #expect(failure.requestKind == .listVaults && failure.statusCode == 200)
        #expect(failure.boundaryCode == "account_rejected")
        #expect(failure.requestID != signInReceipt.requestID)
        #expect(Set(observed.map(\.requestID)).count == 2)
        let json = try #require(String(data: JSONEncoder().encode(observed), encoding: .utf8))
        #expect(!json.contains("private") && !json.contains("synthetic"))
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

#if DEBUG
    @Suite @MainActor struct FacetAcceptanceAccountHTTPFixtureTests {
        @Test func originalHTTPAndRustDecoderProduceOnlySyntheticMFAChallenge() async throws {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(
                "facet-mfa-http-" + UUID().uuidString
            ).resolvingSymlinksInPath()
            defer { NativeTestFiles.remove(root) }
            let (fixture, normalDirectory) = try fixture(root: root)
            let account = FfiObsidianAccount()
            let request = try account.signIn(
                email: "facet-probe-" + UUID().uuidString + "@example.invalid",
                password: "Facet-private-probe-" + UUID().uuidString + "-q7!", mfa: "")
            var observed: [FacetAccountExchangeDiagnostic] = []
            let response = try await FacetAccountHTTP.perform(
                request, requestKind: .signIn, ownsAttempt: { true },
                send: { try fixture.response($0) }, diagnostic: { observed.append($0) })
            let completed = try #require(observed.last)
            let decoded = try FacetAccountHTTP.decoded(
                response, diagnostic: completed,
                decode: {
                    try account.response(requestId: request.requestId, status: $0, body: $1)
                },
                publish: { observed.append($0) })
            guard case .mfaRequired = decoded else {
                Issue.record("The original Rust decoder must require MFA, never authenticate.")
                return
            }
            #expect(observed.map(\.stage) == [.preflight, .preflight, .post, .post])
            #expect(fixture.directory.deletingLastPathComponent().path == normalDirectory.path)
            #expect(fixture.directory != normalDirectory)
            #expect(
                !FileManager.default.fileExists(
                    atPath: normalDirectory.appendingPathComponent("sync-identities.json").path))
            #expect(throws: FacetAcceptanceError.self) {
                _ = try fixture.response(URLRequest(url: #require(URL(string: request.url))))
            }
        }

        @Test(arguments: ["wrong-endpoint", "post-first", "extra-header", "real-email", "mfa-code"])
        func unexpectedRequestBurnsFixtureWithoutNetworkFallback(fault: String) throws {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(
                "facet-mfa-reject-" + UUID().uuidString
            ).resolvingSymlinksInPath()
            defer { NativeTestFiles.remove(root) }
            let (fixture, _) = try fixture(root: root)
            var request = try syntheticRequest()
            if fault == "post-first" {
                request.httpMethod = "POST"
            } else {
                if fault == "wrong-endpoint" {
                    request.url = request.url?.appendingPathComponent("unexpected")
                }
                if fault == "extra-header" {
                    request.setValue("synthetic", forHTTPHeaderField: "Authorization")
                }
                if fault == "real-email" || fault == "mfa-code" {
                    _ = try fixture.response(request)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONSerialization.data(withJSONObject: [
                        "email": fault == "real-email"
                            ? "someone@example.invalid"
                            : "facet-probe-" + UUID().uuidString + "@example.invalid",
                        "password": "Facet-private-probe-" + UUID().uuidString + "-q7!",
                        "mfa": fault == "mfa-code" ? "246802" : "",
                    ])
                }
            }
            #expect(throws: FacetAcceptanceError.self) { _ = try fixture.response(request) }
            #expect(throws: FacetAcceptanceError.self) {
                _ = try fixture.response(syntheticRequest())
            }
        }

        @Test func fixtureCannotRedirectOrReuseAccountDirectoryAndHasNoCredentialStore() throws {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(
                "facet-mfa-owner-" + UUID().uuidString
            ).resolvingSymlinksInPath()
            defer { NativeTestFiles.remove(root) }
            let (fixture, directory) = try fixture(root: root)
            let receipt = fixture.directory.appendingPathComponent("identity.json")
            let fields = try #require(
                JSONSerialization.jsonObject(with: Data(contentsOf: receipt)) as? [String: Any])
            #expect(Set(fields.keys) == ["schemaVersion", "mode", "runID", "sessionID"])
            #expect(fields["schemaVersion"] as? Int == 1)
            #expect(fields["mode"] as? String == "fixture-verification")
            #expect(fields["runID"] as? String == fixture.identity.runID.uuidString.lowercased())
            #expect(
                fields["sessionID"] as? String == fixture.identity.sessionID.uuidString.lowercased()
            )
            let attributes = try FileManager.default.attributesOfItem(atPath: receipt.path)
            #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
            let configuration = try configuration(root: root, run: fixture.identity.runID)
            #expect(throws: FacetAcceptanceError.self) {
                try FacetAcceptanceAccountHTTPFixture(
                    configuration: configuration, accountDirectory: directory,
                    sessionID: fixture.identity.sessionID, schema: schema())
            }
            #expect(throws: FacetAcceptanceError.self) {
                try FacetAcceptanceAccountHTTPFixture(
                    configuration: configuration, accountDirectory: root,
                    sessionID: UUID(), schema: schema())
            }
            let secrets = FacetAcceptanceAccountNoAuthStore()
            #expect(throws: FacetAcceptanceError.self) { try secrets.read("synthetic") }
            #expect(throws: FacetAcceptanceError.self) {
                try secrets.write("synthetic", bytes: Data("public".utf8))
            }
            #expect(throws: FacetAcceptanceError.self) { try secrets.remove("synthetic") }
        }

        private func fixture(root: URL) throws -> (FacetAcceptanceAccountHTTPFixture, URL) {
            let configuration = try configuration(root: root, run: UUID())
            let accounts = configuration.stateDirectory.appendingPathComponent("accounts")
            return (
                try FacetAcceptanceAccountHTTPFixture(
                    configuration: configuration, accountDirectory: accounts,
                    sessionID: UUID(), schema: schema()), accounts
            )
        }

        private func configuration(root: URL, run: UUID) throws -> FacetAcceptanceConfiguration {
            let state = root.appendingPathComponent("FacetAcceptance")
                .appendingPathComponent(run.uuidString.lowercased())
            let data = try JSONSerialization.data(withJSONObject: [
                "schemaVersion": 1, "runID": run.uuidString, "stateDirectory": state.path,
                "allowedRemoteVaultID": NSNull(),
            ])
            return try FacetAcceptanceConfiguration.decode(data, applicationSupport: root)
        }

        private func schema() throws -> Data {
            try Data(
                contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                    .appendingPathComponent(
                        "../../../../tasks-for-obsidian/scripts/ios-account/account-input.schema.json"
                    ))
        }

        private func syntheticRequest() throws -> URLRequest {
            let generated = try FfiObsidianAccount().signIn(
                email: "synthetic@example.invalid", password: "synthetic", mfa: "")
            var request = URLRequest(url: try #require(URL(string: generated.url)))
            request.httpMethod = "OPTIONS"
            let origin = try #require(generated.headers.first { $0.name.lowercased() == "origin" })
            request.setValue(origin.value, forHTTPHeaderField: "Origin")
            return request
        }
    }
#endif
