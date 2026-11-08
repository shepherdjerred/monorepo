import CoreFoundation
import CryptoKit
import Darwin
import Foundation

enum MacInputFailure: String, Error {
    case input, deadline, proof, intent
}

func macInputInteger(_ value: Any?) throws -> Int64 {
    guard let number = value as? NSNumber,
        CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite,
        number.doubleValue.rounded(.towardZero) == number.doubleValue,
        number.doubleValue >= 0, number.doubleValue < Double(Int64.max)
    else { throw MacInputFailure.input }
    return number.int64Value
}

func macInputBoolean(_ value: Any?) throws -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
        throw MacInputFailure.input
    }
    return number.boolValue
}

func macInputSHA(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func macInputBytes(_ path: String, maximum: Int = 262_144) throws -> Data {
    let url = URL(fileURLWithPath: path)
    let metadata = try FileManager.default.attributesOfItem(atPath: path)
    guard url.resolvingSymlinksInPath().path == path,
        metadata[.type] as? FileAttributeType == .typeRegular,
        (metadata[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
        let permissions = metadata[.posixPermissions] as? NSNumber,
        permissions.intValue & 0o077 == 0,
        let size = metadata[.size] as? NSNumber, size.intValue <= maximum
    else { throw MacInputFailure.proof }
    let bytes = try Data(contentsOf: url)
    guard bytes.count == size.intValue else { throw MacInputFailure.proof }
    return bytes
}

func macInputDirectory(_ path: String, create: Bool = false) throws {
    if create {
        let outcome = mkdir(path, 0o700)
        guard outcome == 0 || errno == EEXIST else { throw MacInputFailure.intent }
    }
    let metadata = try FileManager.default.attributesOfItem(atPath: path)
    guard URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path,
        metadata[.type] as? FileAttributeType == .typeDirectory,
        (metadata[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid(),
        (metadata[.posixPermissions] as? NSNumber)?.intValue == 0o700
    else { throw MacInputFailure.proof }
}

func macInputRecord(_ value: [String: Any], path: String) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard bytes.count <= 8192 else { throw MacInputFailure.input }
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw MacInputFailure.intent }
    defer { close(descriptor) }
    guard fchmod(descriptor, 0o600) == 0 else { throw MacInputFailure.intent }
    try FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).write(contentsOf: bytes)
    guard fsync(descriptor) == 0 else { throw MacInputFailure.intent }
    let parent = open(
        URL(fileURLWithPath: path).deletingLastPathComponent().path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard parent >= 0 else { throw MacInputFailure.intent }
    defer { close(parent) }
    guard fsync(parent) == 0 else { throw MacInputFailure.intent }
}

struct MacVerificationTiming {
    let minimum: Int64
    let skew: Int64
    let maximum: Int64
    static var now: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    init(_ data: Data) throws {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let definitions = root["$defs"] as? [String: Any],
            let definition = definitions["verification-timing"] as? [String: Any],
            let value = definition["const"] as? [String: NSNumber],
            Set(value.keys) == [
                "minimumValidityMilliseconds", "maximumClockSkewMilliseconds",
                "maximumValidityMilliseconds",
            ],
            let minimumValue = value["minimumValidityMilliseconds"],
            let skewValue = value["maximumClockSkewMilliseconds"],
            let maximumValue = value["maximumValidityMilliseconds"]
        else { throw MacInputFailure.input }
        self.minimum = try macInputInteger(minimumValue)
        self.skew = try macInputInteger(skewValue)
        self.maximum = try macInputInteger(maximumValue)
        guard self.minimum > self.skew, self.skew > 0, self.maximum >= self.minimum,
            self.maximum <= Int64.max - self.skew
        else {
            throw MacInputFailure.input
        }
    }

    func requireLive(_ expiry: Int64, now: Int64 = Self.now) throws {
        let (remaining, overflow) = expiry.subtractingReportingOverflow(now)
        guard !overflow, remaining > 0, remaining <= maximum + skew else {
            throw MacInputFailure.deadline
        }
    }
}

func validateMacInputApproval(
    _ bytes: Data, request: MacInputRequest, runID: String, configSHA: String
) throws {
    guard macInputSHA(bytes) == request.input["approvalSHA256"] as? String,
        let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    else { throw MacInputFailure.proof }
    try request.definition.keys(value, frame: "approval")
    guard try macInputInteger(value["schemaVersion"]) == 1,
        value["kind"] as? String == "mac-private-account-input-approval",
        value["runID"] as? String == runID,
        value["guestConfigSHA256"] as? String == configSHA,
        value["helperSHA256"] as? String == request.helperSHA,
        value["protocolSHA256"] as? String == request.definition.protocolSHA,
        value["timingSHA256"] as? String == request.definition.timingSHA,
        try macInputBoolean(value["credentialsPassed"]),
        try macInputBoolean(value["verificationPassed"])
    else { throw MacInputFailure.proof }
    for key in ["credentialsProofSHA256", "verificationProofSHA256", "measurementSHA256"] {
        guard let digest = value[key] as? String,
            digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
        else { throw MacInputFailure.proof }
    }
}

struct MacInputDefinition {
    let frames: [String: [String]]
    let operations: [String: [String: Any]]
    let timing: MacVerificationTiming
    let protocolSHA: String
    let timingSHA: String

    init(directory: String, input: [String: Any]) throws {
        let bytes = try macInputBytes(directory + "/mac-account.protocol.json")
        protocolSHA = macInputSHA(bytes)
        let timingBytes = try macInputBytes(directory + "/account-input.schema.json")
        timingSHA = macInputSHA(timingBytes)
        guard protocolSHA == input["protocolSHA256"] as? String,
            timingSHA == input["timingSHA256"] as? String,
            let root = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            root["schemaVersion"] as? Int == 1,
            root["kind"] as? String == "mac-private-account-input",
            let limits = root["limits"] as? [String: Int], limits["sessionMilliseconds"] == 120_000,
            limits["frameBytes"] == 8192,
            let selectedFrames = root["frames"] as? [String: [String]],
            let selectedOperations = root["operations"] as? [String: [String: Any]]
        else { throw MacInputFailure.proof }
        self.frames = selectedFrames
        self.operations = selectedOperations
        self.timing = try MacVerificationTiming(timingBytes)
    }

    func keys(_ value: [String: Any], frame: String) throws {
        guard let expected = frames[frame], Set(value.keys) == Set(expected) else {
            throw MacInputFailure.input
        }
    }
}

struct MacInputRequest {
    let input: [String: Any]
    let definition: MacInputDefinition
    let operation: String
    let phase: String
    let initialStage: String
    let probe: Bool
    let sessionID: String
    let requestID: UUID?
    let helperSHA: String

    init(_ input: [String: Any], helperDirectory: String) throws {
        let selectedDefinition = try MacInputDefinition(directory: helperDirectory, input: input)
        try selectedDefinition.keys(input, frame: "init")
        guard try macInputInteger(input["schemaVersion"]) == 1,
            input["kind"] as? String == "mac-private-account-input",
            input["mode"] as? String == "private_session",
            let selectedOperation = input["operation"] as? String,
            let selected = selectedDefinition.operations[selectedOperation],
            let selectedPhase = selected["phase"] as? String,
            let initial = selected["initialStage"] as? String,
            let isProbe = selected["probe"] as? Bool,
            let session = input["sessionID"] as? String,
            UUID(uuidString: session)?.uuidString.lowercased() == session,
            let helperDigest = input["helperSHA256"] as? String,
            helperDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
        else { throw MacInputFailure.input }
        let selectedRequest: UUID?
        if input["requestID"] is NSNull {
            selectedRequest = nil
        } else {
            guard let raw = input["requestID"] as? String, let value = UUID(uuidString: raw),
                value.uuidString.lowercased() == raw
            else {
                throw MacInputFailure.input
            }
            selectedRequest = value
        }
        guard (initial == "credentials") == (selectedRequest == nil) else {
            throw MacInputFailure.input
        }
        if isProbe {
            guard input["approvalSHA256"] is NSNull else { throw MacInputFailure.input }
        } else {
            guard let approval = input["approvalSHA256"] as? String,
                approval.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            else {
                throw MacInputFailure.proof
            }
        }
        self.input = input
        self.definition = selectedDefinition
        self.operation = selectedOperation
        self.phase = selectedPhase
        self.initialStage = initial
        self.probe = isProbe
        sessionID = session
        self.requestID = selectedRequest
        self.helperSHA = helperDigest
    }

    func action(_ frame: [String: Any], kind: String) throws {
        try definition.keys(frame, frame: kind)
        guard frame["kind"] as? String == kind, frame["sessionID"] as? String == sessionID else {
            throw MacInputFailure.input
        }
    }

    func secret(_ frame: [String: Any], key: String, maximum: Int) throws -> String {
        guard let value = frame[key] as? String, !value.isEmpty, value.utf8.count <= maximum,
            !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw MacInputFailure.input }
        return value
    }
}

/// Only the synthetic sign-in's monotonic public diagnostics precede the real code form.
struct MacFixtureTransition {
    let run: String
    let launch: Double
    private(set) var requestID: UUID?
    private var progress = -1
    private var enteredVerification = false

    init(run: String, launch: Double) {
        self.run = run
        self.launch = launch
    }

    mutating func admit(_ status: [String: Any], now: Date = Date()) throws -> UUID? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard
            Set(status.keys) == [
                "schemaVersion", "runID", "capturedAt", "profiles", "accountStage",
                "accountBusy", "accountExchange",
            ],
            try macInputInteger(status["schemaVersion"]) == 1,
            let expectedRun = UUID(uuidString: run),
            let observedRun = (status["runID"] as? String).flatMap(UUID.init(uuidString:)),
            observedRun == expectedRun,
            let profiles = status["profiles"] as? [Any], profiles.isEmpty,
            let captured = (status["capturedAt"] as? String).flatMap(formatter.date(from:)),
            captured.timeIntervalSince1970 >= launch,
            (-1...5).contains(now.timeIntervalSince(captured)),
            let stage = status["accountStage"] as? String,
            ["credentials", "verification"].contains(stage)
        else { throw MacInputFailure.proof }
        let busy = try macInputBoolean(status["accountBusy"])
        guard !enteredVerification || stage == "verification" else { throw MacInputFailure.proof }
        if status["accountExchange"] is NSNull {
            guard stage == "credentials", requestID == nil, progress == -1 else {
                throw MacInputFailure.proof
            }
            return nil
        }
        guard let exchange = status["accountExchange"] as? [String: Any],
            Set(exchange.keys) == [
                "requestKind", "stage", "statusCode", "failureClassification",
                "boundaryCode", "requestID", "capturedAt",
            ],
            exchange["requestKind"] as? String == "sign_in",
            exchange["failureClassification"] is NSNull, exchange["boundaryCode"] is NSNull,
            let rawID = exchange["requestID"] as? String, let observed = UUID(uuidString: rawID),
            requestID == nil || requestID == observed,
            let exchangeTime = (exchange["capturedAt"] as? String).flatMap(formatter.date(from:)),
            exchangeTime.timeIntervalSince1970 >= launch,
            (-1...5).contains(now.timeIntervalSince(exchangeTime)),
            let step = exchange["stage"] as? String, ["preflight", "post"].contains(step)
        else { throw MacInputFailure.proof }
        let rank = try diagnosticRank(exchange, step: step)
        guard rank >= progress, stage != "verification" || rank == 3 else {
            throw MacInputFailure.proof
        }
        requestID = observed
        progress = rank
        if stage == "verification" { enteredVerification = true }
        return stage == "verification" && !busy ? observed : nil
    }

    private func diagnosticRank(_ exchange: [String: Any], step: String) throws -> Int {
        let completed = !(exchange["statusCode"] is NSNull)
        if completed {
            guard try macInputInteger(exchange["statusCode"]) == 200 else {
                throw MacInputFailure.proof
            }
        }
        return (step == "preflight" ? 0 : 2) + (completed ? 1 : 0)
    }
}
