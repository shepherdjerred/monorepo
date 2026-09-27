import groovy.json.JsonSlurper
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/** Checks the Java Flipt request identifiers against the shared managed flag inventory. */
abstract class VerifyManagedCrierFlag : DefaultTask() {
  @get:InputFile
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val inventory: RegularFileProperty

  @get:InputFile
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val clientSource: RegularFileProperty

  @TaskAction
  fun verify() {
    val root =
        JsonSlurper().parse(inventory.get().asFile) as? Map<*, *>
            ?: throw GradleException("invalid flag inventory")
    val flags = root["flags"] as? List<*> ?: throw GradleException("flag inventory has no flags")
    val flag =
        flags.filterIsInstance<Map<*, *>>().singleOrNull { it["source"] == "the-storm-world" }
            ?: throw GradleException("expected exactly one world-module flag")
    if (flag["type"] != "boolean" || flag["default"] != false) {
      throw GradleException("world-module flag must be a disabled boolean")
    }
    val source = clientSource.get().asFile.readText()
    fun constant(name: String): String =
        Regex("""private static final String $name = "([^"]+)";""")
            .find(source)
            ?.groupValues
            ?.get(1)
            ?: throw GradleException("missing Flipt client constant $name")
    if (constant("NAMESPACE_KEY") != flag["namespace"] || constant("FLAG_KEY") != flag["key"]) {
      throw GradleException("Flipt crier identifiers differ from managed inventory")
    }
  }
}
