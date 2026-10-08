package red.sjer.facet.host

import java.io.Closeable
import java.io.File
import java.nio.file.Files

/** Concrete private capability owner for the proposed callback records, independent of generated61. */
internal class FacetBoundedVault(
    directory: File,
    private val profile: String,
    engineIdentity: String,
    private val resolve: (String) -> File,
    private val requireWritable: () -> Unit,
    snapshotFiles: SnapshotFiles = NativeSnapshotFiles,
    exchangeFiles: ExchangeFiles = NativeExchangeFiles,
    private val legacy: FacetLegacyBackups? = null,
) : Closeable {
    private val stages = FacetBoundedStages(File(directory, "stages"), profile, engineIdentity, synchronize = exchangeFiles::synchronize)
    private val snapshots = FacetBoundedSnapshots(File(directory, "read-images"), profile, snapshotFiles)
    private val exchange = FacetBoundedExchange(File(directory, "exchanges"), profile, engineIdentity, stages, resolve, exchangeFiles)
    private var closed = false

    @Synchronized fun openFileSnapshot(owner: String, path: String): BoundedSnapshot? { requireOwner(owner); return snapshots.capture(owner, resolve(path)) }
    @Synchronized fun openDisplacedSnapshot(owner: String, id: String): BoundedSnapshot {
        requireOwner(owner)
        val (metadata, source) = if (FacetLegacyBackups.isLegacyId(id) && legacy != null) legacy.source(id) else exchange.displacedSource(id)
        return snapshots.capture(owner, source, metadata.size, metadata.revision) ?: error("The retained predecessor is missing.")
    }
    @Synchronized fun readSnapshotChunk(owner: String, id: String, offset: ULong, length: UInt): ByteArray { requireOwner(owner); return snapshots.read(owner, id, offset, length) }
    @Synchronized fun closeSnapshot(owner: String, id: String) { requireOwner(owner); snapshots.closeSnapshot(owner, id) }
    @Synchronized fun beginReplacement(owner: String, operation: String, path: String, expected: String?, size: ULong, revision: String): BoundedStage {
        requireOwner(owner); requireWritable(); resolve(path)
        return stages.begin(owner, operation, path, expected, size, revision)
    }
    @Synchronized fun writeReplacementChunk(owner: String, id: String, offset: ULong, bytes: ByteArray): BoundedStage { requireOwner(owner); requireWritable(); return stages.write(owner, id, offset, bytes) }
    @Synchronized fun sealReplacement(owner: String, id: String): BoundedStage { requireOwner(owner); requireWritable(); return stages.seal(owner, id) }
    @Synchronized fun compareExchangeStaged(owner: String, operation: String, path: String, expected: String?, id: String?): BoundedExchangeOutcome {
        requireOwner(owner); requireWritable()
        val target = resolve(path)
        Files.createDirectories(requireNotNull(target.parentFile).toPath())
        // The owning resolver checks all newly created components again.
        resolve(path)
        return exchange.exchange(owner, operation, path, expected, id)
    }
    @Synchronized fun discardReplacement(owner: String, id: String) {
        requireOwner(owner); requireWritable()
        exchange.discardSlot(stages.receipt(owner, id).operationId)
        stages.discard(owner, id)
    }
    @Synchronized fun displacedMetadata(owner: String, afterId: String?, limit: Int): List<BoundedDisplaced> { requireOwner(owner); return (exchange.metadata(afterId, limit) + (legacy?.metadata(afterId, limit) ?: emptyList())).sortedBy { it.id }.take(limit) }
    @Synchronized fun acknowledgeDisplaced(owner: String, id: String) { requireOwner(owner); requireWritable(); if (FacetLegacyBackups.isLegacyId(id) && legacy != null) legacy.acknowledge(id) else exchange.acknowledge(id) }

    @Synchronized override fun close() { if (closed) return; closed = true; snapshots.close() }
    private fun requireOwner(owner: String) { check(!closed) { "The bounded callback owner is closed." }; require(owner == profile) { "The capability belongs to another profile." } }
}
