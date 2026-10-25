package red.sjer.facet

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import red.sjer.facet.host.FacetEngineRunner
import red.sjer.facet.host.FacetBackgroundSync

class StandaloneCaptureTest {
    @get:Rule val compose = createEmptyComposeRule()

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
            waitForText("Created on Android")
            compose.onNodeWithText("Created on Android").performClick()
            compose.onNode(hasSetTextAction() and hasText("Created on Android")).performTextClearance()
            compose.onNodeWithText("Task title").performTextInput("Edited on Android")
            compose.onNodeWithText("Save").performClick()
            waitForText("Edited on Android")
            activity.close(); activity = null
            runBlocking { FacetBackgroundSync.awaitBackgroundDrain() }
            activity = ActivityScenario.launch(MainActivity::class.java)
            waitForText(name)
            compose.onNodeWithText("Inbox").performClick()
            waitForText("Edited on Android")
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
        compose.waitUntil(15_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(text).assertIsDisplayed()
    }
}
