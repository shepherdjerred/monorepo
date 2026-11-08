package red.sjer.facet.host

import okhttp3.OkHttpClient

/** Release builds have no alternate endpoint or test-transport capability. */
internal object ObsidianTransport {
    fun client(): OkHttpClient = OkHttpClient.Builder().followRedirects(false).build()
}
