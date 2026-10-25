package red.sjer.facet

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Bundle
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.util.UUID
import kotlinx.serialization.json.*
import org.junit.Assert.*
import red.sjer.facet.host.*

/** The same ordinary daily/missing-template protocol as the independently proven Rust and Apple fixture. */
internal class OccurrenceUiFixture private constructor(val context: Context, val profile: VaultProfile, val day: String, val original: Map<String, String>) {
    val root = File(context.noBackupFilesDir, "vaults/${profile.id}").canonicalFile
    val next = LocalDate.parse(day).plusDays(1).toString()
    fun file(path: String): File = File(root, path).canonicalFile.also { require(it.path.startsWith(root.path + File.separator)) }
    fun bytes(path: String) = file(path).readBytes()
    fun restoreOnlyTemplate() {
        assertFalse(file(TEMPLATE).exists())
        val parent = bytes(REPAIR_PARENT); val child = bytes(REPAIR_CHILD)
        val target = file(TEMPLATE); check(target.parentFile?.isDirectory == true || requireNotNull(target.parentFile).mkdirs())
        FileOutputStream(target).use { it.write("---\nstatus: open\n---\nRestored occurrence template body.\n".toByteArray()); it.fd.sync() }
        assertArrayEquals(parent, bytes(REPAIR_PARENT)); assertArrayEquals(child, bytes(REPAIR_CHILD))
    }
    suspend fun inspect(expectedFuture: Int, completed: Boolean = true): List<VaultTask> {
        val engine = FacetEngineRunner.open(context)
        try {
            val snapshot = engine.refresh(profile.id)
            assertNotNull(snapshot.configuration)
            assertEquals("local_folder", engine.profiles().single { it.id == profile.id }.kind)
            val tasks = engine.snapshot(profile.id, FacetEngineRunner.query(showCompleted = true)).tasks
            val child = tasks.single { it.path == REPAIR_CHILD }
            assertEquals(completed, child.completed)
            assertEquals("[[/$REPAIR_PARENT]]", child.properties.getValue("recurrenceParent").jsonPrimitive.content)
            assertTrue(child.body.contains("Completed child body stays exact."))
            assertEquals(Json.parseToJsonElement("""{"unchanged":"child"}"""), child.properties.getValue("vendor"))
            assertTrue(bytes(REPAIR_CHILD).toString(Charsets.UTF_8).contains("timeEntries: opaque-preserved-history"))
            val future = tasks.filter { it.path != REPAIR_CHILD && it.properties["recurrenceParent"]?.jsonPrimitive?.contentOrNull == "[[/$REPAIR_PARENT]]" }
            assertEquals(expectedFuture, future.size)
            future.forEach { assertEquals(next, it.occurrenceDate); assertTrue(it.body.contains("Restored occurrence template body.")) }
            assertEquals(6 + expectedFuture, tasks.size)
            assertArrayEquals(requireNotNull(original[ROLLING_PARENT]).toByteArray(), bytes(ROLLING_PARENT))
            assertArrayEquals(requireNotNull(original["Reference.md"]).toByteArray(), bytes("Reference.md"))
            return tasks
        } finally { engine.close() }
    }
    suspend fun assertExplicitGenerateJournal() {
        val database = File(context.noBackupFilesDir, "engine/facet.sqlite3")
        val requests = mutableListOf<JsonObject>()
        SQLiteDatabase.openDatabase(database.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            db.rawQuery("SELECT fingerprint FROM journals WHERE profile=? ORDER BY rowid", arrayOf(profile.id)).use { rows ->
                while (rows.moveToNext()) {
                    val request = Json.parseToJsonElement(rows.getString(0)).jsonObject
                    val command = request.getValue("command").jsonObject
                    if (command["kind"] == JsonPrimitive("materialize_occurrence_window") && command["origin"] == JsonPrimitive("user")) requests += request
                }
            }
        }
        val request = requests.single()
        val schema = FacetSchema(context.assets.open("facet-engine.schema.json").bufferedReader().use { it.readText() })
        schema.validate("mutation", request)
        assertEquals(day, request.getValue("command").jsonObject.getValue("referenceDate").jsonPrimitive.content)
        val engine = FacetEngineRunner.open(context)
        try {
            val receipt = engine.features(profile.id, buildJsonObject { put("kind", "mutation_receipt"); put("mutationId", request.getValue("mutationId")) })
            assertEquals("applied", receipt.getValue("state").jsonPrimitive.content)
            assertTrue(receipt.getValue("receipt").jsonObject.getValue("applied").jsonPrimitive.boolean)
            assertTrue(engine.pendingMutations(profile.id).isEmpty())
        } finally { engine.close() }
    }
    fun writeFinalPins(completedParent: ByteArray, completedChild: ByteArray, futurePath: String, repairReceipt: String) {
        assertArrayEquals(completedParent, bytes(REPAIR_PARENT)); assertArrayEquals(completedChild, bytes(REPAIR_CHILD))
        val all = file("Tasks").walkTopDown().filter { it.isFile && it.extension == "md" }.associate { candidate ->
            candidate.relativeTo(root).invariantSeparatorsPath to java.security.MessageDigest.getInstance("SHA-256").digest(candidate.readBytes()).joinToString("") { "%02x".format(it) }
        }
        val output = File(requireNotNull(context.getExternalFilesDir("acceptance")), "series-${profile.id}-pins.json")
        output.writeText(buildJsonObject {
            put("schemaVersion", 1); put("profileId", profile.id); put("profileName", profile.name); put("day", day); put("nextDay", next)
            put("futurePath", futurePath); put("repairReceipt", repairReceipt); put("notes", JsonObject(all.mapValues { JsonPrimitive(it.value) }))
        }.toString())
    }
    companion object {
        const val ROLLING_TITLE = "Occurrence rolling parent"
        const val CHILD_TITLE = "Occurrence repair child"
        const val ROLLING_PARENT = "Tasks/Rolling.md"
        const val REPAIR_PARENT = "Tasks/Repair.md"
        const val REPAIR_CHILD = "Tasks/Repair-child.md"
        const val TEMPLATE = "Templates/missing.md"
        suspend fun prepare(context: Context): OccurrenceUiFixture {
            FacetBackgroundSync.awaitBackgroundDrain()
            val day = LocalDate.now().toString(); val start = day.replace("-", ""); val stamp = "${day}T00:00:00Z"
            val common = "status: open\npriority: normal\ntags: [task]\ndateCreated: $stamp\ndateModified: $stamp\n"
            val files = linkedMapOf(
                "tasknotes.yaml" to "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\ntemplating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n",
                ".obsidian/plugins/tasknotes/data.json" to """{"tasksFolder":"Tasks","storeTitleInFilename":false,"taskFilenameFormat":"title"}""",
                "Reference.md" to "# Occurrence acceptance\n\nThis exact reference must remain unchanged.\n",
                ROLLING_PARENT to "---\ntitle: $ROLLING_TITLE\n${common}id: occurrence-rolling\nrecurrence: DTSTART:$start;FREQ=DAILY;COUNT=3\nscheduled: $day\noccurrence_materialization: rolling\noccurrence_past_horizon: P0D\noccurrence_future_horizon: P2D\nvendor: {unchanged: rolling}\n---\nRolling parent body stays exact.\n",
                REPAIR_PARENT to "---\ntitle: Occurrence repair parent\n${common}id: occurrence-repair\nrecurrence: DTSTART:$start;FREQ=DAILY\nscheduled: $day\nrecurrence_anchor: completion\noccurrence_materialization: on_completion\noccurrence_next_trigger: completion\noccurrence_template: $TEMPLATE\nvendor: {unchanged: repair}\n---\nRepair parent body stays exact.\n",
                REPAIR_CHILD to "---\ntitle: $CHILD_TITLE\n${common}recurrence_parent: '[[/$REPAIR_PARENT]]'\noccurrence_date: $day\nscheduled: $day\nvendor: {unchanged: child}\ntimeEntries: opaque-preserved-history\n---\nCompleted child body stays exact.\n",
            )
            val sourceId = UUID.randomUUID().toString()
            val extras = Bundle().apply { putBundle("files", Bundle().apply { files.forEach { (path, bytes) -> putString(path, bytes) } }) }
            val prepared = requireNotNull(context.contentResolver.call(Uri.parse("content://${AcceptanceVaultProvider.AUTHORITY}"), "prepare", sourceId, extras))
            val engine = FacetEngineRunner.open(context)
            val profile = try { engine.importSnapshot(Uri.parse(requireNotNull(prepared.getString("tree"))), "Series acceptance ${sourceId.take(8)}").profile.also { engine.refresh(it.id) } }
            finally { engine.close() }
            check(context.getSharedPreferences("facet.presentation", Context.MODE_PRIVATE).edit().putString("selectedProfile", profile.id).commit())
            return OccurrenceUiFixture(context, profile, day, files)
        }
    }
}
