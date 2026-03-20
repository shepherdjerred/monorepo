import Foundation
import Testing
@testable import QuickTipApp

// MARK: - AppStateTests

@MainActor
struct AppStateTests {
    // MARK: Internal

    // MARK: - loadTips

    @Test
    func `loadTips populates apps and allTips from valid markdown files`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        try Self.writeTipFile(
            in: dir,
            filename: "tip1.md",
            app: "Finder",
            category: "Navigation",
            tipText: "`⌘N` — New Finder window"
        )
        try Self.writeTipFile(
            in: dir,
            filename: "tip2.md",
            app: "Finder",
            category: "Navigation",
            tipText: "`⌘T` — New tab"
        )
        try Self.writeTipFile(
            in: dir,
            filename: "tip3.md",
            app: "Safari",
            category: "Browsing",
            tipText: "`⌘L` — Focus address bar"
        )

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)

        #expect(state.apps.count == 2)
        #expect(state.allTips.count == 3)
        #expect(state.apps.map(\.name).contains("Finder"))
        #expect(state.apps.map(\.name).contains("Safari"))
    }

    @Test
    func `loadTips skips malformed files and still loads valid ones`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        try Self.writeTipFile(
            in: dir,
            filename: "good.md",
            app: "Terminal",
            category: "Basics",
            tipText: "`⌘K` — Clear terminal"
        )

        // Malformed file: no frontmatter
        let badContent = "This file has no frontmatter at all."
        try badContent.write(
            to: dir.appendingPathComponent("bad.md"), atomically: true, encoding: .utf8
        )

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)

        #expect(state.apps.count == 1)
        #expect(state.apps.first?.name == "Terminal")
        #expect(state.allTips.count == 1)
    }

    // MARK: - selectDailyTip date gating

    @Test
    func `selectDailyTip is a no-op on the same day`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        for idx in 1 ... 5 {
            try Self.writeTipFile(
                in: dir,
                filename: "tip\(idx).md",
                app: "App\(idx)",
                tipText: "Tip number \(idx)"
            )
        }

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)

        let tipAfterInit = state.currentTip
        #expect(tipAfterInit != nil)

        // Call selectDailyTip again on the same day — should be a no-op
        state.selectDailyTip()

        #expect(state.currentTip?.id == tipAfterInit?.id)
    }

    // MARK: - showNextTip / showPreviousTip

    @Test
    func `showNextTip and showPreviousTip navigate history correctly`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        for idx in 1 ... 10 {
            try Self.writeTipFile(
                in: dir,
                filename: "tip\(idx).md",
                app: "App\(idx)",
                tipText: "Tip number \(idx)"
            )
        }

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)

        let firstTip = try #require(state.currentTip)

        // Navigate forward
        state.showNextTip()
        let secondTip = try #require(state.currentTip)
        #expect(secondTip.id != firstTip.id)

        state.showNextTip()
        let thirdTip = try #require(state.currentTip)
        #expect(thirdTip.id != secondTip.id)

        // Navigate back
        state.showPreviousTip()
        #expect(state.currentTip?.id == secondTip.id)

        state.showPreviousTip()
        #expect(state.currentTip?.id == firstTip.id)

        // Can't go further back
        state.showPreviousTip()
        #expect(state.currentTip?.id == firstTip.id)
    }

    // MARK: - showRandomTip

    @Test
    func `showRandomTip excludes learned tips and current tip`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        // Create a few tips
        for idx in 1 ... 5 {
            try Self.writeTipFile(
                in: dir,
                filename: "tip\(idx).md",
                app: "TestApp",
                category: "Cat\(idx)",
                tipText: "Tip \(idx)"
            )
        }

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)
        let initialTip = try #require(state.currentTip)

        // Mark all tips except 2 as learned
        let otherTips = state.allTips.filter { $0.id != initialTip.id }
        for tip in otherTips.dropLast(1) {
            reviewManager.markLearned(tipId: tip.id)
        }

        // The remaining non-learned, non-current tip
        let expectedCandidate = try #require(otherTips.last)

        state.showRandomTip()
        let randomTip = try #require(state.currentTip)
        #expect(randomTip.id == expectedCandidate.id)
    }

    // MARK: - markCurrentTipLearned

    @Test
    func `markCurrentTipLearned advances to next tip`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        for idx in 1 ... 5 {
            try Self.writeTipFile(
                in: dir,
                filename: "tip\(idx).md",
                app: "TestApp",
                category: "Cat\(idx)",
                tipText: "Tip \(idx)"
            )
        }

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)
        let originalTip = try #require(state.currentTip)

        state.markCurrentTipLearned()

        #expect(state.currentTip?.id != originalTip.id)
        #expect(reviewManager.isLearned(originalTip.id))
        #expect(reviewManager.learnedCount == 1)
    }

    // MARK: - toggleCurrentTipFavorite

    @Test
    func `toggleCurrentTipFavorite toggles through reviewManager`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        try Self.writeTipFile(
            in: dir, filename: "tip1.md", app: "TestApp", tipText: "A tip"
        )

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)
        let tip = try #require(state.currentTip)

        #expect(!reviewManager.isFavorite(tip.id))

        state.toggleCurrentTipFavorite()
        #expect(reviewManager.isFavorite(tip.id))

        state.toggleCurrentTipFavorite()
        #expect(!reviewManager.isFavorite(tip.id))
    }

    // MARK: - History cap

    @Test
    func `history is capped at 20 entries`() throws {
        let dir = try Self.makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        // Create enough tips to exceed the history cap
        for idx in 1 ... 30 {
            try Self.writeTipFile(
                in: dir,
                filename: "tip\(idx).md",
                app: "App\(idx)",
                tipText: "Tip \(idx)"
            )
        }

        let defaults = try Self.makeDefaults()
        let (reviewManager, rmDir) = try Self.makeReviewManager()
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let state = AppState(tipsDirectory: dir, defaults: defaults, reviewManager: reviewManager)

        // Push 25 tips into history (init already pushed 1)
        for _ in 1 ... 24 {
            state.showNextTip()
        }

        // Navigate back as far as possible to measure history size
        var backSteps = 0
        while true {
            let before = state.currentTip?.id
            state.showPreviousTip()
            let after = state.currentTip?.id
            if before == after {
                break
            }
            backSteps += 1
        }

        // History should be capped at 20, so max back steps is 19 (from last to first)
        #expect(backSteps <= 19)
    }

    // MARK: Private

    // MARK: - Helpers

    /// Create a temporary directory that is cleaned up when the test finishes.
    private static func makeTempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AppStateTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Create a valid markdown tip file in the given directory.
    private static func writeTipFile(
        in directory: URL,
        filename: String,
        app: String,
        icon: String = "star",
        color: String = "#FF0000",
        category: String = "General",
        tipText: String
    ) throws {
        let content = """
        ---
        app: \(app)
        icon: \(icon)
        color: "\(color)"
        category: \(category)
        ---

        - \(tipText)
        """
        let fileURL = directory.appendingPathComponent(filename)
        try content.write(to: fileURL, atomically: true, encoding: .utf8)
    }

    /// Create isolated UserDefaults for testing.
    private static func makeDefaults() throws -> UserDefaults {
        let suiteName = "AppStateTests-\(UUID().uuidString)"
        return try #require(UserDefaults(suiteName: suiteName))
    }

    /// Create a ReviewManager backed by a temp directory.
    private static func makeReviewManager() throws -> (ReviewManager, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ReviewManagerTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return (ReviewManager(storageDirectory: dir, enableCloudSync: false), dir)
    }
}

// MARK: - AppStateIntegrationTests

@MainActor
struct AppStateIntegrationTests {
    @Test
    func `full pipeline with real content directory`() throws {
        let contentDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Resources/content", isDirectory: true)

        let defaults = try #require(UserDefaults(suiteName: "AppStateIntegrationTests-\(UUID().uuidString)"))
        let rmDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("AppStateIntegration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: rmDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: rmDir) }

        let reviewManager = ReviewManager(storageDirectory: rmDir, enableCloudSync: false)
        let state = AppState(
            tipsDirectory: contentDirectory, defaults: defaults, reviewManager: reviewManager
        )

        // Should have a large number of tips
        #expect(state.allTips.count > 1500)

        // Should have a current tip after init
        let firstTip = try #require(state.currentTip)

        // showNextTip should change the tip
        state.showNextTip()
        let secondTip = try #require(state.currentTip)
        #expect(secondTip.id != firstTip.id)

        // showPreviousTip should go back
        state.showPreviousTip()
        #expect(state.currentTip?.id == firstTip.id)

        // markCurrentTipLearned should advance and track learned
        state.markCurrentTipLearned()
        #expect(state.currentTip?.id != firstTip.id)
        #expect(reviewManager.learnedCount == 1)
        #expect(reviewManager.isLearned(firstTip.id))
    }
}
