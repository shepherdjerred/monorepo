import Foundation
import Synchronization
import TaskNotesKit

internal final class ComponentKeys: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) throws -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) throws { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) throws { values.withLock { _ = $0.removeValue(forKey: name) } }
}
