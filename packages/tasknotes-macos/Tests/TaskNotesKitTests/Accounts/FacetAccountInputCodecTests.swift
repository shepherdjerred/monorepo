import Foundation
import Testing

struct FacetAccountInputCodecTests {
    private let run = "12345678-1234-4234-9234-123456789abc"
    private let session = "22345678-1234-4234-9234-123456789abc"
    private let device = "32345678-1234-4234-9234-123456789abc"
    private let request = "42345678-1234-4234-9234-123456789abc"

    private func boundary() throws -> AccountInputProtocol {
        let identity = try AccountInputIdentity(environment: [
            "FACET_E2E_ACCOUNT_SESSION": session, "FACET_E2E_RUN_ID": run,
            "FACET_E2E_SIMULATOR": device, "SIMULATOR_UDID": device,
        ])
        let schema = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent(
                "../../../../tasks-for-obsidian/scripts/ios-account/account-input.schema.json"
            )
            .standardizedFileURL
        return try AccountInputProtocol(identity: identity, schemaData: Data(contentsOf: schema))
    }

    private func envelope(_ kind: String) -> [String: Any] {
        [
            "schemaVersion": 1, "sessionID": session, "runID": run,
            "deviceID": device, "requestID": request, "kind": kind,
        ]
    }

    @Test func everyCommandUsesTheActualDecoderAndNeutralSchema() throws {
        let codec = try boundary()
        let additions: [String: [String: Any]] = [
            "fill": ["email": "synthetic@example.invalid", "password": "synthetic-only"],
            "submit": [:], "observe": [:], "finish": [:],
            "fill-verification": ["code": "123456"], "submit-verification": [:],
            "fill-vault-password": ["vaultPassword": "synthetic-vault-only"],
            "connect": ["remoteVaultID": "owned-remote", "profileID": run],
        ]
        #expect(additions.count == 8)
        for (kind, fields) in additions {
            let value = envelope(kind).merging(fields) { _, replacement in replacement }
            let command = try codec.command(JSONSerialization.data(withJSONObject: value))
            #expect(command.kind.rawValue == kind)
            #expect(command.requestID == request)
            #expect(codec.identity.matches(command))
        }
    }

    @Test func everyReplyUsesTheActualEncoderAndNeutralSchema() throws {
        let codec = try boundary()
        var count = 0
        for stage in ["credentials", "verification", "vaults"] {
            var reply = AccountInputReply(codec.identity, kind: .ready)
            reply.runnerPID = 501
            reply.stage = stage
            try assertReply(codec, reply: reply)
            count += 1
        }
        for stage in ["verification", "vaults", "connected", "rejected"] {
            var reply = AccountInputReply(codec.identity, kind: .observed, requestID: request)
            reply.stage = stage
            try assertReply(codec, reply: reply)
            count += 1
        }
        for kind: AccountInputReply.Kind in [
            .filled, .submitted, .verificationFilled, .verificationSubmitted,
            .vaultPasswordFilled, .connectSubmitted, .finished, .rejected,
        ] {
            var reply = AccountInputReply(codec.identity, kind: kind, requestID: request)
            reply.submitActionCount =
                [.submitted, .verificationSubmitted, .connectSubmitted]
                    .contains(kind) ? 1 : 0
            if kind == .filled || kind == .verificationFilled { reply.signInEnabled = true }
            if kind == .filled { reply.disabledCheckpoints = 2 }
            if kind == .vaultPasswordFilled {
                reply.disabledCheckpoints = 1
                reply.connectEnabled = true
            }
            if kind == .rejected { reply.reason = "form" }
            try assertReply(codec, reply: reply)
            count += 1
        }
        #expect(count == 15)
    }

    private func assertReply(_ codec: AccountInputProtocol, reply: AccountInputReply) throws {
        let data = try codec.reply(reply)
        #expect(data.last == 10)
        let encoded = try JSONDecoder().decode(ReplyIdentity.self, from: data)
        #expect(encoded.sessionID == session && encoded.runID == run && encoded.deviceID == device)
        #expect(encoded.kind == reply.kind.rawValue)
    }

    private struct ReplyIdentity: Decodable {
        let sessionID: String
        let runID: String
        let deviceID: String
        let kind: String
    }

    @Test func malformedForeignAndExtraFieldsFailBeforeDispatch() throws {
        let codec = try boundary()
        let valid = envelope("fill").merging([
            "email": "synthetic@example.invalid", "password": "synthetic-only",
        ]) { _, replacement in replacement }
        for changes: [String: Any] in [
            ["sessionID": request], ["runID": request], ["deviceID": request],
            ["requestID": "malformed"], ["extra": true], ["kind": "unknown"],
            ["password": ""], ["code": "123456"], ["schemaVersion": 2],
        ] {
            let value = valid.merging(changes) { _, replacement in replacement }
            #expect(throws: AccountInputFailure.self) {
                try codec.command(JSONSerialization.data(withJSONObject: value))
            }
        }
        var incomplete = valid
        incomplete.removeValue(forKey: "password")
        #expect(throws: AccountInputFailure.self) {
            try codec.command(JSONSerialization.data(withJSONObject: incomplete))
        }
        #expect(throws: AccountInputFailure.self) { try codec.command(Data("{".utf8)) }
        var reply = AccountInputReply(codec.identity, kind: .finished, requestID: request)
        reply.submitActionCount = 4
        #expect(throws: AccountInputFailure.self) { try codec.reply(reply) }
    }
}
