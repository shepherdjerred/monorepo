import groovy.json.JsonSlurper
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Checks one Java Flipt client's {@code NAMESPACE_KEY} and {@code FLAG_KEY} constants against the
 * managed flag whose {@code source} is {@link #flagSource} in the shared inventory.
 */
abstract class VerifyManagedFlag : DefaultTask() {
  @get:InputFile
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val inventory: RegularFileProperty

  @get:InputFile
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val source: RegularFileProperty

  @get:Input abstract val flagSource: Property<String>

  @TaskAction
  fun verify() {
    val root =
        JsonSlurper().parse(inventory.get().asFile) as? Map<*, *>
            ?: throw GradleException("invalid flag inventory")
    val flags = root["flags"] as? List<*> ?: throw GradleException("flag inventory has no flags")
    val text = source.get().asFile.readText()
    fun constant(name: String): String =
        Regex("""private static final String $name = "([^"]+)";""")
            .find(text)
            ?.groupValues
            ?.get(1)
            ?: throw GradleException("missing Flipt client constant $name in ${source.get()}")
    val id = flagSource.get()
    val flag =
        flags.filterIsInstance<Map<*, *>>().singleOrNull { it["source"] == id }
            ?: throw GradleException("expected exactly one managed flag for $id")
    if (flag["type"] != "boolean" ||
        flag["default"] != false ||
        flag["key"] != constant("FLAG_KEY") ||
        flag["namespace"] != constant("NAMESPACE_KEY")) {
      throw GradleException("Flipt $id identifiers differ from managed inventory")
    }
  }
}
