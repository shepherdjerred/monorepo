import AppKit
import ApplicationServices
import Foundation

final class MacAccountSession {
    let request: MacInputRequest
    let stream: MacInputStream
    let intentPath: String
    var intentRecorded = false
    var verificationSubmits = 0

    init(_ input: [String: Any], stream: MacInputStream) throws {
        self.stream = stream
        let program = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        request = try MacInputRequest(
            input, helperDirectory: program.deletingLastPathComponent().path)
        guard macInputSHA(try macInputBytes(program.path, maximum: 16_777_216)) == request.helperSHA
        else {
            throw MacInputFailure.proof
        }
        try bind(input)
        try validateManifest()
        let root = state + "/account-input"
        try macInputDirectory(root, create: true)
        let intents = root + "/intents"
        try macInputDirectory(intents, create: true)
        let suffix = lifecycle.map { "-\($0.round)-\($0.profileID)" } ?? ""
        intentPath =
            intents + "/" + (request.probe ? request.sessionID : request.operation + suffix)
            + ".json"
        try requireNoIntent()
        if request.probe {
            try validateFixture()
        } else {
            try validateApproval()
        }
    }

    func requireNoIntent() throws {
        var metadata = stat()
        guard lstat(intentPath, &metadata) == -1, errno == ENOENT else {
            throw MacInputFailure.intent
        }
    }

    func validateApproval() throws {
        let bytes = try macInputBytes(state + "/account-input/private-input-approved.json")
        guard let config = guestConfigSHA256 else { throw MacInputFailure.proof }
        try validateMacInputApproval(bytes, request: request, runID: runID, configSHA: config)
    }

    func validateFixture() throws {
        let path = state + "/accounts/verification-fixture-" + request.sessionID
        try macInputDirectory(path)
        let bytes = try macInputBytes(path + "/identity.json")
        guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            Set(value.keys) == ["schemaVersion", "mode", "runID", "sessionID"],
            value["schemaVersion"] as? Int == 1,
            value["mode"] as? String == "fixture-verification",
            value["runID"] as? String == runID,
            value["sessionID"] as? String == request.sessionID
        else { throw MacInputFailure.proof }
    }

    func owner(stage: String, requestID: UUID?) throws -> Owner {
        try stream.live()
        guard let pid = request.input["pid"] as? Int, pid > 0, pid <= Int(Int32.max) else {
            throw Failure.input
        }
        let observed = try Owner(
            pid: pid_t(pid), stage: stage, mutating: false, expectedRequestID: requestID)
        guard (request.input["startSeconds"] as? NSNumber)?.uint64Value == observed.seconds,
            (request.input["startMicroseconds"] as? NSNumber)?.uint64Value == observed.microseconds,
            (request.input["launchDate"] as? NSNumber)?.doubleValue == observed.launch,
            let app = NSRunningApplication(processIdentifier: observed.pid)
        else { throw Failure.process }
        guard app.activate(options: []) else { throw Failure.window }
        while try NSWorkspace.shared.frontmostApplication?.processIdentifier != observed.pid
            || !observed.focusedWindowIsOwned()
        {
            try stream.live()
            _ = try observed.validate()
            RunLoop.current.run(until: Date().addingTimeInterval(0.025))
        }
        let ready = try Owner(
            pid: observed.pid, stage: stage, mutating: true, expectedRequestID: requestID)
        guard CFEqual(ready.window, observed.window), ready.seconds == observed.seconds,
            ready.microseconds == observed.microseconds, ready.launch == observed.launch
        else { throw Failure.window }
        return ready
    }

    func base(_ kind: String) -> [String: Any] {
        [
            "schemaVersion": 1, "kind": kind, "sessionID": request.sessionID,
            "runID": runID, "operation": request.operation, "phase": request.phase,
        ]
    }

    func ready(_ owner: Owner) {
        var value = base("ready")
        value.merge([
            "pid": Int(owner.pid), "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds, "launchDate": owner.launch,
            "requestID": request.requestID?.uuidString.lowercased() as Any? ?? NSNull(),
            "clockUnixMilliseconds": MacVerificationTiming.now,
        ]) { _, new in new }
        emit(value)
    }

    func recordIntent(_ owner: Owner) throws {
        try stream.live()
        try requireNoIntent()
        if request.probe { try validateFixture() } else { try validateApproval() }
        _ = try owner.validate()
        var value = base("intent")
        value.removeValue(forKey: "kind")
        value.merge([
            "pid": Int(owner.pid), "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds, "launchDate": owner.launch,
            "requestID": request.requestID?.uuidString.lowercased() as Any? ?? NSNull(),
            "remoteID": remoteID, "helperSHA256": request.helperSHA,
            "protocolSHA256": request.definition.protocolSHA,
        ]) { _, new in new }
        try request.definition.keys(value, frame: "intent")
        try macInputRecord(value, path: intentPath)
        intentRecorded = true
    }

    func clear(_ owner: Owner) throws {
        if owner.stage == "credentials" {
            try owner.set("facet.account.email", value: "", requireLive: stream.live)
            try owner.set(
                "facet.account.password", value: "", secure: true, requireLive: stream.live)
        } else {
            try owner.set(
                owner.stage == "verification"
                    ? "facet.account.code" : "facet.account.vault-password",
                value: "", secure: owner.stage == "vaults", requireLive: stream.live)
        }
        try owner.wait(button(owner), enabled: false)
    }

    func button(_ owner: Owner) -> String {
        if owner.stage != "vaults" { return "facet.account.signin" }
        return lifecycle.map { "facet.account.reconnect." + $0.profileID } ?? "facet.account.vault."
            + remoteID
    }

    func credentials(_ frame: [String: Any], owner: Owner) throws {
        let email = try request.secret(frame, key: "email", maximum: 256)
        let password = try request.secret(frame, key: "password", maximum: 512)
        try owner.set("facet.account.email", value: email, requireLive: stream.live)
        try owner.wait(button(owner), enabled: false)
        try owner.set(
            "facet.account.password", value: password, secure: true, requireLive: stream.live)
        try owner.wait(button(owner), enabled: true)
    }

    func fixtureVerification(_ initial: Owner) throws -> Owner {
        try recordIntent(initial)
        try initial.press(button(initial), emitReceipt: false, requireLive: stream.live)
        var transition = MacFixtureTransition(run: runID, launch: initial.launch)
        while true {
            try stream.live()
            try initial.validateOwnership()
            try validateFixture()
            let status = try json(state + "/control/status.json")
            if let requestID = try transition.admit(status) {
                return try owner(stage: "verification", requestID: requestID)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.025))
        }
    }

    func run() throws {
        let initial = try owner(stage: request.initialStage, requestID: request.requestID)
        try clear(initial)
        try requireNoIntent()
        ready(initial)
        var frame = try stream.next()
        defer { frame.removeAll() }
        try request.action(frame, kind: request.probe ? "probe" : request.operation)
        _ = try initial.validate()
        if request.probe {
            try runProbe(frame, initial: initial)
        } else {
            try runPrivate(frame, initial: initial)
        }
        var result = base("finished")
        result.merge([
            "cleared": request.probe, "secureField": request.phase != "verification",
            "submitActionCount": submitCount,
            "verificationCodeSubmitActionCount": verificationSubmits,
            "intentRecorded": intentRecorded,
        ]) { _, new in new }
        emit(result)
    }
}

extension MacAccountSession {
    func runProbe(_ frame: [String: Any], initial: Owner) throws {
        try validateFixture()
        try credentials(frame, owner: initial)
        if request.operation == "verification-probe" {
            let verification = try fixtureVerification(initial)
            let code = try request.secret(frame, key: "code", maximum: 6)
            guard code.utf8.count == 6, code.utf8.allSatisfy({ (48...57).contains($0) }) else {
                throw Failure.input
            }
            try verification.set("facet.account.code", value: code, requireLive: stream.live)
            try verification.wait(button(verification), enabled: true)
            try clear(verification)
        } else {
            try clear(initial)
        }
    }

    func runPrivate(_ frame: [String: Any], initial: Owner) throws {
        try validateApproval()
        try recordIntent(initial)
        if request.operation == "credentials" {
            try credentials(frame, owner: initial)
        } else if request.operation == "verification" {
            try submitVerification(frame, initial: initial)
        } else {
            let password = try request.secret(frame, key: "vaultPassword", maximum: 512)
            try initial.set(
                "facet.account.vault-password", value: password, secure: true,
                requireLive: stream.live)
            try initial.wait(button(initial), enabled: true)
        }
        if request.operation != "verification" {
            try initial.press(button(initial), emitReceipt: false, requireLive: stream.live)
        }
    }

    func submitVerification(_ frame: [String: Any], initial: Owner) throws {
        let code = try request.secret(frame, key: "code", maximum: 6)
        guard code.utf8.count == 6, code.utf8.allSatisfy({ (48...57).contains($0) }) else {
            throw Failure.input
        }
        let expiry = try macInputInteger(frame["expiresAtUnixMilliseconds"])
        func liveCode() throws {
            try stream.live()
            try request.definition.timing.requireLive(expiry)
        }
        try liveCode()
        try initial.set("facet.account.code", value: code, requireLive: liveCode)
        try initial.press(button(initial), emitReceipt: false, requireLive: liveCode)
        verificationSubmits = 1
    }
}
