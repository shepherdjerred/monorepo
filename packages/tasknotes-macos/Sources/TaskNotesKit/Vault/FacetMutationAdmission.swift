import Synchronization

/// The exact native journal identity becomes observable only after durable admission.
public final class FacetMutationAdmission: Sendable {
    private let identity = Mutex<String?>(nil)
    public init() {}
    public var mutationID: String? { identity.withLock { $0 } }
    internal func record(_ id: String) { identity.withLock { $0 = id } }
}
