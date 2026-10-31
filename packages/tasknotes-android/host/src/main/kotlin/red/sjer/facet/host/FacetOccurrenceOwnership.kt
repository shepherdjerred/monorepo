package red.sjer.facet.host

import java.util.concurrent.atomic.AtomicLong

/** Opaque admission fence safe on both Main and the engine's IO dispatcher. Invalidated owners never revive. */
class FacetOccurrenceOwnership {
    private val generation = AtomicLong()
    fun revoke() { generation.incrementAndGet() }
    fun capture(): () -> Boolean {
        val captured = generation.get()
        return { generation.get() == captured }
    }
}
