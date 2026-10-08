package red.sjer.facet

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** Navigation identity comes from the notification's owning profile and exact stored path. */
data class FacetReminderRoute(val profileId: String, val path: String) {
    companion object {
        fun parse(value: String): FacetReminderRoute {
            val uri = URI(value)
            require(uri.scheme == "tasknotes" && uri.host == "reminder" && uri.port == -1 && uri.userInfo == null && uri.fragment == null && uri.path.orEmpty() in setOf("", "/")) { "This reminder link is unsupported." }
            val pairs = requireNotNull(uri.rawQuery) { "The reminder link has no owning vault." }.split('&').map { pair ->
                val parts = pair.split('=', limit = 2)
                require(parts.size == 2) { "The reminder link is incomplete." }
                URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name()) to URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name())
            }
            require(pairs.map { it.first }.toSet() == setOf("profileId", "path") && pairs.size == 2) { "The reminder link has ambiguous navigation fields." }
            val fields = pairs.toMap()
            val profile = fields.getValue("profileId")
            val path = fields.getValue("path")
            require(profile.isNotBlank() && path.isNotBlank() && (profile + path).none { it.isISOControl() }) { "The reminder link has an invalid vault or task path." }
            return FacetReminderRoute(profile, path)
        }
    }
}

data class FacetReminderRequest(val id: String, val route: FacetReminderRoute)
