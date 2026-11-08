import Foundation
import TaskNotesKit
import Testing

struct FacetAccountInputPhaseTests {
    private struct ExpectedLimits {
        let runner: Int
        let app: Int
        let initial: [String]
        let finish: [String]
    }
    private struct IntentCase {
        let operation: AccountInputOperation
        let kind: String
        let action: String
    }
    private struct AppCase {
        let operation: AccountInputOperation
        let stage: String
        let forbidden: [String]
    }
    private let run = "12345678-1234-4234-9234-123456789abc"
    private let session = "22345678-1234-4234-9234-123456789abc"
    private let device = "32345678-1234-4234-9234-123456789abc"
    private let request = "42345678-1234-4234-9234-123456789abc"
    private func boundary() throws -> AccountInputProtocol {
        let identity = try AccountInputIdentity(environment: [
            "FACET_E2E_ACCOUNT_SESSION": session, "FACET_E2E_RUN_ID": run,
            "FACET_E2E_SIMULATOR": device, "SIMULATOR_UDID": device,
        ])
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent(
                "../../../../tasks-for-obsidian/scripts/ios-account/account-input.schema.json")
        return try AccountInputProtocol(identity: identity, schemaData: Data(contentsOf: url))
    }
    private func envelope(_ kind: String) -> [String: Any] {
        [
            "schemaVersion": 1, "sessionID": session, "runID": run, "deviceID": device,
            "requestID": request, "kind": kind,
        ]
    }
    private func requests(_ operation: AccountInputOperation) throws -> AccountInputRequests {
        AccountInputRequests(
            operation: operation, limits: try boundary().phases.limits(for: operation))
    }
    @Test func neutralPhaseLimitsAndInitialFinishStagesAreConsumedByOriginalRunnerAdmission() throws
    {
        let phases = try boundary().phases
        #expect(phases.sessionSeconds == 120)
        let expected: [AccountInputOperation: ExpectedLimits] = [
            .probe: ExpectedLimits(
                runner: 4, app: 4, initial: ["credentials"], finish: ["credentials"]),
            .fixtureVerification: ExpectedLimits(
                runner: 7, app: 5, initial: ["credentials"], finish: ["verification"]),
            .authOnly: ExpectedLimits(
                runner: 9, app: 5, initial: ["credentials", "verification"], finish: ["vaults"]),
            .connectOnly: ExpectedLimits(
                runner: 5, app: 2, initial: ["vaults"], finish: ["connected"]),
        ]
        for (operation, value) in expected {
            let limits = try phases.limits(for: operation)
            #expect(limits.runnerCommandLimit == value.runner)
            #expect(limits.appCommandLimit == value.app)
            #expect(limits.initialStages == value.initial)
            #expect(limits.finishStages == value.finish)
        }
        for (operation, forbidden): (AccountInputOperation, [AccountInputCommand.Kind]) in [
            (.authOnly, [.connect, .fillVaultPassword, .checkpointVaultEmpty]),
            (
                .connectOnly,
                [.submit, .submitVerification, .fill, .fillVerification, .checkpointEmpty]
            ),
        ] {
            for kind in forbidden {
                var state = try requests(operation)
                #expect(throws: AccountInputFailure.self) {
                    try state.admit(UUID().uuidString, kind: kind)
                }
            }
        }
    }

    @Test func originalIntentEncodingIsPhaseClosedAndSubmissionAcknowledgementRequiresIntent()
        throws
    {
        let codec = try boundary()
        for fixture in [
            IntentCase(operation: .authOnly, kind: "submit", action: "credentials"),
            IntentCase(operation: .authOnly, kind: "submit-verification", action: "verification"),
            IntentCase(operation: .fixtureVerification, kind: "submit", action: "credentials"),
            IntentCase(operation: .connectOnly, kind: "connect", action: "connect"),
        ] {
            var value = envelope(fixture.kind)
            if fixture.kind == "submit-verification" {
                value["expiresAtUnixMilliseconds"] = 1_793_161_000_000
            }
            if fixture.kind == "connect" { value["remoteVaultID"] = "owned-remote" }
            let command = try codec.command(JSONSerialization.data(withJSONObject: value))
            let intent = try codec.intent(operation: fixture.operation, command: command)
            let object = try JSONSerialization.jsonObject(with: intent) as? [String: Any]
            #expect(object?["action"] as? String == fixture.action)
            #expect(object?["operation"] as? String == fixture.operation.rawValue)
            #expect(object?["requestID"] as? String == request)
            let wrong: AccountInputOperation =
                fixture.operation == .connectOnly ? .authOnly : .connectOnly
            #expect(throws: (any Error).self) {
                try codec.intent(operation: wrong, command: command)
            }
        }
        var reply = AccountInputReply(codec.identity, kind: .submitted, requestID: request)
        reply.submitActionCount = 1
        #expect(throws: AccountInputFailure.self) { try codec.reply(reply) }
        reply.intentRecorded = true
        _ = try codec.reply(reply)
    }

    @Test func originalDurableIntentStorageIsExclusiveAndDoesNotFollowSymlinks() throws {
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent(
                "facet-original-intent-controls-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(
            at: parent, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer {
            do { try FileManager.default.removeItem(at: parent) } catch {
                Issue.record("Owned intent fixture cleanup failed")
            }
        }
        let directory = parent.appendingPathComponent("session")
        let store = try AccountInputIntents(testDirectory: directory)
        let codec = try boundary()
        let command = try codec.command(JSONSerialization.data(withJSONObject: envelope("submit")))
        let bytes = try codec.intent(operation: .authOnly, command: command)
        try store.record(bytes, action: "credentials")
        #expect(try Data(contentsOf: directory.appendingPathComponent("credentials.json")) == bytes)
        #expect(throws: AccountInputFailure.self) { try store.record(bytes, action: "credentials") }
        let untouched = parent.appendingPathComponent("untouched.json")
        try Data("public-fixture".utf8).write(to: untouched)
        try FileManager.default.createSymbolicLink(
            at: directory.appendingPathComponent("verification.json"), withDestinationURL: untouched
        )
        #expect(throws: AccountInputFailure.self) {
            try store.record(bytes, action: "verification")
        }
        #expect(try Data(contentsOf: untouched) == Data("public-fixture".utf8))
        let mode =
            try FileManager.default.attributesOfItem(
                atPath: directory.appendingPathComponent("credentials.json").path)[
                .posixPermissions]
            as? NSNumber
        #expect(mode?.intValue == 0o600)
    }

    @Test func originalAppAdmissionRejectsOtherPhaseActionsBeforeApply() throws {
        let phases = try boundary().phases
        for fixture in [
            AppCase(
                operation: .authOnly, stage: "vaults", forbidden: ["clear-vault", "vault-password"]),
            AppCase(
                operation: .connectOnly, stage: "vaults",
                forbidden: ["clear", "email", "password", "verification", "finish"]),
        ] {
            let limits = try phases.limits(for: fixture.operation)
            for action in fixture.forbidden {
                var state = FacetAcceptanceInputAdmission(
                    initialStage: fixture.stage, bindRequest: request,
                    allowedActions: Set(limits.allowedAppKinds),
                    maximumActions: limits.appCommandLimit)
                let admitted = state.admit(
                    request: UUID().uuidString, action: action, stage: fixture.stage)
                #expect(!admitted)
            }
        }
    }
}
