import AppKit
import ApplicationServices
import Darwin
import Foundation

// Runtime binding is supplied only over stdin by the schema-validating driver.
var runID = ""
var remoteID = ""
var directory = ""
var executable = ""
var container = ""
var state = ""
var lifecycle: LifecycleFence?
var guestConfigSHA256: String?
var bindingKeys: Set<String> = [
    "runID", "remoteID", "runDirectory", "executable", "container", "stateDirectory", "lifecycle",
]
func bind(_ input: [String: Any]) throws {
    guard let run = input["runID"] as? String,
        UUID(uuidString: run)?.uuidString.lowercased() == run,
        let remote = input["remoteID"] as? String, !remote.isEmpty, remote.utf8.count <= 256,
        !remote.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
        let root = input["runDirectory"] as? String, root.hasPrefix("/"),
        root.hasSuffix("/packages/tasks-for-obsidian/.build/live-sync/" + run),
        URL(fileURLWithPath: root).resolvingSymlinksInPath().path == root,
        let program = input["executable"] as? String,
        program == root
            + "/macos/Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
        URL(fileURLWithPath: program).resolvingSymlinksInPath().path == program
    else { throw Failure.input }
    let ownedContainer =
        FileManager.default.homeDirectoryForCurrentUser.path
        + "/Library/Containers/red.sjer.tasknotes.mac.acceptance/Data"
    let ownedState = ownedContainer + "/Library/Application Support/FacetAcceptance/" + run
    guard input["container"] as? String == ownedContainer,
        input["stateDirectory"] as? String == ownedState
    else { throw Failure.run }
    runID = run
    remoteID = remote
    directory = root
    executable = program
    container = ownedContainer
    state = ownedState
    if let configHash = input["guestConfigSHA256"] as? String {
        guard LifecycleFence.isHash(configHash) else { throw Failure.input }
        var virtualized: Int32 = 0
        var length = MemoryLayout<Int32>.size
        guard sysctlbyname("kern.hv_vmm_present", &virtualized, &length, nil, 0) == 0,
            virtualized == 1
        else { throw Failure.run }
        guestConfigSHA256 = configHash
        bindingKeys.insert("guestConfigSHA256")
    }
    if let fence = input["lifecycle"] as? [String: Any] {
        lifecycle = try LifecycleFence(fence)
    } else {
        guard input["lifecycle"] is NSNull else { throw Failure.input }
        lifecycle = nil
    }
}
enum Failure: Error { case input, process, run, window, field, setter, action, session }
var phase = "input"
var submitCount = 0
func emit(_ object: [String: Any]) {
    let data: Data
    do {
        data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    } catch {
        FileHandle.standardOutput.write(Data("{\"blocked\":\"internal\"}\n".utf8))
        exit(5)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}
func same(_ value: CFTypeRef?, _ target: AXUIElement) -> Bool {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return false }
    return CFEqual(value, target)
}
func json(_ path: String) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    let metadata = try FileManager.default.attributesOfItem(atPath: path)
    guard url.resolvingSymlinksInPath().path == path,
        metadata[.type] as? FileAttributeType == .typeRegular,
        let size = metadata[.size] as? NSNumber, size.intValue <= 65536
    else { throw Failure.run }
    let bytes = try Data(contentsOf: url)
    guard bytes.count <= 65536,
        let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    else { throw Failure.run }
    return object
}
func matches(_ window: AXUIElement, identifier: String) throws -> [AXUIElement] {
    var queue = [window]
    var index = 0
    var result: [AXUIElement] = []
    while index < queue.count {
        guard index < 2000 else { throw Failure.window }
        let element = queue[index]
        index += 1
        if attr(element, "AXIdentifier") as? String == identifier { result.append(element) }
        queue += attr(element, "AXChildren") as? [AXUIElement] ?? []
        queue += attr(element, "AXSheets") as? [AXUIElement] ?? []
    }
    return result.reduce(into: []) { accumulated, element in
        if !accumulated.contains(where: { CFEqual($0, element) }) { accumulated.append(element) }
    }
}
func requireUnlockedSession() throws {
    phase = "session"
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
        session["kCGSSessionOnConsoleKey"] as? Bool == true,
        session["CGSSessionScreenIsLocked"] as? Bool != true
    else { throw Failure.session }
}
func validateManifest() throws {
    phase = "run"
    let descriptor = try json(state + "/acceptance.json")
    if let guestConfigSHA256 {
        try validateGuestCheckpoint(descriptor, configHash: guestConfigSHA256)
        return
    }
    let manifest = try json(directory + "/manifest.json")
    let clients = manifest["clients"] as? [String: [String: String]]
    guard manifest["schemaVersion"] as? Int == 2, manifest["scope"] as? String == "macos",
        manifest["simulator"] is NSNull, manifest["runID"] as? String == runID,
        (manifest["failures"] as? [Any])?.isEmpty == true,
        clients.map({ Set($0.keys) == ["macos"] }) == true,
        clients?["macos"]?["container"] == container,
        clients?["macos"]?["stateDirectory"] == state,
        clients?["macos"]?["descriptor"] == state + "/acceptance.json",
        Set(descriptor.keys) == [
            "schemaVersion", "runID", "stateDirectory", "allowedRemoteVaultID",
        ],
        descriptor["schemaVersion"] as? Int == 1, descriptor["runID"] as? String == runID,
        descriptor["stateDirectory"] as? String == state,
        manifest["stage"] as? String == (lifecycle == nil ? "bound" : "initial-verified"),
        (manifest["cases"] as? [String: String])?["official-reference"] == "pass",
        manifest["allowedRemoteVaultID"] as? String == remoteID,
        descriptor["allowedRemoteVaultID"] as? String == remoteID
    else { throw Failure.run }
    if let lifecycle {
        guard manifest["round"] as? Int == lifecycle.round,
            (manifest["cases"] as? [String: String])?["initial-download"] == "pass",
            (manifest["operations"] as? [String: String])?["lifecycle-begin:macos"] == "pass",
            (manifest["operations"] as? [String: String])?["lifecycle-finish:macos"] == nil
        else { throw Failure.run }
    }
}

private func validateGuestCheckpoint(_ descriptor: [String: Any], configHash: String) throws {
    let stored = try json(directory + "/account-checkpoint.json")
    guard Set(stored.keys) == [
        "schemaVersion", "kind", "binding", "checkpoint", "guestConfigSHA256",
    ], stored["schemaVersion"] as? Int == 1,
        stored["kind"] as? String == "tart-guest-account-checkpoint",
        stored["guestConfigSHA256"] as? String == configHash,
        let binding = stored["binding"] as? [String: Any],
        Set(binding.keys) == ["runID", "allowedRemoteVaultID", "round"],
        binding["runID"] as? String == runID,
        binding["allowedRemoteVaultID"] as? String == remoteID,
        let selectedRound = binding["round"] as? Int, (1...3).contains(selectedRound),
        let checkpoint = stored["checkpoint"] as? [String: Any],
        Set(checkpoint.keys) == [
            "stage", "scope", "officialReferencePassed", "initialDownloadPassed",
            "lifecycleBeginPassed", "lifecycleFinishPresent", "failuresCount", "completedRounds",
        ], ["macos", "apple"].contains(checkpoint["scope"] as? String ?? ""),
        checkpoint["failuresCount"] as? Int == 0,
        checkpoint["officialReferencePassed"] as? Bool == true,
        checkpoint["stage"] as? String == (lifecycle == nil ? "bound" : "initial-verified"),
        Set(descriptor.keys) == ["schemaVersion", "runID", "stateDirectory", "allowedRemoteVaultID"],
        descriptor["schemaVersion"] as? Int == 1, descriptor["runID"] as? String == runID,
        descriptor["stateDirectory"] as? String == state,
        descriptor["allowedRemoteVaultID"] as? String == remoteID
    else { throw Failure.run }
    if let lifecycle {
        guard selectedRound == lifecycle.round,
            checkpoint["initialDownloadPassed"] as? Bool == true,
            checkpoint["lifecycleBeginPassed"] as? Bool == true,
            checkpoint["lifecycleFinishPresent"] as? Bool == false
        else { throw Failure.run }
    }
}
func validateStatus(stage: String, launch: Double, expectedRequestID: UUID?) throws -> [String: Any]
{
    let status = try json(state + "/control/status.json")
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard
        Set(status.keys) == [
            "schemaVersion", "runID", "capturedAt", "profiles", "accountStage", "accountBusy",
            "accountExchange",
        ],
        status["schemaVersion"] as? Int == 1,
        (status["runID"] as? String).flatMap(UUID.init(uuidString:)) == UUID(uuidString: runID),
        let captured = (status["capturedAt"] as? String).flatMap(formatter.date(from:)),
        captured.timeIntervalSince1970 >= launch,
        (-1...5).contains(Date().timeIntervalSince(captured)),
        status["accountStage"] as? String == stage, status["accountBusy"] as? Bool == false
    else { throw Failure.run }
    if let lifecycle {
        try lifecycle.validate(status)
    } else {
        guard (status["profiles"] as? [Any])?.isEmpty == true else { throw Failure.run }
    }
    try validateExchange(
        status, stage: stage, launch: launch, captured: captured,
        expectedRequestID: expectedRequestID)
    return status
}
func validateExchange(
    _ status: [String: Any], stage: String, launch: Double, captured: Date,
    expectedRequestID: UUID?
) throws {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if stage == "credentials" {
        guard status["accountExchange"] is NSNull else { throw Failure.run }
    } else {
        guard let exchange = status["accountExchange"] as? [String: Any],
            Set(exchange.keys) == [
                "requestKind", "stage", "statusCode", "failureClassification", "boundaryCode",
                "requestID", "capturedAt",
            ],
            let exchangeCaptured = (exchange["capturedAt"] as? String).flatMap(
                formatter.date(from:)),
            exchangeCaptured.timeIntervalSince1970 >= launch,
            exchangeCaptured <= captured,
            let request = (exchange["requestID"] as? String).flatMap(UUID.init(uuidString:)),
            exchange["requestKind"] as? String
                == (stage == "verification" ? "sign_in" : "list_vaults"),
            exchange["stage"] as? String == "post", exchange["statusCode"] as? Int == 200,
            exchange["failureClassification"] is NSNull, exchange["boundaryCode"] is NSNull,
            expectedRequestID == nil || request == expectedRequestID
        else { throw Failure.run }
    }
}
