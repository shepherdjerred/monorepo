import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

@Suite("Account request ownership") @MainActor
struct FacetAccountHTTPTests {
    @Test func alreadyFencedAttemptSendsNothing() async {
        var methods: [String] = []
        await #expect(throws: FacetSyncError.self) {
            try await FacetAccountHTTP.perform(
                request(), ownsAttempt: { false },
                send: {
                    methods.append($0.httpMethod ?? "")
                    return (200, Data())
                })
        }
        #expect(methods.isEmpty)
    }

    @Test func fencingBlockedPreflightNeverSendsPasswordPost() async {
        let pause = AccountHTTPPause()
        var owns = true
        var methods: [String] = []
        let exchange = _Concurrency.Task {
            try await FacetAccountHTTP.perform(
                request(), ownsAttempt: { owns },
                send: {
                    methods.append($0.httpMethod ?? "")
                    await pause.stop()
                    return (200, Data())
                })
        }
        await pause.waitForEntry()
        owns = false
        await pause.resume()
        await #expect(throws: FacetSyncError.self) { try await exchange.value }
        #expect(methods == ["OPTIONS"])
    }

    @Test func cancellingBlockedPreflightNeverSendsPasswordPost() async {
        let pause = AccountHTTPPause()
        var methods: [String] = []
        let exchange = _Concurrency.Task {
            try await FacetAccountHTTP.perform(
                request(), ownsAttempt: { true },
                send: {
                    methods.append($0.httpMethod ?? "")
                    await pause.stop()
                    return (200, Data())
                })
        }
        await pause.waitForEntry()
        exchange.cancel()
        await pause.resume()
        await #expect(throws: CancellationError.self) { try await exchange.value }
        #expect(methods == ["OPTIONS"])
    }

    @Test func cancelledBeforeExchangeSendsNothing() async {
        let pause = AccountHTTPPause()
        var calls = 0
        let exchange = _Concurrency.Task {
            await pause.stop()
            return try await FacetAccountHTTP.perform(
                request(), ownsAttempt: { true },
                send: { _ in
                    calls += 1
                    return (200, Data())
                })
        }
        await pause.waitForEntry()
        exchange.cancel()
        await pause.resume()
        await #expect(throws: CancellationError.self) { try await exchange.value }
        #expect(calls == 0)
    }

    @Test func fencedPostResponseCannotBeAccepted() async {
        var owns = true
        var methods: [String] = []
        await #expect(throws: FacetSyncError.self) {
            try await FacetAccountHTTP.perform(
                request(), ownsAttempt: { owns },
                send: {
                    methods.append($0.httpMethod ?? "")
                    if $0.httpMethod == "POST" { owns = false }
                    return (200, Data("synthetic result".utf8))
                })
        }
        #expect(methods == ["OPTIONS", "POST"])
    }

    @Test func normalExchangePreservesCoreBodyHeadersAndResponse() async throws {
        let coreRequest = request()
        var calls: [URLRequest] = []
        let (status, bytes) = try await FacetAccountHTTP.perform(
            coreRequest, ownsAttempt: { true },
            send: {
                calls.append($0)
                return (200, Data("synthetic result".utf8))
            })
        #expect(calls.map(\.httpMethod) == ["OPTIONS", "POST"])
        #expect(calls[0].httpBody == nil)
        #expect(calls[0].value(forHTTPHeaderField: "Origin") == "https://obsidian.md")
        #expect(calls[0].value(forHTTPHeaderField: "Content-Type") == nil)
        #expect(calls[1].httpBody == Data(coreRequest.body.utf8))
        #expect(calls[1].value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(status == 200)
        #expect(bytes == Data("synthetic result".utf8))
    }

    private func request() -> ObsidianHttpRequest {
        ObsidianHttpRequest(
            requestId: 1, url: "https://api.obsidian.md/user/signin", preflight: true,
            headers: [
                ObsidianHttpHeader(name: "Origin", value: "https://obsidian.md"),
                ObsidianHttpHeader(name: "Content-Type", value: "application/json"),
            ], body: "{\"email\":\"synthetic@example.invalid\",\"password\":\"synthetic\"}")
    }
}

private actor AccountHTTPPause {
    private var continuation: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?
    private var entered = false

    func stop() async {
        await withCheckedContinuation {
            continuation = $0
            entered = true
            observer?.resume()
            observer = nil
        }
    }

    func waitForEntry() async {
        if !entered { await withCheckedContinuation { observer = $0 } }
    }

    func resume() {
        continuation?.resume()
        continuation = nil
    }
}
