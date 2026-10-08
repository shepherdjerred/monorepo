import Foundation

internal enum VaultRelativePath {
    static func validate(_ path: String) throws {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
            parts.first?.lowercased() != ".facet-recovery", !path.contains("\\"),
            !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw AppleVaultError.invalidPath }
    }

    static func isRevision(_ value: String) -> Bool {
        value.utf8.count == 64
            && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
