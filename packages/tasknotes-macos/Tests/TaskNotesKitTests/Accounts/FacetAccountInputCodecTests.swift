import Foundation
import TaskNotesKit
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
            "fill": [:],
            "submit": [:], "observe": [:], "finish": [:],
            "fill-verification": ["expiresAtUnixMilliseconds": 1_793_161_000_000],
            "submit-verification": ["expiresAtUnixMilliseconds": 1_793_161_000_000],
            "fill-vault-password": [:],
            "checkpoint-empty": [:], "checkpoint-email": [:], "checkpoint-vault-empty": [:],
            "connect": ["remoteVaultID": "owned-remote", "profileID": run],
        ]
        #expect(additions.count == 11)
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
            reply.operation = .probe
            reply.clockUnixMilliseconds = 1_793_161_000_000
            try assertReply(codec, reply: reply)
            count += 1
        }
        for stage in ["verification", "vaults", "connected", "rejected"] {
            var reply = AccountInputReply(codec.identity, kind: .observed, requestID: request)
            reply.stage = stage
            try assertReply(codec, reply: reply)
            count += 1
        }
        for point in ["empty", "email", "vault-empty"] {
            var reply = AccountInputReply(codec.identity, kind: .checkpoint, requestID: request)
            reply.point = point
            reply.submitActionCount = 0
            try assertReply(codec, reply: reply)
            count += 1
        }
        for kind: AccountInputReply.Kind in [
            .filled, .submitted, .verificationFilled, .verificationSubmitted,
            .vaultPasswordFilled, .connectSubmitted, .finished, .rejected,
        ] {
            var reply = AccountInputReply(codec.identity, kind: kind, requestID: request)
            if kind != .rejected {
                reply.submitActionCount =
                    [.submitted, .verificationSubmitted, .connectSubmitted]
                        .contains(kind) ? 1 : 0
            }
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
        #expect(count == 18)
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
        let valid = envelope("fill")
        for changes: [String: Any] in [
            ["sessionID": request], ["runID": request], ["deviceID": request],
            ["requestID": "malformed"], ["extra": true], ["kind": "unknown"],
            ["password": ""], ["code": "123456"], ["schemaVersion": 2],
            ["expiresAtUnixMilliseconds": 1_793_161_000_000],
        ] {
            let value = valid.merging(changes) { _, replacement in replacement }
            #expect(throws: AccountInputFailure.self) {
                try codec.command(JSONSerialization.data(withJSONObject: value))
            }
        }
        var incomplete = valid
        incomplete.removeValue(forKey: "requestID")
        #expect(throws: AccountInputFailure.self) {
            try codec.command(JSONSerialization.data(withJSONObject: incomplete))
        }
        #expect(throws: AccountInputFailure.self) { try codec.command(Data("{".utf8)) }
        var reply = AccountInputReply(codec.identity, kind: .finished, requestID: request)
        reply.submitActionCount = 4
        #expect(throws: AccountInputFailure.self) { try codec.reply(reply) }
    }

    @Test func runnerReplayAndThirteenCommandBoundUseProductionAdmission() throws {
        var requests = AccountInputRequests(operation: .credentials)
        for _ in 0..<13 { try requests.admit(UUID().uuidString, kind: .observe) }
        #expect(throws: AccountInputFailure.self) {
            try requests.admit(UUID().uuidString, kind: .observe)
        }
        var repeated = AccountInputRequests(operation: .credentials)
        try repeated.admit(request, kind: .observe)
        #expect(throws: AccountInputFailure.self) { try repeated.admit(request, kind: .observe) }
        for kind: AccountInputCommand.Kind in [.submit, .submitVerification, .connect] {
            var probe = AccountInputRequests(operation: .probe)
            var willSubmitCalled = false
            do {
                try probe.admit(UUID().uuidString, kind: kind)
                willSubmitCalled = true
            } catch {}
            #expect(!willSubmitCalled)
        }
    }
}

extension FacetAccountInputCodecTests {
    @Test func fixtureAllowsOneInitialSubmitAndForbidsCodeSubmitOrConnectBeforeDispatch() throws {
        var fixture = AccountInputRequests(operation: .fixtureVerification)
        try fixture.admit(UUID().uuidString, kind: .submit)
        for kind: AccountInputCommand.Kind in [.submit, .submitVerification, .connect] {
            var wouldSubmit = false
            do {
                try fixture.admit(UUID().uuidString, kind: kind)
                wouldSubmit = true
            } catch {}
            #expect(!wouldSubmit)
        }
        #expect(AccountInputOperation.fixtureVerification.appMode == "fixture-verification")
        #expect(AccountInputOperation.probe.appMode == "account")
    }

    @Test func verificationExpiryIsRequiredOnlyOnCodeCommands() throws {
        let codec = try boundary()
        for kind in ["fill-verification", "submit-verification"] {
            #expect(throws: AccountInputFailure.self) {
                try codec.command(JSONSerialization.data(withJSONObject: envelope(kind)))
            }
        }
    }

    @Test func verificationAdmissionBindsExpiryAndRejectsExpiredCodeWithoutGrace() throws {
        let timing = try boundary().verificationTiming
        let now: Int64 = 1_793_161_000_000
        var admission = AccountInputVerificationAdmission()
        try admission.filled(now + 10000, timing: timing, now: now)
        try admission.requireSubmit(now + 10000, timing: timing, now: now + 9999)
        #expect(throws: AccountInputFailure.self) {
            try admission.requireSubmit(now + 10000, timing: timing, now: now + 10000)
        }
        #expect(throws: AccountInputFailure.self) {
            try admission.requireSubmit(now + 10001, timing: timing, now: now)
        }
        #expect(throws: AccountInputFailure.self) {
            try admission.filled(now + 20000, timing: timing, now: now)
        }
        for expiry in [
            now, now - 1,
            now + timing.maximumValidityMilliseconds
                + timing.maximumClockSkewMilliseconds + 1, Int64.min,
        ] {
            #expect(throws: AccountInputFailure.self) {
                try timing.requireLive(expiry, now: now)
            }
        }
    }

    @Test func appValueAdmissionIsFiniteStageBoundAndBurnsAfterFinishOrOwnerLoss() {
        var state = FacetAcceptanceInputAdmission(initialStage: "credentials", bindRequest: request)
        for (action, stage) in [
            ("clear", "credentials"), ("email", "credentials"), ("password", "credentials"),
            ("verification", "verification"), ("clear-vault", "vaults"),
            ("vault-password", "vaults"), ("finish", "vaults"),
        ] {
            let admitted = state.admit(request: UUID().uuidString, action: action, stage: stage)
            #expect(admitted)
        }
        let afterFinish = state.admit(
            request: UUID().uuidString, action: "email", stage: "credentials")
        #expect(!afterFinish)
        for (action, stage) in [
            ("password", "credentials"), ("email", "vaults"), ("verification", "credentials"),
            ("vault-password", "vaults"),
        ] {
            var wrong = FacetAcceptanceInputAdmission(
                initialStage: "credentials", bindRequest: request)
            let admitted = wrong.admit(request: UUID().uuidString, action: action, stage: stage)
            #expect(!admitted)
        }
        var background = FacetAcceptanceInputAdmission(
            initialStage: "credentials", bindRequest: request)
        background.invalidate()
        let afterBackground = background.admit(
            request: UUID().uuidString, action: "clear", stage: "credentials")
        #expect(!afterBackground)
    }

    @Test func appAndBridgeFramesUseTheActualNativeSchemaValidator() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent(
                "../../../../tasks-for-obsidian/scripts/ios-account/account-input.schema.json"
            )
            .standardizedFileURL
        let schema = try FacetSchema(data: Data(contentsOf: url))
        for fixture in appCommandFixtures {
            let action = fixture.action
            let stage = fixture.stage
            var frame = envelope(action)
            frame["formEpoch"] = request
            frame["token"] = String(repeating: "a", count: 64)
            frame["expectedStage"] = stage
            if let value = fixture.value { frame["value"] = value }
            if action == "verification" { frame["expiresAtUnixMilliseconds"] = 1_793_161_000_000 }
            try schema.validate(
                data: JSONSerialization.data(withJSONObject: frame), definition: "app-command")
            var wrongExpiry = frame
            if action == "verification" {
                wrongExpiry.removeValue(forKey: "expiresAtUnixMilliseconds")
            } else {
                wrongExpiry["expiresAtUnixMilliseconds"] = 1_793_161_000_000
            }
            #expect(throws: (any Error).self) {
                try schema.validate(
                    data: JSONSerialization.data(withJSONObject: wrongExpiry),
                    definition: "app-command")
            }
            #expect(throws: (any Error).self) {
                try schema.validate(
                    data: JSONSerialization.data(withJSONObject: frame), definition: "command")
            }
            if action != "bind" && action != "finish" {
                frame["expectedStage"] = stage == "credentials" ? "vaults" : "credentials"
                #expect(throws: (any Error).self) {
                    try schema.validate(
                        data: JSONSerialization.data(withJSONObject: frame),
                        definition: "app-command")
                }
            }
        }
        for kind in ["listening", "peer"] {
            try schema.validate(
                data: JSONSerialization.data(withJSONObject: ["kind": kind, "pid": 501, "uid": 501]
                ), definition: "bridge-packet")
        }
    }

    private struct FrameFixture {
        let action: String
        let stage: String
        var value: String?
    }

    private var appCommandFixtures: [FrameFixture] {
        [
            FrameFixture(action: "bind", stage: "credentials"),
            FrameFixture(action: "clear", stage: "credentials"),
            FrameFixture(action: "email", stage: "credentials", value: "synthetic@example.invalid"),
            FrameFixture(
                action: "password", stage: "credentials", value: "synthetic-only-password"),
            FrameFixture(action: "verification", stage: "verification", value: "123456"),
            FrameFixture(action: "clear-vault", stage: "vaults"),
            FrameFixture(action: "vault-password", stage: "vaults", value: "synthetic-vault-only"),
            FrameFixture(action: "finish", stage: "vaults"),
        ]
    }

    @Test func appHelloRequiresExplicitModeFixtureConfirmationAndClock() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent(
                "../../../../tasks-for-obsidian/scripts/ios-account/account-input.schema.json"
            ).standardizedFileURL
        let schema = try FacetSchema(data: Data(contentsOf: url))
        var hello = envelope("hello")
        hello.removeValue(forKey: "requestID")
        hello.merge([
            "formEpoch": request, "token": String(repeating: "a", count: 64),
            "appPID": 501, "stage": "credentials", "mode": "account",
            "fixtureConfirmed": false, "clockUnixMilliseconds": 1_793_161_000_000,
        ]) { _, replacement in replacement }
        try schema.validate(
            data: JSONSerialization.data(withJSONObject: hello), definition: "app-reply")
        for name in ["mode", "fixtureConfirmed", "clockUnixMilliseconds"] {
            var missing = hello
            missing.removeValue(forKey: name)
            #expect(throws: (any Error).self) {
                try schema.validate(
                    data: JSONSerialization.data(withJSONObject: missing), definition: "app-reply")
            }
        }
        hello["expiresAtUnixMilliseconds"] = 1_793_161_000_000
        #expect(throws: (any Error).self) {
            try schema.validate(
                data: JSONSerialization.data(withJSONObject: hello), definition: "app-reply")
        }
    }
}
