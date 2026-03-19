import OSLog

/// Centralized logging for Glance using OSLog subsystem categories.
enum GlanceLogger {
    // MARK: Internal

    /// Logger for polling cycle events.
    static let polling = Logger(subsystem: subsystem, category: "polling")

    /// Logger for network monitoring events.
    static let network = Logger(subsystem: subsystem, category: "network")

    /// Logger for persistence operations.
    static let persistence = Logger(subsystem: subsystem, category: "persistence")

    /// Logger for UI events.
    static let ui = Logger(subsystem: subsystem, category: "ui")

    /// Logger for secret management.
    static let secrets = Logger(subsystem: subsystem, category: "secrets")

    /// Logger for diagnostics.
    static let diagnostics = Logger(subsystem: subsystem, category: "diagnostics")

    /// Logger for notification events.
    static let notifications = Logger(subsystem: subsystem, category: "notifications")

    /// Signposter for performance instrumentation.
    static let signposter = OSSignposter(subsystem: subsystem, category: "performance")

    /// Logger for a specific provider by ID.
    static func provider(_ id: String) -> Logger {
        Logger(subsystem: self.subsystem, category: "provider.\(id)")
    }

    // MARK: Private

    /// Subsystem identifier for all Glance logs.
    private static let subsystem = "com.shepherdjerred.glance"
}
