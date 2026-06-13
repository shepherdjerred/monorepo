import Foundation

/// Timer-based polling coordinator that fires a callback on a regular interval.
actor PollingScheduler {
    // MARK: Lifecycle

    // MARK: - Initialization

    /// Create a scheduler with the given interval and tick callback.
    /// - Parameters:
    ///   - interval: Time between ticks.
    ///   - onTick: Async closure called on each tick.
    init(
        interval: Duration = .seconds(60),
        onTick: @escaping @Sendable () async -> Void,
    ) {
        self.interval = interval
        self.onTick = onTick
    }

    // MARK: Internal

    // MARK: - Control

    /// Start the polling loop. If already running, this is a no-op.
    func start() {
        guard self.task == nil else {
            return
        }
        self.task = Task {
            while !Task.isCancelled {
                await self.onTick()
                try? await Task.sleep(for: self.interval)
            }
        }
    }

    /// Stop the polling loop.
    func stop() {
        self.task?.cancel()
        self.task = nil
    }

    /// Trigger an immediate tick outside the regular interval.
    func tickNow() async {
        await self.onTick()
    }

    // MARK: Private

    private var task: Task<Void, Never>?
    private let interval: Duration
    private let onTick: @Sendable () async -> Void
}
