import Darwin
import Foundation
import Security

private var currentCase = "fixture-create"

private func require(_ condition: Bool) throws {
    guard condition else { throw LocalCredentialFailure.keychain }
}

private func expectFailure(
    _ expected: LocalCredentialFailure, action: () throws -> Void
) throws {
    do {
        try action()
    } catch let failure as LocalCredentialFailure {
        try require(failure == expected)
        return
    }
    throw LocalCredentialFailure.keychain
}

private func verifyLockedFailure(
    _ fixture: CredentialFixture, store: LocalCredentialStore, record: String, payload: Data
) throws {
    try LocalCredentialFailure.check(SecKeychainLock(fixture.keychain))
    try expectFailure(.interactionRequired) { _ = try store.read(record) }
    try expectFailure(.interactionRequired) { try store.enroll(record, payload: payload) }
    var interactionAllowed: DarwinBoolean = true
    try LocalCredentialFailure.check(SecKeychainGetUserInteractionAllowed(&interactionAllowed))
    try require(!interactionAllowed.boolValue)
}

private func runControls(_ fixture: CredentialFixture) throws -> [String] {
    guard let executable = Bundle.main.executableURL?.path else {
        throw LocalCredentialFailure.boundary
    }
    let store = LocalCredentialStore(keychain: fixture.keychain, trustedExecutable: executable)
    let record =
        String(repeating: "a", count: 26) + ":"
        + String(repeating: "b", count: 26) + ":" + String(repeating: "c", count: 26)
    let missing =
        String(repeating: "d", count: 26) + ":"
        + String(repeating: "e", count: 26) + ":" + String(repeating: "f", count: 26)
    let payload = Data([0, 255, 10, 65, 0, 128])
    var passed: [String] = []

    currentCase = "missing-record"
    try expectFailure(.missing) { _ = try store.read(record) }
    passed.append(currentCase)

    currentCase = "opaque-native-roundtrip"
    try store.enroll(record, payload: payload)
    try require(store.read(record) == payload)
    passed.append(currentCase)

    currentCase = "exact-helper-only-local-acl"
    try fixture.verifyOnlyTrustedReader(record, executable: executable)
    passed.append(currentCase)

    currentCase = "duplicate-enrollment-preserves-bytes"
    try expectFailure(.denied) { try store.enroll(record, payload: Data("replacement".utf8)) }
    try require(store.read(record) == payload)
    try fixture.verifyOnlyTrustedReader(record, executable: executable)
    passed.append(currentCase)

    currentCase = "invalid-boundaries-preserve-record"
    for invalid in ["", record + "\n", "../" + record, "a:b:c"] {
        try expectFailure(.boundary) { _ = try store.read(invalid) }
    }
    for invalid in [Data(), Data(repeating: 65, count: LocalCredentialStore.maximumBytes + 1)] {
        try expectFailure(.boundary) { try store.enroll(missing, payload: invalid) }
    }
    try require(store.read(record) == payload)
    passed.append(currentCase)

    currentCase = "hostile-existing-acl-cannot-receive-new-secret"
    try fixture.addBroadlyTrustedSyntheticItem(missing, payload: payload)
    try expectFailure(.denied) { try store.enroll(missing, payload: Data("replacement".utf8)) }
    try expectFailure(.denied) { _ = try store.read(missing) }
    try require(fixture.rawSyntheticBytes(missing) == payload)
    passed.append(currentCase)

    currentCase = "locked-keychain-fails-without-ui"
    try verifyLockedFailure(fixture, store: store, record: record, payload: payload)
    passed.append(currentCase)
    return passed
}

do {
    let fixture = try CredentialFixture()
    let cases: [String]
    do {
        cases = try runControls(fixture)
    } catch {
        try fixture.cleanup()
        throw error
    }
    currentCase = "owned-fixture-cleanup"
    try fixture.cleanup()
    let receipt: [String: Any] = [
        "passed": true, "cases": cases + [currentCase], "caseCount": cases.count + 1,
        "loginKeychainAccessed": false, "credentialManagersInvoked": false,
        "userInteractionAllowed": false, "fixtureRemoved": true, "searchListPreserved": true,
    ]
    try FileHandle.standardOutput.write(
        contentsOf: JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]))
} catch {
    let classification = (error as? LocalCredentialFailure)?.classification ?? "fixture_failure"
    fputs("{\"failedCase\":\"\(currentCase)\",\"classification\":\"\(classification)\"}\n", stderr)
    exit(1)
}
