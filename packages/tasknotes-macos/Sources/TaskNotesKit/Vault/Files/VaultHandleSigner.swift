import CryptoKit
import Foundation

/// Snapshot proofs expire with this object; stage proofs use the durable private
/// namespace and Keychain key. Neither proof is interpreted as a filesystem path.
internal final class VaultHandleSigner {
    let engineIdentity: String
    private let namespace: String
    private let epoch = UUID().uuidString.lowercased()
    private var snapshotKey: Data
    private var stageKey: Data

    init(directory: VaultDirectory, secrets: any FacetSecureStore, engineIdentity: String) throws {
        guard Self.isHex(engineIdentity, length: 64) else {
            throw FacetContractError.unsupportedResponse
        }
        self.engineIdentity = engineIdentity
        namespace = try Self.loadNamespace(directory)
        snapshotKey = Self.randomKey()
        let name = "vault-stages." + namespace
        if let existing = try secrets.read(name) {
            guard existing.count == 32 else { throw FacetContractError.unsupportedResponse }
            stageKey = existing
        } else {
            guard try !Self.hasDurableStages(directory) else {
                throw AppleVaultError.missingPermission
            }
            let created = Self.randomKey()
            try secrets.write(name, bytes: created)
            stageKey = created
        }
    }

    deinit {
        retire()
    }

    func retire() {
        snapshotKey.resetBytes(in: 0..<snapshotKey.count)
        stageKey.resetBytes(in: 0..<stageKey.count)
    }

    func snapshot(profileID: String, nonce: String) throws -> String {
        guard UUID(uuidString: nonce)?.uuidString.lowercased() == nonce else {
            throw AppleVaultError.invalidPath
        }
        return try signed(["snapshot1", epoch, Self.digest(profileID), nonce], key: snapshotKey)
    }

    func snapshotNonce(profileID: String, id: String) throws -> String {
        let fields = try verified(id, key: snapshotKey)
        guard fields.count == 4, fields[0] == "snapshot1", fields[1] == epoch,
            fields[2] == Self.digest(profileID),
            UUID(uuidString: fields[3])?.uuidString.lowercased() == fields[3]
        else { throw AppleVaultError.invalidPath }
        return fields[3]
    }

    func stage(profileID: String, operationID: String) throws -> String {
        guard operationID.hasPrefix("facet-write:"), operationID.utf8.count == 76,
            Self.isHex(String(operationID.dropFirst(12)), length: 64)
        else { throw AppleVaultError.invalidPath }
        return try signed(
            ["stage1", namespace, Self.digest(profileID), Self.digest(operationID)], key: stageKey)
    }

    func stageName(profileID: String, id: String) throws -> String {
        let fields = try verified(id, key: stageKey)
        guard fields.count == 4, fields[0] == "stage1", fields[1] == namespace,
            fields[2] == Self.digest(profileID), Self.isHex(fields[3], length: 64)
        else { throw AppleVaultError.invalidPath }
        return fields[3]
    }

    static func digest(_ value: String) -> String {
        hexadecimal(SHA256.hash(data: Data(value.utf8)))
    }

    private func signed(_ fields: [String], key: Data) throws -> String {
        let value = fields.joined(separator: ":")
        let mac = HMAC<SHA256>.authenticationCode(
            for: context(value), using: SymmetricKey(data: key))
        let id = value + ":" + Self.hexadecimal(mac)
        guard id.utf8.count <= 256 else { throw FacetContractError.unsupportedResponse }
        return id
    }

    private func verified(_ id: String, key: Data) throws -> [String] {
        guard !id.isEmpty, id.utf8.count <= 256,
            !id.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw AppleVaultError.invalidPath }
        var fields = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard let mac = fields.popLast(), Self.isHex(mac, length: 64) else {
            throw AppleVaultError.invalidPath
        }
        var code = Data()
        for index in stride(from: 0, to: mac.count, by: 2) {
            let start = mac.index(mac.startIndex, offsetBy: index)
            let end = mac.index(start, offsetBy: 2)
            guard let byte = UInt8(mac[start..<end], radix: 16) else {
                throw AppleVaultError.invalidPath
            }
            code.append(byte)
        }
        guard
            HMAC<SHA256>.isValidAuthenticationCode(
                code, authenticating: context(fields.joined(separator: ":")),
                using: SymmetricKey(data: key))
        else { throw AppleVaultError.invalidPath }
        return fields
    }

    private func context(_ value: String) -> Data { Data((engineIdentity + "\u{0}" + value).utf8) }

    private static func loadNamespace(_ directory: VaultDirectory) throws -> String {
        if let file = try directory.openFile("payload-namespace") { return try namespace(file) }
        let created = UUID().uuidString.lowercased()
        do {
            try directory.writeNewAtomic("payload-namespace", bytes: Data(created.utf8))
        } catch let error as POSIXError where error.code == .EEXIST {
            guard let file = try directory.openFile("payload-namespace") else { throw error }
            return try namespace(file)
        }
        return created
    }

    private static func namespace(_ file: VaultFile) throws -> String {
        guard try file.size() == 36 else { throw FacetContractError.unsupportedResponse }
        let bytes = try file.read(offset: 0, length: 36)
        guard let value = String(data: bytes, encoding: .utf8),
            UUID(uuidString: value)?.uuidString.lowercased() == value
        else { throw FacetContractError.unsupportedResponse }
        return value
    }

    private static func hasDurableStages(_ directory: VaultDirectory) throws -> Bool {
        for name in try directory.entries() where isHex(name, length: 64) {
            if try !directory.directory(name).entries().isEmpty { return true }
        }
        return false
    }

    private static func isHex(_ value: String, length: Int) -> Bool {
        value.utf8.count == length
            && value.utf8.allSatisfy {
                (48...57).contains($0) || (97...102).contains($0)
            }
    }

    private static func randomKey() -> Data {
        var generator = SystemRandomNumberGenerator()
        return Data((0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) })
    }

    private static func hexadecimal(_ value: some Sequence<UInt8>) -> String {
        value.map {
            let digits = String($0, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }.joined()
    }
}
