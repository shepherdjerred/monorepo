package red.sjer.facet

/** CSS RGBA interpretation shared with the native Apple/Windows projections. */
internal data class FacetColorProjection(val argb: Long?, val diagnostic: String?)
internal fun projectFacetColor(raw: String): FacetColorProjection {
    val value = raw.trim().lowercase()
    val named = mapOf(
        "black" to 0x000000L, "silver" to 0xc0c0c0L, "gray" to 0x808080L, "white" to 0xffffffL,
        "maroon" to 0x800000L, "red" to 0xff0000L, "purple" to 0x800080L, "fuchsia" to 0xff00ffL,
        "green" to 0x008000L, "lime" to 0x00ff00L, "olive" to 0x808000L, "yellow" to 0xffff00L,
        "navy" to 0x000080L, "blue" to 0x0000ffL, "teal" to 0x008080L, "aqua" to 0x00ffffL
    )
    if (value == "transparent") return FacetColorProjection(0L, null)
    named[value]?.let { return FacetColorProjection(0xff000000L or it, null) }
    val digits = value.removePrefix("#")
    if (value.startsWith("#") && digits.length in listOf(3, 4, 6, 8) && digits.all { it in '0'..'9' || it in 'a'..'f' }) {
        val expanded = if (digits.length < 5) digits.map { "$it$it" }.joinToString("") else digits
        val rgba = if (expanded.length == 6) expanded + "ff" else expanded
        val rgb = rgba.take(6).toLong(16)
        val alpha = rgba.takeLast(2).toLong(16)
        return FacetColorProjection((alpha shl 24) or rgb, null)
    }
    return FacetColorProjection(null, "Unsupported configured color '$raw'. Use #RGB, #RGBA, #RRGGBB, #RRGGBBAA, a standard CSS color name, or transparent in TaskNotes settings.")
}
