package red.sjer.facet

import android.animation.ValueAnimator
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.serialization.json.*
import red.sjer.facet.host.FacetSchema

/** Shared presentation constants are validated independently of the engine contract. */
internal class FacetPresentationTokens private constructor(val document: JsonObject) {
    fun number(section: String, key: String) = document.getValue(section).jsonObject.getValue(key).jsonPrimitive.int
    fun text(role: String): TextStyle {
        val value = document.getValue("typography").jsonObject.getValue(role).jsonObject
        return TextStyle(fontSize = value.getValue("size").jsonPrimitive.int.sp,
            lineHeight = value.getValue("lineHeight").jsonPrimitive.int.sp,
            fontWeight = FontWeight(value.getValue("weight").jsonPrimitive.int))
    }
    companion object {
        fun read(document: String, schema: String): FacetPresentationTokens {
            val value = Json.parseToJsonElement(document).jsonObject
            FacetSchema(schema).validate("tokens", value)
            return FacetPresentationTokens(value)
        }
    }
}

internal val LocalFacetTokens = staticCompositionLocalOf<FacetPresentationTokens> { error("Facet presentation tokens are required.") }
internal val LocalFacetMotion = staticCompositionLocalOf { false }

@Composable
internal fun FacetTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var motion by remember { mutableStateOf(ValueAnimator.areAnimatorsEnabled()) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) motion = ValueAnimator.areAnimatorsEnabled() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val tokens = remember(context) {
        val schema = context.assets.open("presentation.schema.json").bufferedReader().use { it.readText() }
        val colors = context.assets.open("color-policy.json").bufferedReader().use { Json.parseToJsonElement(it.readText()) }
        FacetSchema(schema).validate("colorPolicy", colors)
        FacetPresentationTokens.read(context.assets.open("tokens.json").bufferedReader().use { it.readText() }, schema)
    }
    val dark = isSystemInDarkTheme()
    val colors = if (dark) darkColorScheme(
        primary = Color(0xFFBBB6FF), onPrimary = Color(0xFF231D66), primaryContainer = Color(0xFF30296D),
        background = Color(0xFF111114), surface = Color(0xFF19191F), surfaceContainer = Color(0xFF222229),
        surfaceContainerHigh = Color(0xFF2A2A32), onSurface = Color(0xFFF3F1F6), onSurfaceVariant = Color(0xFFB5B3C0),
        outlineVariant = Color(0xFF36353F), error = Color(0xFFFFB4AB)
    ) else lightColorScheme(
        primary = Color(0xFF5856D6), onPrimary = Color.White, primaryContainer = Color(0xFFE7E5FF),
        background = Color(0xFFF8F8FB), surface = Color.White, surfaceContainer = Color(0xFFF1F1F7),
        surfaceContainerHigh = Color(0xFFEAEAF2), onSurface = Color(0xFF202027), onSurfaceVariant = Color(0xFF676573),
        outlineVariant = Color(0xFFE4E3EB), error = Color(0xFFB3261E)
    )
    val typography = Typography(
        headlineLarge = tokens.text("title"), headlineMedium = tokens.text("heading"), titleLarge = tokens.text("heading"),
        titleMedium = tokens.text("subheading"), bodyLarge = tokens.text("body"), bodyMedium = tokens.text("bodySmall"),
        bodySmall = tokens.text("caption"), labelLarge = tokens.text("label"), labelMedium = tokens.text("label"), labelSmall = tokens.text("caption")
    )
    CompositionLocalProvider(LocalFacetTokens provides tokens, LocalFacetMotion provides motion) { MaterialTheme(colorScheme = colors, typography = typography, content = content) }
}
