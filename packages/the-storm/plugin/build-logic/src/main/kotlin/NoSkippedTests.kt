import javax.xml.parsers.DocumentBuilderFactory
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.w3c.dom.Node

/**
 * Fails the build when any test was skipped. MockBukkit reports unimplemented Paper APIs as
 * skipped (it throws an assumption failure), so a skip means the test proved nothing.
 */
abstract class NoSkippedTests : DefaultTask() {
  @get:InputFiles
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val reports: ConfigurableFileCollection

  @TaskAction
  fun check() {
    val factory = DocumentBuilderFactory.newInstance()
    val skipped =
        reports.files
            .filter { it.isFile }
            .flatMap { file -> factory.newDocumentBuilder().parse(file).getElementsByTagName("testcase").toList() }
            .filter { case -> case.childNodes.toList().any { it.nodeName == "skipped" } }
            .map { case ->
              val attributes = case.attributes
              "${attributes.getNamedItem("classname")?.nodeValue}#${attributes.getNamedItem("name")?.nodeValue}"
            }
    if (skipped.isNotEmpty()) {
      throw GradleException(
          "Skipped tests are not allowed (a MockBukkit skip means an unimplemented API):\n" +
              skipped.joinToString("\n") { "  - $it" })
    }
  }

  private fun org.w3c.dom.NodeList.toList(): List<Node> = (0 until length).map { item(it) }
}
