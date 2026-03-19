import Foundation

/// File-based cache at ~/Library/Application Support/Glance/.
/// Used for secrets and API responses. Files are created with 0600 permissions.
enum GlanceCache {
    // MARK: Internal

    static func read(key: String) -> String? {
        guard let data = FileManager.default.contents(atPath: self.path(for: key)) else {
            return nil
        }
        return String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func write(key: String, value: String) {
        try? FileManager.default.createDirectory(
            atPath: self.cacheDir,
            withIntermediateDirectories: true,
        )
        // Write with restrictive permissions (owner read/write only)
        FileManager.default.createFile(
            atPath: self.path(for: key),
            contents: value.data(using: .utf8),
            attributes: [.posixPermissions: 0o600],
        )
    }

    // MARK: Private

    private static let cacheDir: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Application Support/Glance"
    }()

    private static func path(for key: String) -> String {
        "\(self.cacheDir)/\(key)"
    }
}
