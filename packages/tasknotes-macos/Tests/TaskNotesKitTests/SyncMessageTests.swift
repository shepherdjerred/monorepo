import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The connection banner's copy, which is the only place a sync failure is ever
/// stated.
@Suite("Sync messages")
struct SyncMessageTests {
    private func status(_ state: SyncState, error: CoreError? = nil) -> SyncStatus {
        SyncStatus(state: state, lastError: error, nextRetryAt: nil)
    }

    /// ⚠️ **The engine is `.idle` here, which is exactly why this case exists.**
    /// Parking a command is what lets the drain carry on, so the engine reports
    /// success while the user's edit has been rolled back off the screen. The
    /// banner is the only thing left that knows the work still exists.
    @Test("parked work is stated even though nothing is wrong with the engine")
    func parkedWorkOutranksAnIdleEngine() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.idle),
                pendingCount: 0,
                storeError: nil,
                parkedCount: 2))
        #expect(message.tone == .attention)
        #expect(message.title == "2 changes could not be saved")
        #expect(message.remedy == .openSettings)

        let one = try #require(
            SyncMessage.of(
                status: status(.idle), pendingCount: 0, storeError: nil, parkedCount: 1))
        #expect(one.title == "1 change could not be saved")
    }

    /// A Keychain that will not release the credential explains every
    /// authentication failure underneath it, so it is stated instead of them —
    /// and unlike the store error it names somewhere to go.
    @Test("an unreadable credential outranks every other channel")
    func theCredentialFailureIsStatedFirst() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.authError, error: .Api(message: "Unauthorized", status: 401)),
                pendingCount: 1,
                storeError: .Validation(message: "that is not a date"),
                credentialError: .Invariant(message: "the login Keychain is locked"),
                parkedCount: 3))
        #expect(message.tone == .attention)
        #expect(message.title == "This Mac would not release the server credential")
        #expect(message.detail == "the login Keychain is locked")
        #expect(message.remedy == .openSettings)
    }

    @Test("a settled, empty queue says nothing at all")
    func silenceIsTheCommonCase() {
        #expect(
            SyncMessage.of(status: status(.idle), pendingCount: 0, storeError: nil) == nil)
        // Silent while a pass runs: the toolbar control already shows it, and
        // two indicators for one fact is noise.
        #expect(
            SyncMessage.of(status: status(.syncing), pendingCount: 3, storeError: nil) == nil)
    }

    @Test("a failed pass is a banner carrying the engine's own message")
    func aFailureBecomesABanner() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.backoff, error: .Connection(message: "connection refused")),
                pendingCount: 2,
                storeError: nil))
        #expect(message.tone == .degraded)
        #expect(message.title == "2 changes waiting to sync")
        #expect(message.detail == "connection refused")
        #expect(message.remedy == .retry)
    }

    @Test("a queue the engine is already draining offers nothing and alarms nobody")
    func aDrainingQueueIsInformationOnly() throws {
        // The defect this pins: an idle engine with queued work will drain that
        // work on its own, so a **Try Again** button here teaches that manual
        // retry is part of the normal loop. It is not, and the lesson would be
        // copied onto every remaining screen.
        let message = try #require(
            SyncMessage.of(status: status(.idle), pendingCount: 3, storeError: nil))
        #expect(message.tone == .informational)
        #expect(message.remedy == .none)
        #expect(message.detail == nil)
    }

    @Test("severity separates what the user must fix from what fixes itself")
    func toneTracksWhoHasToAct() throws {
        func tone(_ message: SyncMessage?) throws -> SyncMessage.Tone {
            try #require(message).tone
        }

        // Offline is transient and already being retried; an unconfigured
        // server is not going to configure itself. Drawing them identically —
        // which one shared `.failure` tone did — told the reader nothing about
        // which of the two was theirs to deal with.
        #expect(
            try tone(
                SyncMessage.of(
                    status: status(.backoff, error: .Connection(message: "refused")),
                    pendingCount: 1,
                    storeError: nil)) == .degraded)
        #expect(
            try tone(
                SyncMessage.of(
                    status: status(.unconfigured), pendingCount: 0, storeError: nil))
                == .attention)
        #expect(
            try tone(SyncMessage.of(status: status(.authError), pendingCount: 0, storeError: nil))
                == .attention)
    }

    @Test("every tone has its own glyph, so colour is never the only channel")
    func glyphsAreDistinctPerTone() throws {
        // Built through `of` rather than the initializer, because the point is
        // that the three tones a store can actually produce are distinguishable
        // without seeing colour at all.
        let messages = try [
            #require(SyncMessage.of(status: status(.idle), pendingCount: 3, storeError: nil)),
            #require(
                SyncMessage.of(
                    status: status(.backoff, error: .Connection(message: "refused")),
                    pendingCount: 1,
                    storeError: nil)),
            #require(
                SyncMessage.of(status: status(.unconfigured), pendingCount: 0, storeError: nil)),
        ]
        #expect(Set(messages.map(\.tone)).count == 3)
        #expect(Set(messages.map(\.systemImage)).count == 3)
    }

    @Test("a local failure wins over the engine's, because it is the actionable one")
    func aLocalFailureTakesPrecedence() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.backoff, error: .Network(message: "offline")),
                pendingCount: 1,
                storeError: .Validation(message: "that is not a date")))
        #expect(message.detail == "that is not a date")
    }

    @Test("an unconfigured engine points at Settings rather than blaming the network")
    func anUnconfiguredEngineSaysSo() throws {
        let message = try #require(
            SyncMessage.of(status: status(.unconfigured), pendingCount: 0, storeError: nil))
        #expect(message.title == "No server configured")
        // A retry cannot help when there is nothing to retry against; the
        // remedy is the window where the address is entered.
        #expect(message.remedy == .openSettings)
    }

    @Test("an HTTP status is shown, and an envelope failure's zero is not")
    func errorMessagesReadForAHuman() {
        #expect(CoreError.Api(message: "boom", status: 503).userMessage == "boom (HTTP 503)")
        #expect(CoreError.Api(message: "boom", status: 0).userMessage == "boom")
        #expect(
            CoreError.NotFound(message: "task not found: a.md").userMessage
                == "task not found: a.md")
    }
}
