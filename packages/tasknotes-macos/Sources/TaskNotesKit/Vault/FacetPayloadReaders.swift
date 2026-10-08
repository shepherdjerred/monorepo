import Foundation

/// Tracks native ownership of retained immutable payload readers.
/// Only active readers are retained; closed handles need no historical set.
internal actor FacetPayloadReaders {
    struct Owner: Equatable, Sendable {
        let profileID: String
        let generation: UUID
    }

    private struct Entry {
        let owner: Owner
        let reader: FacetBoundedPayloadReader
    }

    private var open = true
    private var generations: [String: UUID] = [:]
    private var entries: [UUID: Entry] = [:]

    func owner(profileID: String) throws -> Owner {
        guard open else { throw FacetSyncError.cancelled }
        let generation = generations[profileID] ?? UUID()
        generations[profileID] = generation
        return Owner(profileID: profileID, generation: generation)
    }

    func register(_ reader: FacetBoundedPayloadReader, owner: Owner) async throws -> UUID {
        guard open, owner.generation == generations[owner.profileID] else {
            await reader.close()
            throw FacetSyncError.cancelled
        }
        let id = UUID()
        entries[id] = Entry(owner: owner, reader: reader)
        return id
    }

    func release(id: UUID, owner: Owner) async throws {
        guard let entry = entries[id] else { return }
        guard entry.owner == owner else { throw FacetContractError.unsupportedResponse }
        await entry.reader.close()
        entries.removeValue(forKey: id)
    }

    func allows(id: UUID, owner: Owner) -> Bool {
        open && generations[owner.profileID] == owner.generation && entries[id]?.owner == owner
    }

    func closeProfile(_ profileID: String) async {
        generations.removeValue(forKey: profileID)
        let retained = entries.filter { $0.value.owner.profileID == profileID }
        for (id, entry) in retained {
            await entry.reader.close()
            entries.removeValue(forKey: id)
        }
    }

    func closeAll() async {
        open = false
        generations.removeAll()
        let retained = entries
        for (id, entry) in retained {
            await entry.reader.close()
            entries.removeValue(forKey: id)
        }
    }
}

/// Presentation never sees FFI objects. The native factory registers the
/// reader before returning this lease; owner cleanup closes the same reader.
internal actor FacetPayloadReaderLease: FacetPayloadReading {
    private let reader: FacetBoundedPayloadReader
    private let registry: FacetPayloadReaders
    private let owner: FacetPayloadReaders.Owner
    private let id: UUID
    private var closed = false

    init(
        reader: FacetBoundedPayloadReader, registry: FacetPayloadReaders,
        owner: FacetPayloadReaders.Owner, id: UUID
    ) {
        self.reader = reader
        self.registry = registry
        self.owner = owner
        self.id = id
    }

    func read(offset: UInt64, length: UInt32) async throws -> Data {
        guard !closed else { throw FacetSyncError.cancelled }
        let bytes = try await reader.read(offset: offset, length: length)
        guard !closed, await registry.allows(id: id, owner: owner) else {
            throw FacetSyncError.cancelled
        }
        return bytes
    }

    func close() async throws {
        guard !closed else { return }
        try await registry.release(id: id, owner: owner)
        closed = true
    }
}
