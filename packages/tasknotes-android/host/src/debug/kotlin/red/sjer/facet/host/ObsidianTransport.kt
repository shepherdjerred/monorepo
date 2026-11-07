package red.sjer.facet.host

import java.util.concurrent.atomic.AtomicReference
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient

/** Process-scoped instrumentation capability, absent from the release source set. */
internal object ObsidianTransport {
    private val fixture = AtomicReference<HttpUrl?>(null)

    fun installFixture(origin: String): AutoCloseable {
        val endpoint = origin.toHttpUrl()
        require(endpoint.scheme == "http" && endpoint.host == "127.0.0.1" && endpoint.port > 0 &&
            endpoint.encodedPath == "/" && endpoint.query == null && endpoint.fragment == null &&
            endpoint.username.isEmpty() && endpoint.password.isEmpty())
        check(fixture.compareAndSet(null, endpoint)) { "An Android fixture transport is already owned." }
        return AutoCloseable { check(fixture.compareAndSet(endpoint, null)) { "The Android fixture transport owner changed." } }
    }

    fun client(): OkHttpClient {
        val endpoint = fixture.get()
        val builder = OkHttpClient.Builder().followRedirects(false)
        if (endpoint != null) builder.addInterceptor { chain ->
            val request = chain.request()
            require(request.url.scheme == "https" && request.url.port == 443 &&
                request.url.username.isEmpty() && request.url.password.isEmpty())
            val path = when (request.url.host) {
                "api.obsidian.md" -> request.url.encodedPath
                "sync-fixture.obsidian.md" -> {
                    require(request.url.encodedPath == "/" && request.url.query == null)
                    "/sync"
                }
                else -> error("The synthetic transport rejects unknown production hosts.")
            }
            val mapped = endpoint.newBuilder().encodedPath(path).encodedQuery(request.url.encodedQuery).build()
            chain.proceed(request.newBuilder().url(mapped).build())
        }
        return builder.build()
    }
}
