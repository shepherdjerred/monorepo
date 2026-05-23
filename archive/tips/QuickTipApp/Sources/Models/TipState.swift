import Foundation

// MARK: - TipStatus

/// The rotation status of a tip.
enum TipStatus: String, Codable {
    /// Tip has never been shown to the user.
    case unseen
    /// User asked to see this tip again later.
    case showAgain
    /// User marked this tip as learned; excluded from rotation.
    case learned
}

// MARK: - TipState

/// Persisted per-tip state for rotation, favorites, and learning.
struct TipState: Codable, Equatable {
    var status: TipStatus = .unseen
    /// Date string (yyyy-MM-dd) when this tip should be shown again. Only set when status == .showAgain.
    var showAgainDate: String?
    /// Number of times the user has asked to see this tip again. Used to grow the cooldown.
    var showAgainCount: Int = 0
    var isFavorite: Bool = false
}

// MARK: - TipStateStore

/// Root container persisted to disk.
struct TipStateStore: Codable {
    var states: [String: TipState]
}
