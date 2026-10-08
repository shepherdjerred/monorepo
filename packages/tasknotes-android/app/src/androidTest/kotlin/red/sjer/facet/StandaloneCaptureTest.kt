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

class StandaloneCaptureTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun captureEditAndRelaunchUseThePrivateMarkdownVault() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        val name = "Capture acceptance ${id.take(8)}"
        runBlocking {
            val engine = FacetEngineRunner.open(context)
            engine.registerReplica(id, name, approveStandard = true)
            engine.refresh(id)
            engine.close()
        }
        var activity = ActivityScenario.launch(MainActivity::class.java)
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Vaults").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Vaults").performClick()
        compose.onNode(hasText(name) and hasClickAction()).performClick()
        compose.onNodeWithContentDescription("Add task").performClick()
        compose.onNodeWithText("Title").performTextInput("Created on Android")
        compose.onNodeWithText("Save").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Created on Android").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Created on Android").performClick()
        compose.onNodeWithText("Title").performTextClearance()
        compose.onNodeWithText("Title").performTextInput("Edited on Android")
        compose.onNodeWithText("Save").performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Edited on Android").fetchSemanticsNodes().isNotEmpty() }
        activity.close()
        activity = ActivityScenario.launch(MainActivity::class.java)
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Vaults").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Vaults").performClick()
        compose.onNode(hasText(name) and hasClickAction()).performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Edited on Android").fetchSemanticsNodes().isNotEmpty() }
        runBlocking {
            val engine = FacetEngineRunner.open(context)
            val task = engine.refresh(id).tasks.single()
            assertTrue(task.title == "Edited on Android")
            engine.close()
        }
        activity.close()
    }
}
