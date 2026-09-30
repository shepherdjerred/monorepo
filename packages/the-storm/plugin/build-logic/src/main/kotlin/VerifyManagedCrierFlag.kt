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

  @get:InputFile
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val merchantSource: RegularFileProperty

  @TaskAction
  fun verify() {
    val root =
        JsonSlurper().parse(inventory.get().asFile) as? Map<*, *>
            ?: throw GradleException("invalid flag inventory")
    val flags = root["flags"] as? List<*> ?: throw GradleException("flag inventory has no flags")
    fun constant(source: String, name: String): String =
        Regex("""private static final String $name = "([^"]+)";""")
            .find(source)
            ?.groupValues
            ?.get(1)
            ?: throw GradleException("missing Flipt client constant $name")
    val crier = clientSource.get().asFile.readText()
    val merchant = merchantSource.get().asFile.readText()
    val expected =
        listOf(
            "the-storm-world" to constant(crier, "FLAG_KEY"),
            "the-storm-merchant" to constant(merchant, "FLAG_KEY"))
    for ((source, key) in expected) {
      val flag =
          flags.filterIsInstance<Map<*, *>>().singleOrNull { it["source"] == source }
              ?: throw GradleException("expected exactly one managed flag for $source")
      if (flag["type"] != "boolean" ||
          flag["default"] != false ||
          flag["key"] != key ||
          flag["namespace"] != constant(crier, "NAMESPACE_KEY")) {
        throw GradleException("Flipt $source identifiers differ from managed inventory")
      }
    }
  }
}
