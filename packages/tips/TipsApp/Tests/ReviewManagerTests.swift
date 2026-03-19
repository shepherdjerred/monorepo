import Foundation
import Testing
@testable import TipsApp

@MainActor
struct ReviewManagerTests {
    // MARK: Internal

    @Test
    func `saves and loads state`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)
        manager.toggleFavorite(tipId: "tip-1")

        let manager2 = ReviewManager(storageDirectory: dir)
        #expect(manager2.isFavorite("tip-1"))
    }

    @Test
    func `toggle favorite`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)
        #expect(!manager.isFavorite("tip-1"))

        manager.toggleFavorite(tipId: "tip-1")
        #expect(manager.isFavorite("tip-1"))

        manager.toggleFavorite(tipId: "tip-1")
        #expect(!manager.isFavorite("tip-1"))
    }

    @Test
    func `mark learned`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)
        manager.markLearned(tipId: "tip-1")

        #expect(manager.isLearned("tip-1"))
        #expect(manager.learnedCount == 1)
    }

    @Test
    func `mark show again sets date`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)

        var components = DateComponents()
        components.year = 2025
        components.month = 1
        components.day = 1
        let date = try #require(Calendar.current.date(from: components))

        manager.markShowAgain(tipId: "tip-1", today: date)

        let state = manager.state(for: "tip-1")
        #expect(state.status == .showAgain)
        #expect(state.showAgainDate == "2025-01-04") // +3 days
        #expect(state.showAgainCount == 1)
    }

    @Test
    func `show again count grows cooldown`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)

        var components = DateComponents()
        components.year = 2025
        components.month = 1
        components.day = 1
        let date = try #require(Calendar.current.date(from: components))

        manager.markShowAgain(tipId: "tip-1", today: date)
        #expect(manager.state(for: "tip-1").showAgainDate == "2025-01-04") // +3

        manager.markShowAgain(tipId: "tip-1", today: date)
        #expect(manager.state(for: "tip-1").showAgainDate == "2025-01-07") // +6
    }

    @Test
    func `default state for unknown tip`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)
        let state = manager.state(for: "unknown")

        #expect(state.status == .unseen)
        #expect(!state.isFavorite)
        #expect(state.showAgainDate == nil)
    }

    @Test
    func `handles missing file`() {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        let manager = ReviewManager(storageDirectory: dir)
        #expect(manager.states.isEmpty)

        // Should be able to write
        manager.toggleFavorite(tipId: "tip-1")
        #expect(manager.isFavorite("tip-1"))

        try? FileManager.default.removeItem(at: dir)
    }

    @Test
    func `favorite ids`() throws {
        let dir = try self.makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        let manager = ReviewManager(storageDirectory: dir)
        manager.toggleFavorite(tipId: "tip-1")
        manager.toggleFavorite(tipId: "tip-2")

        #expect(manager.favoriteIds == Set(["tip-1", "tip-2"]))
    }

    // MARK: Private

    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
