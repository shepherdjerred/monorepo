import Foundation

// MARK: - ClaudeCodeUsage

struct ClaudeCodeUsage {
    let fiveHour: UsageWindow?
    let sevenDay: UsageWindow?
}

// MARK: - CodexUsage

struct CodexUsage {
    let fiveHour: UsageWindow?
    let sevenDay: UsageWindow?
}

// MARK: - UsageWindow

struct UsageWindow {
    let utilization: Double
    let resetsAt: Date?
}
