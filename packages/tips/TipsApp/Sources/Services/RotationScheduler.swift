import Foundation

/// Manages daily app-of-the-day rotation.
enum RotationScheduler {
    /// Determine the current app index, advancing if a new day has started.
    ///
    /// - Parameters:
    ///   - lastShownDate: The date string (yyyy-MM-dd) when the rotation last advanced.
    ///   - lastAppIndex: The index of the last shown app.
    ///   - appCount: Total number of apps available.
    ///   - today: The current date (injectable for testing).
    /// - Returns: A tuple of (newIndex, newDateString, didAdvance).
    static func advance(
        lastShownDate: String,
        lastAppIndex: Int,
        appCount: Int,
        today: Date = .now
    ) -> (index: Int, dateString: String, didAdvance: Bool) {
        guard appCount > 0 else {
            return (0, self.formatDate(today), false)
        }

        let todayString = self.formatDate(today)

        if lastShownDate == todayString {
            let safeIndex = lastAppIndex % appCount
            return (safeIndex, todayString, false)
        }

        let newIndex = (lastAppIndex + 1) % appCount
        return (newIndex, todayString, true)
    }

    /// Format a date as yyyy-MM-dd for storage.
    static func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }
}
