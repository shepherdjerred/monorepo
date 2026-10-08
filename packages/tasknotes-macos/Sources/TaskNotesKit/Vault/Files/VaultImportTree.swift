import Foundation

extension VaultDirectory {
    /// Preserve empty folders and reject unsupported source entries explicitly.
    func importTree(prefix: String = "") throws -> [VaultImportEntry] {
        var result: [VaultImportEntry] = []
        for name in try entries() {
            let path = prefix.isEmpty ? name : prefix + "/" + name
            do {
                let nested = try directory(name)
                result.append(VaultImportEntry(path: path, directory: true))
                result.append(contentsOf: try nested.importTree(prefix: path))
            } catch let failure as POSIXError where failure.code == .ENOTDIR {
                guard try openFile(name) != nil else { throw AppleVaultError.coordinationFailed }
                result.append(VaultImportEntry(path: path, directory: false))
            }
        }
        return result.sorted { $0.path < $1.path }
    }
}
