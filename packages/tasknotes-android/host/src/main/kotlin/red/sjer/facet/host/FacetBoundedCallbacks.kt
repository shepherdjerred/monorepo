package red.sjer.facet.host

import java.io.Closeable
import uniffi.TaskNotesCore.FacetDisplacedMetadata
import uniffi.TaskNotesCore.FacetFileSnapshot
import uniffi.TaskNotesCore.FacetHostException
import uniffi.TaskNotesCore.FacetReplacementStage
import uniffi.TaskNotesCore.FacetStagedExchange
import uniffi.TaskNotesCore.FacetVaultFiles

/** No strong engine/session reference; owners outlive callbacks until closeRuntime drains them. */
internal class FacetBoundedCallbacks(private val files: PrivateVaultFiles, private val factory: (String, String) -> FacetBoundedVault = files::openBoundedCapability) : FacetVaultFiles, Closeable {
    private val gate = Any()
    private val owners = mutableMapOf<String, FacetBoundedVault>()
    private var identity: String? = null
    private var closed = false

    fun bindRuntimeIdentity(value: String) = synchronized(gate) {
        if (closed || !Regex("[0-9a-f]{64}").matches(value) || (identity != null && identity != value)) throw FacetHostException.Contract("bounded_engine_identity_invalid")
        identity = value
    }

    private fun owner(profile: String): FacetBoundedVault = synchronized(gate) {
        if (closed) throw FacetHostException.Contract("bounded_callback_owner_closed")
        val namespace = identity ?: throw FacetHostException.Contract("bounded_engine_identity_unbound")
        owners.getOrPut(profile) { factory(profile, namespace) }
    }

    override fun listFiles(profileId: String): List<String> = boundary {
        synchronized(gate) { if (closed || identity == null) throw FacetHostException.Contract("bounded_callback_owner_unavailable") }
        files.list(profileId)
    }
    override fun openFileSnapshot(profileId: String, path: String): FacetFileSnapshot? = boundary { owner(profileId).openFileSnapshot(profileId, path)?.ffi() }
    override fun openDisplacedSnapshot(profileId: String, backupId: String): FacetFileSnapshot = boundary { owner(profileId).openDisplacedSnapshot(profileId, backupId).ffi() }
    override fun readSnapshotChunk(profileId: String, snapshotId: String, offset: ULong, length: UInt): ByteArray = boundary { owner(profileId).readSnapshotChunk(profileId, snapshotId, offset, length) }
    override fun closeSnapshot(profileId: String, snapshotId: String) = boundary { owner(profileId).closeSnapshot(profileId, snapshotId) }
    override fun beginReplacement(profileId: String, operationId: String, path: String, expectedRevision: String?, size: ULong, revision: String): FacetReplacementStage = boundary { owner(profileId).beginReplacement(profileId, operationId, path, expectedRevision, size, revision).ffi() }
    override fun writeReplacementChunk(profileId: String, stageId: String, offset: ULong, bytes: ByteArray): FacetReplacementStage = boundary { owner(profileId).writeReplacementChunk(profileId, stageId, offset, bytes).ffi() }
    override fun sealReplacement(profileId: String, stageId: String): FacetReplacementStage = boundary { owner(profileId).sealReplacement(profileId, stageId).ffi() }
    override fun compareExchangeStaged(profileId: String, operationId: String, path: String, expectedRevision: String?, stageId: String?): FacetStagedExchange = boundary {
        owner(profileId).compareExchangeStaged(profileId, operationId, path, expectedRevision, stageId).let { FacetStagedExchange(it.applied, it.displaced?.ffi()) }
    }
    override fun discardReplacement(profileId: String, stageId: String) = boundary { owner(profileId).discardReplacement(profileId, stageId) }
    override fun displacedMetadata(profileId: String, afterId: String?, limit: UInt): List<FacetDisplacedMetadata> = boundary {
        if (limit !in 1u..128u) throw FacetHostException.Contract("bounded_metadata_limit_invalid")
        owner(profileId).displacedMetadata(profileId, afterId, limit.toInt()).map { it.ffi() }
    }
    override fun acknowledgeDisplaced(profileId: String, id: String) = boundary { owner(profileId).acknowledgeDisplaced(profileId, id) }

    /** Called after successful core deletion and stopped/unbound session; never deletes vault content. */
    fun detachProfile(profileId: String) { synchronized(gate) { owners.remove(profileId) }?.close() }

    /** Only after successful closeRuntime; every temporary snapshot owner is attempted. */
    override fun close() {
        val retired = synchronized(gate) {
            if (closed) return
            closed = true
            owners.values.toList().also { owners.clear() }
        }
        var first: Throwable? = null
        for (owner in retired) try { owner.close() } catch (failure: Throwable) {
            if (first == null) first = failure else first.addSuppressed(failure)
        }
        first?.let { throw it }
    }

    private fun <T> boundary(block: () -> T): T = try { block() } catch (failure: Exception) {
        val mapped = facetHostFailure(failure) ?: when (failure) {
            is IllegalArgumentException, is IllegalStateException -> FacetHostException.Contract("bounded_private_contract_invalid").also { it.initCause(failure) }
            else -> null
        }
        throw (mapped ?: failure)
    }
    private fun BoundedSnapshot.ffi() = FacetFileSnapshot(id, size, revision)
    private fun BoundedStage.ffi() = FacetReplacementStage(id, operationId, path, size, revision, written, sealed)
    private fun BoundedDisplaced.ffi() = FacetDisplacedMetadata(id, path, size, revision)
}
