import Foundation
import Network
import Observation
import OSLog

/// Monitors network connectivity using NWPathMonitor.
///
/// Publishes `isConnected` state and notifies the polling coordinator
/// to pause/resume polling based on connectivity changes.
@Observable
final class NetworkMonitor: @unchecked Sendable {
    // MARK: Lifecycle

    init() {
        self.monitor = NWPathMonitor()
        self.monitorQueue = DispatchQueue(label: "com.shepherdjerred.glance.networkmonitor")
    }

    deinit {
        self.stop()
    }

    // MARK: Internal

    /// Whether the network path is currently satisfied.
    private(set) var isConnected = true

    /// Start monitoring network connectivity.
    /// - Parameter onReconnect: Called when connectivity is restored after being lost.
    func start(onReconnect: @escaping @Sendable () -> Void) {
        self.onReconnect = onReconnect
        self.monitor.pathUpdateHandler = { [weak self] path in
            guard let self else {
                return
            }
            let connected = path.status == .satisfied
            let wasConnected = self.isConnected

            GlanceLogger.network.info(
                "Network path update: status=\(String(describing: path.status)), satisfied=\(connected)",
            )

            self.isConnected = connected

            // Trigger reconnect callback when transitioning from disconnected to connected.
            if connected, !wasConnected {
                GlanceLogger.network.info("Network reconnected, triggering refresh")
                self.onReconnect?()
            }
        }
        self.monitor.start(queue: self.monitorQueue)
    }

    /// Stop monitoring.
    func stop() {
        self.monitor.cancel()
    }

    // MARK: Private

    private let monitor: NWPathMonitor
    private let monitorQueue: DispatchQueue
    private var onReconnect: (@Sendable () -> Void)?
}
