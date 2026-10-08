package red.sjer.facet.host

data class FacetNoticeAdmission(val requestGeneration: Long, val engineGeneration: Long)

/** Production admission authority: clearing and publication are synchronous and atomic. */
class FacetNoticeAuthority {
    private val gate = Any()
    private var request = 0L
    private var engine = 1L
    private var closed = false
    private var current: FacetNoticeOwner? = null

    fun begin(clear: () -> Unit = {}): FacetNoticeAdmission = synchronized(gate) {
        check(!closed) { "The presentation owner is closed." }
        current = null; request++; clear()
        FacetNoticeAdmission(request, engine)
    }
    fun capture(admission: FacetNoticeAdmission, profileId: String, mutationId: String): FacetNoticeOwner {
        require(profileId.isNotEmpty() && mutationId.isNotEmpty())
        val owner = FacetNoticeOwner(profileId, mutationId, admission.requestGeneration, admission.engineGeneration)
        synchronized(gate) { if (isCurrent(admission)) current = owner }
        return owner
    }
    fun isCurrent(admission: FacetNoticeAdmission): Boolean = synchronized(gate) {
        !closed && request == admission.requestGeneration && engine == admission.engineGeneration
    }
    fun owns(owner: FacetNoticeOwner, profileId: String?): Boolean = synchronized(gate) {
        !closed && current == owner && request == owner.requestGeneration && engine == owner.engineGeneration && owner.profileId == profileId
    }
    fun publishIfOwned(owner: FacetNoticeOwner, profileId: String?, publish: () -> Unit): Boolean = synchronized(gate) {
        if (!owns(owner, profileId)) false else { publish(); true }
    }
    fun close(clear: () -> Unit = {}) = synchronized(gate) {
        if (!closed) { closed = true; current = null; request++; engine++; clear() }
    }
}
