package red.sjer.facet

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import java.security.MessageDigest
import kotlinx.serialization.json.*
import red.sjer.facet.host.FacetSchema

internal data class FacetFeedbackEffect(val sound: String?, val haptic: String)
internal class FacetFeedbackPolicy private constructor(val effects: Map<FacetFeedbackKind, FacetFeedbackEffect>, val cues: JsonObject) {
    companion object {
        fun read(schema: String, feedback: String, palette: String): FacetFeedbackPolicy {
            val validator = FacetSchema(schema)
            val policy = Json.parseToJsonElement(feedback).jsonObject
            val audio = Json.parseToJsonElement(palette).jsonObject
            validator.validate("feedback", policy); validator.validate("palette", audio)
            val effects = FacetFeedbackKind.entries.associateWith { kind ->
                val event = policy.getValue("events").jsonObject.getValue(kind.name.lowercase()).jsonObject
                FacetFeedbackEffect(event.getValue("sound").jsonPrimitive.contentOrNull, event.getValue("haptic").jsonPrimitive.content)
            }
            return FacetFeedbackPolicy(effects, audio.getValue("cues").jsonObject)
        }
    }
}

/** Cached UI sonification: no audio focus, media stream, forced audibility or deferred playback. */
internal class FacetNativeFeedback(private val context: Context) : AutoCloseable {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val pool = SoundPool.Builder().setMaxStreams(1).setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build()
    private val loaded = java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()
    private val samples = java.util.concurrent.ConcurrentHashMap<String, Int>()
    private val gate = Any()
    private val physicalGate = FacetAudioGate()
    private var playing = 0
    @Volatile private var policy: FacetFeedbackPolicy? = null
    @Volatile private var closed = false
    @Volatile var diagnostic: String? = null; private set
    init { pool.setOnLoadCompleteListener { _, id, status ->
        if (!closed) { if (status == 0) loaded.add(id) else diagnostic = "Task sounds could not load on this device. Your tasks are still saved." }
    } }
    fun preload() {
        fun text(path: String) = context.assets.open(path).bufferedReader().use { it.readText() }
        val parsed = FacetFeedbackPolicy.read(text("feedback.schema.json"), text("feedback.json"), text("audio/palette.json"))
        parsed.cues.forEach { (cue, value) ->
            val record = value.jsonObject
            val path = "audio/" + record.getValue("file").jsonPrimitive.content
            val bytes = context.assets.open(path).use { it.readBytes() }
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            check(hash == record.getValue("sha256").jsonPrimitive.content) { "The required task sound does not match its palette: $cue" }
            synchronized(gate) {
                if (closed) return
                val id = context.assets.openFd(path).use { pool.load(it, 1) }
                if (id == 0) diagnostic = "Task sounds could not load on this device. Restart the app to retry; your tasks are still saved."
                else samples[cue] = id
            }
        }
        policy = parsed
    }
    fun applied(event: FacetSavedFeedback, preferences: FacetFeedbackPreferences, view: View, owns: () -> Boolean) {
        if (closed || !owns()) return
        val effect = policy?.effects?.getValue(event.kind) ?: return
        val cue = effect.sound ?: return
        val duration = requireNotNull(policy).cues.getValue(cue).jsonObject.getValue("milliseconds").jsonPrimitive.long
        if (!physicalGate.claim(android.os.SystemClock.uptimeMillis(), duration) || !owns()) return
        if (preferences.haptics) haptic(view, effect.haptic)
        if (!preferences.sound || !owns()) return
        if (Settings.System.getInt(context.contentResolver, Settings.System.SOUND_EFFECTS_ENABLED, 1) == 0 || audio.ringerMode != AudioManager.RINGER_MODE_NORMAL || audio.isStreamMute(AudioManager.STREAM_SYSTEM) || audio.getStreamVolume(AudioManager.STREAM_SYSTEM) == 0) return
        val sample = samples[cue] ?: return
        // A not-yet-ready sample is consumed, never replayed after focus/ownership changes.
        if (sample !in loaded) return
        if (!owns()) return
        playing = pool.play(sample, 1f, 1f, 1, 0, 1f)
        if (playing == 0) diagnostic = "Task sounds could not play on this device. Your tasks are still saved."
    }
    fun stop() { if (!closed && playing != 0) { pool.stop(playing); playing = 0 } }
    private fun haptic(view: View, kind: String) {
        when (kind) {
            "success" -> view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CLOCK_TICK)
            "light" -> view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            "none" -> Unit
            else -> error("Unsupported required haptic policy: $kind")
        }
    }
    override fun close() { synchronized(gate) { closed = true; pool.release(); loaded.clear() } }
}
