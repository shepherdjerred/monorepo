import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

plugins { id("storm.module-conventions") }

@CacheableTask
abstract class GenerateLegacyItemKeys : DefaultTask() {
  @get:InputFile @get:PathSensitive(PathSensitivity.NONE) abstract val source: RegularFileProperty
  @get:OutputDirectory abstract val destination: DirectoryProperty

  @TaskAction
  fun generate() {
    val entries = source.get().asFile.readLines(Charsets.UTF_8)
      .filter { it.isNotBlank() && !it.startsWith("#") }
      .map { line ->
        val parts = line.split(',')
        require(parts.size == 2 && parts[0].matches(Regex("[0-9]+:[0-9]+")) &&
          parts[1].matches(Regex("minecraft:[a-z0-9_]+"))) { "Invalid legacy item: $line" }
        parts[0] to parts[1]
      }
    require(entries.map { it.first }.distinct().size == entries.size) { "Duplicate legacy item" }
    val file = destination.file("com/shepherdjerred/thestorm/core/material/LegacyItemKeys.java").get().asFile
    file.parentFile.mkdirs()
    val rows = entries.joinToString(",\n") { (key, value) -> "    java.util.Map.entry(\"$key\", \"$value\")" }
    file.writeText("""
      |package com.shepherdjerred.thestorm.core.material;
      |/** Generated from legacy-items.csv; the neutral registry is the source of truth. */
      |@org.jspecify.annotations.NullMarked
      |public final class LegacyItemKeys {
      |  private LegacyItemKeys() {}
      |  private static final java.util.Map<String, String> ITEMS = java.util.Map.ofEntries(
      |$rows);
      |  public static java.util.Optional<String> resolve(String text) {
      |    var key = text.strip();
      |    if (key.matches("[0-9]+")) key += ":0";
      |    return java.util.Optional.ofNullable(ITEMS.get(key));
      |  }
      |}
      |""".trimMargin(), Charsets.UTF_8)
  }
}

val generateLegacyItemKeys = tasks.register<GenerateLegacyItemKeys>("generateLegacyItemKeys") {
  source.set(layout.projectDirectory.file("src/main/resources/legacy-items.csv"))
  destination.set(layout.buildDirectory.dir("generated/sources/legacyItems/java"))
}
sourceSets.main { java.srcDir(generateLegacyItemKeys.flatMap { it.destination }) }
tasks.compileJava { dependsOn(generateLegacyItemKeys) }

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

// Core exposes the shared runtime stack to every module.
dependencies {
  api(lib("jackson-databind"))
  api(lib("jackson-yaml"))
  api(lib("jooq"))
  implementation(lib("flyway-core"))
  implementation(lib("hikari"))
  runtimeOnly(lib("sqlite-jdbc"))
  testRuntimeOnly(lib("sqlite-jdbc"))
}
