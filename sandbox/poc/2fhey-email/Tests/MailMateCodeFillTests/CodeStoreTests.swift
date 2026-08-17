import Darwin
import Foundation
import Dispatch
import Testing
@testable import MailMateCodeFillShared

@Test("stores multiple records atomically and returns newest first")
func storesRecords() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CodeStore(directory: directory)
    let first = makeRecord(code: "111111", messageID: "one", detectedAt: 100)
    let second = makeRecord(code: "222222", messageID: "two", detectedAt: 101)

    try store.append(first, now: Date(timeIntervalSince1970: 101))
    try store.append(second, now: Date(timeIntervalSince1970: 101))

    #expect(try store.read(now: Date(timeIntervalSince1970: 101)) == [second, first])
}

@Test("removes expired records during reads")
func removesExpiredRecords() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CodeStore(directory: directory)
    try store.append(makeRecord(code: "111111", messageID: "expired", detectedAt: 100), now: Date(timeIntervalSince1970: 100))

    #expect(try store.read(now: Date(timeIntervalSince1970: 281)).isEmpty)
}

@Test("consumes only the successful message")
func consumesRecord() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CodeStore(directory: directory)
    try store.append(makeRecord(code: "111111", messageID: "one", detectedAt: 100), now: Date(timeIntervalSince1970: 100))
    try store.append(makeRecord(code: "222222", messageID: "two", detectedAt: 101), now: Date(timeIntervalSince1970: 101))

    try store.consume(messageID: "two", now: Date(timeIntervalSince1970: 101))

    #expect(try store.read(now: Date(timeIntervalSince1970: 101)).map(\.messageID) == ["one"])
}

@Test("serializes concurrent writers without losing records")
func serializesConcurrentWriters() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let failures = FailureBox()

    DispatchQueue.concurrentPerform(iterations: 16) { index in
        do {
            let store = try CodeStore(directory: directory)
            try store.append(
                makeRecord(code: String(format: "%06d", index), messageID: "message-\(index)", detectedAt: TimeInterval(index)),
                now: Date(timeIntervalSince1970: 16)
            )
        } catch {
            failures.record()
        }
    }

    #expect(failures.count == 0)
    let store = try CodeStore(directory: directory)
    do {
        #expect(try store.read(now: Date(timeIntervalSince1970: 16)).count == 16)
    } catch {
        Issue.record("Concurrent store read failed: \(error)")
    }
}

@Test("waits for an outside holder of the lock file before mutating the store")
func waitsForOutsideLockHolder() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CodeStore(directory: directory)
    try store.append(makeRecord(code: "111111", messageID: "one", detectedAt: 100), now: Date(timeIntervalSince1970: 101))

    let descriptor = open(directory.appendingPathComponent(CodeStore.lockFileName).path, O_RDWR)
    #expect(descriptor >= 0)
    #expect(flock(descriptor, LOCK_EX) == 0)

    let failures = FailureBox()
    let finished = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
        do {
            let contender = try CodeStore(directory: directory)
            try contender.append(makeRecord(code: "222222", messageID: "two", detectedAt: 101), now: Date(timeIntervalSince1970: 101))
        } catch {
            failures.record()
        }
        finished.signal()
    }

    #expect(finished.wait(timeout: .now() + 0.5) == .timedOut)
    #expect(flock(descriptor, LOCK_UN) == 0)
    close(descriptor)

    #expect(finished.wait(timeout: .now() + 10) == .success)
    #expect(failures.count == 0)
    #expect(try store.read(now: Date(timeIntervalSince1970: 101)).count == 2)
}

@Test("fails deterministically when the lock stays held past the timeout")
func timesOutWaitingForLock() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try CodeStore(directory: directory, lockTimeout: 0.2)
    try store.append(makeRecord(code: "111111", messageID: "one", detectedAt: 100), now: Date(timeIntervalSince1970: 101))

    let descriptor = open(directory.appendingPathComponent(CodeStore.lockFileName).path, O_RDWR)
    #expect(descriptor >= 0)
    #expect(flock(descriptor, LOCK_EX) == 0)
    defer {
        flock(descriptor, LOCK_UN)
        close(descriptor)
    }

    #expect(throws: CodeStoreError.lockUnavailable(ETIMEDOUT)) {
        try store.append(makeRecord(code: "222222", messageID: "two", detectedAt: 101), now: Date(timeIntervalSince1970: 101))
    }
}

private final class FailureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func record() {
        lock.lock()
        value += 1
        lock.unlock()
    }
}

private func makeRecord(code: String, messageID: String, detectedAt: TimeInterval) -> OTPRecord {
    OTPRecord(
        code: code,
        service: "example.test",
        sender: "Example",
        messageID: messageID,
        detectedAt: Date(timeIntervalSince1970: detectedAt),
        expiresAt: Date(timeIntervalSince1970: detectedAt + 180)
    )
}
