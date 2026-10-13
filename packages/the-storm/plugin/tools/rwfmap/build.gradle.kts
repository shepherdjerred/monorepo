// rwfmap: the offline map analysis for Search and Destroy bots. It bakes every
// rwf map (map.yml + blocks.schem) into the nav.rwfnav artifact rwfbots loads
// and verifies the committed artifacts byte for byte when verifyRwfMaps is run.
// It also bakes the lobby (rwf/lobby) and verifies it the same way.
// It is a tool, not a gameplay module: dist never
// shades it and the architecture project never puts it on its classpath.
plugins {
  id("storm.java-conventions")
  application
}

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

dependencies {
  implementation(project(":core"))
  implementation(project(":rwf"))
  implementation(project(":rwfbots"))
  // rwf's content adapter mentions Paper's BlockData in signatures the tool never
  // calls; the compiler still needs the class to read those files. Nothing from
  // Paper is on the tool's runtime classpath.
  compileOnly(lib("paper-api"))
}

val mainClassName = "com.shepherdjerred.thestorm.tools.rwfmap.RwfMap"

application { mainClass = mainClassName }

/** The maps the server ships, each in its own `<id>/` folder. */
val mapsRoot = rootProject.file("../server/owned/plugins/TheStorm/rwf/maps")

/** The lobby: lobby.yml, blocks.schem and its nav files. */
val lobbyFolder = rootProject.file("../server/owned/plugins/TheStorm/rwf/lobby")

val mapFolders =
    (mapsRoot.listFiles { file -> file.isDirectory } ?: emptyArray()).sortedBy { it.name }

fun taskSuffix(mapId: String) =
    mapId.split('-').joinToString("") { part -> part.replaceFirstChar(Char::uppercaseChar) }

val bakeRwfMaps =
    tasks.register("bakeRwfMaps") {
      group = "rwf"
      description = "Bakes nav.rwfnav and nav.summary.json for every shipped rwf map."
    }

val verifyRwfMaps =
    tasks.register("verifyRwfMaps") {
      group = "rwf"
      description = "Re-bakes every shipped rwf map and fails if the committed nav files differ."
    }

mapFolders.forEach { folder ->
  val suffix = taskSuffix(folder.name)
  val bake =
      tasks.register<JavaExec>("bakeRwfMap$suffix") {
        group = "rwf"
        description = "Bakes the ${folder.name} map."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("bake", folder.absolutePath)
        inputs.files(folder.resolve("map.yml"), folder.resolve("blocks.schem"))
        outputs.files(folder.resolve("nav.rwfnav"), folder.resolve("nav.summary.json"))
      }
  val verify =
      tasks.register<JavaExec>("verifyRwfMap$suffix") {
        group = "rwf"
        description = "Verifies the committed nav files of the ${folder.name} map."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("verify", folder.absolutePath)
        inputs.dir(folder)
        mustRunAfter(bake)
      }
  val verifyDetails =
      tasks.register<JavaExec>("verifyRwfMapDetails$suffix") {
        group = "rwf"
        description = "Verifies the inventory/sign payload of the ${folder.name} map."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("verify-details", folder.absolutePath)
        inputs.files(folder.resolve("map.yml"), folder.resolve("blocks.schem"), folder.resolve("details.json"))
      }
  bakeRwfMaps { dependsOn(bake) }
  verifyRwfMaps { dependsOn(verify, verifyDetails) }
  tasks.test { mustRunAfter(bake) }
}

val bakeRwfLobby =
    tasks.register<JavaExec>("bakeRwfLobby") {
      group = "rwf"
      description = "Bakes the lobby's nav files from its blocks.schem."
      classpath = sourceSets.main.get().runtimeClasspath
      mainClass = mainClassName
      args("bake-lobby", lobbyFolder.absolutePath)
      inputs.files(lobbyFolder.resolve("lobby.yml"), lobbyFolder.resolve("blocks.schem"))
      outputs.files(lobbyFolder.resolve("nav.rwfnav"), lobbyFolder.resolve("nav.summary.json"))
    }

val verifyRwfLobby =
    tasks.register<JavaExec>("verifyRwfLobby") {
      group = "rwf"
      description = "Verifies the committed lobby's hash, places and nav files."
      classpath = sourceSets.main.get().runtimeClasspath
      mainClass = mainClassName
      args("verify-lobby", lobbyFolder.absolutePath)
      inputs.dir(lobbyFolder)
      mustRunAfter(bakeRwfLobby)
    }

bakeRwfMaps { dependsOn(bakeRwfLobby) }

// These suites declare the shipped terrain/navigation as inputs. When an operator explicitly
// requests a rebake and tests in one invocation, finish generation before reading those inputs.
listOf(":rwf", ":rwfbots").forEach { consumer ->
  rootProject.project(consumer).tasks.named("test") {
    mustRunAfter(bakeRwfMaps, bakeRwfLobby)
  }
}

verifyRwfMaps { dependsOn(verifyRwfLobby) }

tasks.check { dependsOn(verifyRwfMaps) }

// CI decodes every committed artifact and checks it against shipped map metadata. Full deterministic
// rebakes stay in verifyRwfMaps, which is available to the operator and local extended suites.
tasks.test {
  // The largest committed navigation artifact expands to over 200 MiB before its graph is decoded.
  maxHeapSize = "2g"
  mustRunAfter(bakeRwfLobby)
  inputs.dir(mapsRoot).withPropertyName("shippedMaps").withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(lobbyFolder)
      .withPropertyName("shippedLobby")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwf.maps", mapsRoot.absolutePath)
  systemProperty("thestorm.rwf.lobby", lobbyFolder.absolutePath)
}
