package red.sjer.facet

import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import java.io.File
import java.io.FileOutputStream
import android.graphics.Bitmap
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.FixMethodOrder
import org.junit.runners.MethodSorters
import org.junit.Assert.*
import androidx.lifecycle.ViewModelProvider
import red.sjer.facet.host.FacetEngineRunner
import red.sjer.facet.host.FacetBackgroundSync

@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class StandaloneCaptureTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val runId = UUID.randomUUID().toString()

    @Test fun seriesGenerateRepairUndoAndRelaunchUseDurableCoreReceipts() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixture = runBlocking { OccurrenceUiFixture.prepare(context) }
        var activity: ActivityScenario<MainActivity>? = null
        var model: FacetViewModel? = null
        fun launch() {
            check(activity == null)
            activity = ActivityScenario.launch(MainActivity::class.java)
            requireNotNull(activity).onActivity { model = ViewModelProvider(it)[FacetViewModel::class.java] }
            waitForText(fixture.profile.name)
            compose.waitUntil(30_000) { model?.busy == false && model?.snapshot?.configuration != null }
        }
        fun stop() {
            activity?.close(); activity = null; model = null
            runBlocking { FacetBackgroundSync.awaitBackgroundDrain() }
        }
        fun allTasks() {
            compose.onNodeWithText("Browse").performClick()
            compose.onNodeWithText("All tasks").performClick()
            waitForText(OccurrenceUiFixture.ROLLING_TITLE)
        }
        fun health() {
            compose.onNodeWithContentDescription("Settings").performClick()
            compose.onNodeWithText("Vault health").performClick()
            waitForText("Repair generation")
        }
        try {
            launch()
            compose.waitUntil(30_000) { model?.allSnapshot?.totalCount == 6uL && model?.generationWindows?.any { it.parentPath == OccurrenceUiFixture.ROLLING_PARENT } == true }
            allTasks()
            compose.onNodeWithText(OccurrenceUiFixture.ROLLING_TITLE).performClick()
            compose.onNodeWithText("Generate window").assertIsEnabled()
            capture("series-generator-ready")
            compose.onNodeWithText("Generate window").performClick()
            compose.waitUntil(30_000) { model?.busy == false }
            capture("series-window-generated")
            compose.onNodeWithText("Cancel").performClick()
            stop()
            // UI admission must have produced one actual explicit-user journal, even when automatic maintenance already filled the window.
            runBlocking { fixture.assertExplicitGenerateJournal(); fixture.inspect(expectedFuture = 0, completed = false) }

            launch(); allTasks()
            compose.onNodeWithContentDescription("Complete ${OccurrenceUiFixture.CHILD_TITLE}", substring = true).performClick()
            compose.waitUntil(30_000) { model?.busy == false && model?.generationAttention?.any { it.item.parentPath == OccurrenceUiFixture.REPAIR_PARENT } == true }
            assertTrue(requireNotNull(model).completionFailures.isEmpty())
            val primary = requireNotNull(model).generationAttention.single { it.item.parentPath == OccurrenceUiFixture.REPAIR_PARENT }.primaryMutationId
            compose.onNodeWithText("Saved. Future occurrences need attention; review Repair generation in Settings.").assertIsDisplayed()
            capture("series-completed-needs-repair")
            health(); capture("series-repair-needed")
            stop()
            runBlocking { fixture.inspect(expectedFuture = 0) }
            val completedParent = fixture.bytes(OccurrenceUiFixture.REPAIR_PARENT)
            val completedChild = fixture.bytes(OccurrenceUiFixture.REPAIR_CHILD)
            assertFalse(requireNotNull(fixture.original[OccurrenceUiFixture.REPAIR_CHILD]).toByteArray().contentEquals(completedChild))
            fixture.restoreOnlyTemplate()

            launch()
            compose.waitUntil(30_000) { model?.generationAttention?.singleOrNull()?.primaryMutationId == primary }
            health(); capture("series-repair-survives-relaunch")
            assertArrayEquals(completedParent, fixture.bytes(OccurrenceUiFixture.REPAIR_PARENT))
            assertArrayEquals(completedChild, fixture.bytes(OccurrenceUiFixture.REPAIR_CHILD))
            compose.onNodeWithText("Repair generation").assertIsEnabled().performClick()
            compose.waitUntil(30_000) { model?.busy == false && model?.generationAttention?.isEmpty() == true && model?.undoHead != null && model?.undoHead != primary }
            val repaired = requireNotNull(requireNotNull(model).undoHead)
            capture("series-repaired")
            assertArrayEquals(completedParent, fixture.bytes(OccurrenceUiFixture.REPAIR_PARENT))
            assertArrayEquals(completedChild, fixture.bytes(OccurrenceUiFixture.REPAIR_CHILD))
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Undo").fetchSemanticsNodes().size == 1 }
            compose.onNodeWithText("Undo").assertIsEnabled().performClick()
            compose.waitUntil(30_000) { model?.busy == false && model?.undoHead == primary && model?.generationAttention?.singleOrNull()?.primaryMutationId == primary }
            capture("series-repair-undone")
            stop()
            runBlocking { fixture.inspect(expectedFuture = 0) }
            assertArrayEquals(completedParent, fixture.bytes(OccurrenceUiFixture.REPAIR_PARENT))
            assertArrayEquals(completedChild, fixture.bytes(OccurrenceUiFixture.REPAIR_CHILD))

            launch(); health()
            compose.onNodeWithText("Repair generation").assertIsEnabled().performClick()
            compose.waitUntil(30_000) { model?.busy == false && model?.generationAttention?.isEmpty() == true && model?.undoHead != null && model?.undoHead != primary && model?.undoHead != repaired }
            val finalReceipt = requireNotNull(requireNotNull(model).undoHead)
            capture("series-repaired-again")
            stop()
            val tasks = runBlocking { fixture.inspect(expectedFuture = 1) }
            val future = tasks.single { it.path != OccurrenceUiFixture.REPAIR_CHILD && it.properties["recurrenceParent"]?.jsonPrimitive?.contentOrNull == "[[/${OccurrenceUiFixture.REPAIR_PARENT}]]" }
            fixture.writeFinalPins(completedParent, completedChild, future.path, finalReceipt)
            launch()
            compose.waitUntil(30_000) { model?.generationAttention?.isEmpty() == true && model?.undoHead == finalReceipt }
            allTasks(); capture("series-final-relaunch")
            stop()
            runBlocking { fixture.inspect(expectedFuture = 1) }
            assertArrayEquals(completedParent, fixture.bytes(OccurrenceUiFixture.REPAIR_PARENT))
            assertArrayEquals(completedChild, fixture.bytes(OccurrenceUiFixture.REPAIR_CHILD))
        } catch (failure: Throwable) {
            try { capture("series-failure") } catch (captureFailure: Throwable) { failure.addSuppressed(captureFailure) }
            throw failure
        } finally { stop() }
    }

    @Test fun captureEditAndRelaunchUseThePrivateMarkdownVault() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        val name = "Capture acceptance ${id.take(8)}"
        runBlocking {
            val engine = FacetEngineRunner.open(context)
            try {
                engine.registerReplica(id, name, approveStandard = true)
                engine.refresh(id)
            } finally { engine.close() }
        }
        check(context.getSharedPreferences("facet.presentation", android.content.Context.MODE_PRIVATE).edit().putString("selectedProfile", id).commit())
        var activity: ActivityScenario<MainActivity>? = null
        try {
            activity = ActivityScenario.launch(MainActivity::class.java)
            waitForText(name)
            compose.onNodeWithText("Inbox").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("Add task").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Add task").performClick()
            compose.onNodeWithText("What needs doing?").performTextInput("Created on Android")
            compose.waitUntil(15_000) { compose.onAllNodes(hasText("Add") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Add").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Add task").fetchSemanticsNodes().isEmpty() }
            waitForText("Created on Android")
            capture("created")
            compose.onNodeWithText("Created on Android").performClick()
            compose.onNode(hasSetTextAction() and hasText("Created on Android")).performTextClearance()
            compose.onNodeWithText("Task title").performTextInput("Edited on Android")
            compose.onNodeWithText("Save").performClick()
            waitForText("Edited on Android")
            capture("edited")
            activity.close(); activity = null
            runBlocking { FacetBackgroundSync.awaitBackgroundDrain() }
            activity = ActivityScenario.launch(MainActivity::class.java)
            waitForText(name)
            compose.onNodeWithText("Inbox").performClick()
            waitForText("Edited on Android")
            capture("relaunched")
        } catch (failure: Throwable) {
            try { capture("failure") } catch (captureFailure: Throwable) { failure.addSuppressed(captureFailure) }
            throw failure
        } finally {
            activity?.close()
            runBlocking { FacetBackgroundSync.awaitBackgroundDrain() }
        }
        // Inspect after the UI writer has drained, never through a competing open engine.
        runBlocking {
            val engine = FacetEngineRunner.open(context)
            try { assertTrue(engine.refresh(id).tasks.single().title == "Edited on Android") }
            finally { engine.close() }
        }
    }
    private fun waitForText(text: String) {
        // An outgoing editor may still expose its draft while the saved list reloads.
        val title = hasText(text) and !hasSetTextAction() and
            SemanticsMatcher.keyNotDefined(SemanticsProperties.EditableText)
        compose.waitUntil(15_000) {
            compose.onAllNodes(title).fetchSemanticsNodes().size == 1 &&
                compose.onNode(title).isDisplayed()
        }
        compose.onNode(title).assertIsDisplayed()
    }
    private fun capture(label: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val directory = requireNotNull(instrumentation.targetContext.getExternalFilesDir("acceptance"))
        check(directory.isDirectory || directory.mkdirs())
        FileOutputStream(File(directory, "$runId-$label.png")).use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
