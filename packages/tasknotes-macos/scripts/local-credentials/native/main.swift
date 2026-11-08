import Darwin
import Foundation
import Security

private func installedExecutable() throws -> String {
    guard getuid() > 0, getuid() == geteuid(), let user = getpwuid(getuid()),
        let rawHome = user.pointee.pw_dir,
        let program = Bundle.main.executableURL?.path
    else { throw LocalCredentialFailure.boundary }
    let home = String(cString: rawHome)
    let directory = home + "/Library/Application Support/FacetAcceptanceCredentials"
    let expected = directory + "/bin/facet-credentials"
    guard program == expected,
        URL(fileURLWithPath: expected).resolvingSymlinksInPath().path == expected
    else { throw LocalCredentialFailure.boundary }
    for (path, type) in [
        (directory, FileAttributeType.typeDirectory),
        (directory + "/bin", FileAttributeType.typeDirectory),
        (expected, FileAttributeType.typeRegular),
    ] {
        let metadata = try FileManager.default.attributesOfItem(atPath: path)
        guard metadata[.type] as? FileAttributeType == type,
            (metadata[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
            (metadata[.posixPermissions] as? NSNumber)?.uint16Value == 0o700
        else { throw LocalCredentialFailure.boundary }
    }
    return program
}

private func privatePipe(_ descriptor: Int32) throws {
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
        metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFIFO)
            || metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK)
    else { throw LocalCredentialFailure.boundary }
}

private func boundedPayload() throws -> Data {
    try privatePipe(STDIN_FILENO)
    var payload = Data()
    while let block = try FileHandle.standardInput.read(
        upToCount: min(4096, LocalCredentialStore.maximumBytes + 1 - payload.count)),
        !block.isEmpty
    {
        payload.append(block)
        guard payload.count <= LocalCredentialStore.maximumBytes else {
            throw LocalCredentialFailure.boundary
        }
    }
    guard !payload.isEmpty else { throw LocalCredentialFailure.boundary }
    return payload
}

private func localDefaultKeychain() throws -> SecKeychain {
    try LocalCredentialFailure.check(SecKeychainSetUserInteractionAllowed(false))
    var keychain: SecKeychain?
    try LocalCredentialFailure.check(SecKeychainCopyDefault(&keychain))
    guard let keychain else { throw LocalCredentialFailure.keychain }
    return keychain
}

do {
    let arguments = CommandLine.arguments
    guard arguments.count == 3, ["read", "enroll"].contains(arguments[1]) else {
        throw LocalCredentialFailure.boundary
    }
    try LocalCredentialStore.validateRecord(arguments[2])
    let executable = try installedExecutable()
    try privatePipe(STDOUT_FILENO)
    let payload = arguments[1] == "enroll" ? try boundedPayload() : nil
    let store = LocalCredentialStore(
        keychain: try localDefaultKeychain(), trustedExecutable: executable)
    if let payload {
        try store.enroll(arguments[2], payload: payload)
        try FileHandle.standardOutput.write(contentsOf: Data("enrolled\n".utf8))
    } else {
        try FileHandle.standardOutput.write(contentsOf: store.read(arguments[2]))
    }
} catch let failure as LocalCredentialFailure {
    fputs(failure.classification + "\n", stderr)
    exit(failure.rawValue)
} catch {
    fputs(LocalCredentialFailure.keychain.classification + "\n", stderr)
    exit(LocalCredentialFailure.keychain.rawValue)
}
