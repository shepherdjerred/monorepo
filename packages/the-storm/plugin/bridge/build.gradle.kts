// MCBridge: an HTTP bridge that lets the mc-harness agent tooling drive a Paper
// server (console commands, exact region reads, WorldEdit operations,
// snapshots, events). A separate, unshaded MCBridge.jar: it shares the Storm
// build conventions but depends on no Storm project. Contract:
// packages/mc-harness/src/protocol/bridge.ts.
plugins { id("storm.java-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

// Test actors (/v1/actors) drive Citizens player NPCs; only adapter.citizens
// touches these classes and Citizens is optional at runtime. Same pinned,
// checksum-verified Citizens jar as the Storm modules (libs.citizens).
dependencies {
  compileOnly(lib("citizens")) { isTransitive = false }
  compileOnly(lib("paper-api"))
  compileOnly(lib("worldedit-core"))
  compileOnly(lib("worldedit-bukkit"))
  // Server log capture (/v1/events "log") attaches an appender; Paper ships log4j-core.
  compileOnly(lib("log4j-core"))
  testImplementation(lib("paper-api"))
}
tasks.processResources {
  val pluginVersion = project.version.toString()
  inputs.property("version", pluginVersion)
  filesMatching("paper-plugin.yml") { expand(mapOf("version" to pluginVersion)) }
}

tasks.jar { archiveFileName = "MCBridge.jar" }
