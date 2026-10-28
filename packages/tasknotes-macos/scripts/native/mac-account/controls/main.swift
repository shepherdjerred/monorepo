import Darwin
import Foundation

enum ControlFailure: Error { case assertion }

func require(_ condition: Bool) throws {
    guard condition else { throw ControlFailure.assertion }
}

func rejects(_ action: () throws -> Void) throws {
    do { try action() } catch is MacInputFailure { return }
    throw ControlFailure.assertion
}

func bytes(_ value: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
}

func fixtureRequest(_ root: String, operation: String = "credentials-probe") throws -> [String: Any]
{
    let phaseRequest: Any =
        ["verification", "vault"].contains(operation)
        ? UUID().uuidString.lowercased() : NSNull()
    return [
        "schemaVersion": 1, "kind": "mac-private-account-input", "mode": "private_session",
        "operation": operation, "sessionID": UUID().uuidString.lowercased(),
        "runID": UUID().uuidString.lowercased(), "remoteID": "synthetic-remote",
        "runDirectory": root, "executable": root + "/binary", "container": root,
        "stateDirectory": root, "lifecycle": NSNull(),
        "guestConfigSHA256": String(repeating: "a", count: 64),
        "pid": 123, "startSeconds": 12, "startMicroseconds": 34, "launchDate": 12.034,
        "requestID": phaseRequest, "helperSHA256": String(repeating: "b", count: 64),
        "protocolSHA256": macInputSHA(try macInputBytes(root + "/mac-account.protocol.json")),
        "timingSHA256": macInputSHA(try macInputBytes(root + "/account-input.schema.json")),
        "approvalSHA256": operation.hasSuffix("-probe")
            ? NSNull() : String(repeating: "a", count: 64),
    ]
}

func requestControls(_ root: String) throws {
    let input = try fixtureRequest(root)
    let request = try MacInputRequest(input, helperDirectory: root)
    try require(request.probe && request.phase == "credentials" && request.requestID == nil)
    var malformed = input
    malformed["extra"] = true
    try rejects { _ = try MacInputRequest(malformed, helperDirectory: root) }
    malformed = input
    malformed["schemaVersion"] = true
    try rejects { _ = try MacInputRequest(malformed, helperDirectory: root) }
    malformed = input
    malformed["operation"] = "connect-arbitrary"
    try rejects { _ = try MacInputRequest(malformed, helperDirectory: root) }
    malformed = input
    malformed["requestID"] = UUID().uuidString.lowercased()
    try rejects { _ = try MacInputRequest(malformed, helperDirectory: root) }
    malformed = input
    malformed["protocolSHA256"] = String(repeating: "f", count: 64)
    try rejects { _ = try MacInputRequest(malformed, helperDirectory: root) }
    let action: [String: Any] = [
        "kind": "credentials", "sessionID": request.sessionID,
        "email": "synthetic@example.invalid", "password": "synthetic",
    ]
    try request.action(action, kind: "credentials")
    try rejects { try request.action(action, kind: "verification") }
    var extraAction = action
    extraAction["expiresAtUnixMilliseconds"] = 123
    try rejects { try request.action(extraAction, kind: "credentials") }
    var replay = action
    replay["sessionID"] = UUID().uuidString.lowercased()
    try rejects { try request.action(replay, kind: "credentials") }
    try rejects { _ = try request.secret(["code": "123\n"], key: "code", maximum: 6) }
}

func timingControls(_ root: String) throws {
    let timing = try MacVerificationTiming(macInputBytes(root + "/account-input.schema.json"))
    try timing.requireLive(1001, now: 1000)
    try rejects { try timing.requireLive(1000, now: 1000) }
    try rejects { try timing.requireLive(999, now: 1000) }
    try rejects { try timing.requireLive(1000 + timing.maximum + timing.skew + 1, now: 1000) }
    try rejects { try timing.requireLive(Int64.max, now: Int64.min) }
    try rejects { _ = try macInputInteger(true) }
    try rejects { _ = try macInputInteger(1.5) }
    try rejects { _ = try macInputBoolean(1) }
}

func approvalControls(_ root: String) throws {
    var input = try fixtureRequest(root, operation: "verification")
    let request = try MacInputRequest(input, helperDirectory: root)
    guard let run = input["runID"] as? String,
        let config = input["guestConfigSHA256"] as? String
    else { throw ControlFailure.assertion }
    var approval: [String: Any] = [
        "schemaVersion": 1, "kind": "mac-private-account-input-approval", "runID": run,
        "guestConfigSHA256": config, "helperSHA256": request.helperSHA,
        "protocolSHA256": request.definition.protocolSHA,
        "timingSHA256": request.definition.timingSHA,
        "credentialsProofSHA256": String(repeating: "c", count: 64),
        "verificationProofSHA256": String(repeating: "d", count: 64),
        "measurementSHA256": String(repeating: "e", count: 64),
        "credentialsPassed": true, "verificationPassed": true,
    ]
    func validate(_ candidate: [String: Any]) throws {
        let encoded = try bytes(candidate)
        input["approvalSHA256"] = macInputSHA(encoded)
        let correlated = try MacInputRequest(input, helperDirectory: root)
        try validateMacInputApproval(encoded, request: correlated, runID: run, configSHA: config)
    }
    try validate(approval)
    approval["verificationPassed"] = false
    try rejects { try validate(approval) }
    approval["verificationPassed"] = 1
    try rejects { try validate(approval) }
    approval["verificationPassed"] = true
    approval["helperSHA256"] = String(repeating: "f", count: 64)
    try rejects { try validate(approval) }
    approval["helperSHA256"] = request.helperSHA
    approval["verificationProofSHA256"] = ""
    try rejects { try validate(approval) }
}

func streamCase(_ data: Data, expected: Int32) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    process.arguments = ["--stream"]
    let input = Pipe()
    let output = Pipe()
    let errors = Pipe()
    process.standardInput = input
    process.standardOutput = output
    process.standardError = errors
    try process.run()
    try input.fileHandleForWriting.write(contentsOf: data)
    try input.fileHandleForWriting.close()
    let result = try output.fileHandleForReading.readToEnd() ?? Data()
    let diagnostic = try errors.fileHandleForReading.readToEnd() ?? Data()
    process.waitUntilExit()
    try require(process.terminationStatus == expected && diagnostic.isEmpty)
    try require(result == Data((expected == 0 ? "stream-pass\n" : "stream-rejected\n").utf8))
}

func streamControls() throws {
    try streamCase(Data("{\"synthetic\":true}\n".utf8), expected: 0)
    try streamCase(Data("{\"synthetic\":true}".utf8), expected: 1)
    try streamCase(Data("{}\n{}\n".utf8), expected: 1)
    try streamCase(Data(repeating: 65, count: 8194), expected: 1)
}

func transitionStatus() -> [String: Any] {
    [
        "schemaVersion": 1, "runID": "synthetic-run", "capturedAt": "1970-01-01T00:16:40.500Z",
        "profiles": [], "accountStage": "credentials", "accountBusy": true,
        "accountExchange": NSNull(),
    ]
}

func transitionExchange(_ step: String, completed: Bool) -> [String: Any] {
    [
        "requestKind": "sign_in", "stage": step, "statusCode": completed ? 200 : NSNull(),
        "failureClassification": NSNull(), "boundaryCode": NSNull(),
        "requestID": "7c94e51d-5c49-4a3b-ae5e-f94392f8caed",
        "capturedAt": "1970-01-01T00:16:40.600Z",
    ]
}

func transitionControls() throws {
    let now = Date(timeIntervalSince1970: 1001)
    var transition = MacFixtureTransition(run: "synthetic-run", launch: 1000)
    var status = transitionStatus()
    try require(try transition.admit(status, now: now) == nil)
    for step in ["preflight", "post"] {
        for complete in [false, true] {
            status["accountExchange"] = transitionExchange(step, completed: complete)
            try require(try transition.admit(status, now: now) == nil)
        }
    }
    var malformed = status
    malformed["accountExchange"] = transitionExchange("preflight", completed: true)
    try rejects { _ = try transition.admit(malformed, now: now) }
    var changed = transitionExchange("post", completed: true)
    changed["requestID"] = UUID().uuidString.lowercased()
    malformed["accountExchange"] = changed
    try rejects { _ = try transition.admit(malformed, now: now) }
    for changes: [String: Any] in [
        ["statusCode": 403], ["failureClassification": "transport"],
        ["boundaryCode": "unexpected"], ["requestKind": "list_vaults"],
    ] {
        malformed["accountExchange"] = transitionExchange("post", completed: true).merging(changes)
        { _, new in new }
        try rejects { _ = try transition.admit(malformed, now: now) }
    }
    for changes: [String: Any] in [
        ["runID": "different"], ["profiles": [true]],
        ["capturedAt": "1970-01-01T00:16:39.000Z"], ["accountStage": "vaults"],
    ] {
        malformed = status.merging(changes) { _, new in new }
        try rejects { _ = try transition.admit(malformed, now: now) }
    }
    try rejects { _ = try transition.admit(status, now: Date(timeIntervalSince1970: 1010)) }
    status["accountStage"] = "verification"
    try require(try transition.admit(status, now: now) == nil)
    malformed = status
    malformed["accountStage"] = "credentials"
    try rejects { _ = try transition.admit(malformed, now: now) }
    status["accountBusy"] = false
    try require(try transition.admit(status, now: now) == transition.requestID)
}

if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "--stream" {
    do {
        let stream = try MacInputStream()
        let decoded = try stream.next()
        try require(decoded["synthetic"] as? Bool == true)
        FileHandle.standardOutput.write(Data("stream-pass\n".utf8))
        exit(0)
    } catch {
        FileHandle.standardOutput.write(Data("stream-rejected\n".utf8))
        exit(1)
    }
}

func recordControls(_ root: String) throws {
    let file = root + "/intent.json"
    let value: [String: Any] = ["synthetic": true]
    try macInputRecord(value, path: file)
    try require(try macInputBytes(file) == bytes(value))
    try rejects { try macInputRecord(value, path: file) }
    let link = root + "/intent-link.json"
    guard symlink(file, link) == 0 else { throw ControlFailure.assertion }
    try rejects { _ = try macInputBytes(link) }
    try rejects { try macInputRecord(value, path: link) }
    guard chmod(file, 0o644) == 0 else { throw ControlFailure.assertion }
    try rejects { _ = try macInputBytes(file) }
}

do {
    guard CommandLine.arguments.count == 4 else { throw ControlFailure.assertion }
    let root = CommandLine.arguments[3]
    try macInputDirectory(root)
    for entry in [
        ("mac-account.protocol.json", CommandLine.arguments[1]),
        ("account-input.schema.json", CommandLine.arguments[2]),
    ] {
        let data = try Data(contentsOf: URL(fileURLWithPath: entry.1))
        let path = root + "/" + entry.0
        guard
            FileManager.default.createFile(
                atPath: path, contents: data,
                attributes: [.posixPermissions: 0o600])
        else {
            throw ControlFailure.assertion
        }
    }
    try requestControls(root)
    try timingControls(root)
    try approvalControls(root)
    try recordControls(root)
    try streamControls()
    try transitionControls()
    let receipt =
        "PASS original request/action/expiry/approval/durable-record/private-stream controls; "
        + "no UI or credential access\n"
    FileHandle.standardOutput.write(Data(receipt.utf8))
} catch {
    FileHandle.standardOutput.write(Data("FAIL original private-input controls\n".utf8))
    exit(1)
}
