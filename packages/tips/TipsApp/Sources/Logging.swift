import os

extension Logger {
    private static let subsystem = "com.jerred.TipsApp"

    /// Tip file parsing and content loading.
    static let parsing = Logger(subsystem: subsystem, category: "parsing")

    /// Review state persistence (load/save).
    static let persistence = Logger(subsystem: subsystem, category: "persistence")

    /// Notification scheduling and permissions.
    static let notifications = Logger(subsystem: subsystem, category: "notifications")

    /// App lifecycle, content directory resolution, login items.
    static let lifecycle = Logger(subsystem: subsystem, category: "lifecycle")
}
