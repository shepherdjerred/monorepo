import Foundation

/// Manages daily app-of-the-day rotation.
enum RotationScheduler {
    /// Result of a rotation advance check.
    struct RotationResult {
        let index: Int
        let dateString: String
        let didAdvance: Bool
    }

    /// Determine the current app index, advancing if a new day has started.
    ///
    /// - Parameters:
    ///   - lastShownDate: The date string (yyyy-MM-dd) when the rotation last advanced.
    ///   - lastAppIndex: The index of the last shown app.
    ///   - appCount: Total number of apps available.
    ///   - today: The current date (injectable for testing).
    /// - Returns: A `RotationResult` with the new index, date string, and whether advancement occurred.
    static func advance(
        lastShownDate: String,
        lastAppIndex: Int,
        appCount: Int,
        today: Date = .now
    ) -> RotationResult {
        guard appCount > 0 else {
            return RotationResult(index: 0, dateString: self.formatDate(today), didAdvance: false)
        }

        let todayString = self.formatDate(today)

        if lastShownDate == todayString {
            let safeIndex = lastAppIndex % appCount
            return RotationResult(index: safeIndex, dateString: todayString, didAdvance: false)
        }

        let newIndex = (lastAppIndex + 1) % appCount
        return RotationResult(index: newIndex, dateString: todayString, didAdvance: true)
    }

    /// Format a date as yyyy-MM-dd for storage.
    static func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }
}
