import Foundation

/// Every admitted native action is offered in order; taps are never silently dropped.
@MainActor
internal final class FacetActionCoordinator {
    private struct Entry {
        let run: @MainActor () async -> Bool
        let result: CheckedContinuation<Bool, Never>
    }
    private var entries: [Entry] = []
    private var draining = false

    func submit(_ operation: @escaping @MainActor () async -> Bool) async -> Bool {
        await withCheckedContinuation { continuation in
            entries.append(Entry(run: operation, result: continuation))
            if !draining {
                draining = true
                _Concurrency.Task { await drain() }
            }
        }
    }

    private func drain() async {
        while !entries.isEmpty {
            let entry = entries.removeFirst()
            entry.result.resume(returning: await entry.run())
        }
        draining = false
    }
}
