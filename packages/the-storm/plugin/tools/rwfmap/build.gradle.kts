// rwfmap: the offline map analysis for Search and Destroy bots. It bakes every
// rwf map (map.yml + blocks.schem) into the nav.rwfnav artifact rwfbots loads
// and verifies the shipped artifacts byte for byte when verifyRwfMaps is run.
// It also bakes the lobby (rwf/lobby) and verifies it the same way.
// The artifacts are not in Git: rwf/nav-manifest.json names each one by sha256,
// a bake records it there, and fetchRwfNavs materialises what the manifest names.
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

/** The shipped rwf content: nav-manifest.json, the lobby and every map. */
val rwfRoot = rootProject.file("../server/owned/plugins/TheStorm/rwf")

/** The maps the server ships, each in its own `<id>/` folder. */
val mapsRoot = rwfRoot.resolve("maps")

/** The lobby: lobby.yml, blocks.schem and its nav files. */
val lobbyFolder = rwfRoot.resolve("lobby")

val mapFolders =
    (mapsRoot.listFiles { file -> file.isDirectory } ?: emptyArray()).sortedBy { it.name }

// A bake changes one artifact's bytes, so each bake ends by recording that artifact and no other:
// a nav.rwfnav left on disk by another branch is stale, never a reason to rewrite its entry.
// The recorders share one file, so they run one at a time, in this order.
val navManifestWriters = mutableListOf<TaskProvider<JavaExec>>()

fun registerNavManifestWriter(name: String, artifact: String): TaskProvider<JavaExec> {
  val writer =
      tasks.register<JavaExec>(name) {
        group = "rwf"
        description = "Records the sha256 and size of the baked $artifact in nav-manifest.json."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("manifest", rwfRoot.absolutePath, artifact)
      }
  navManifestWriters.lastOrNull()?.let { previous -> writer { mustRunAfter(previous) } }
  navManifestWriters.add(writer)
  return writer
}

// Everything that reads a shipped nav.rwfnav depends on this task: the files are ignored by Git
// and exist in a checkout only once fetched. A missing or altered object fails the build.
val fetchRwfNavs =
    tasks.register<JavaExec>("fetchRwfNavs") {
      group = "rwf"
      description = "Fetches every nav.rwfnav that nav-manifest.json names, verified by sha256."
      classpath = sourceSets.main.get().runtimeClasspath
      mainClass = mainClassName
      args("fetch", rwfRoot.absolutePath)
      inputs
          .file(rwfRoot.resolve("nav-manifest.json"))
          .withPropertyName("navManifest")
          .withPathSensitivity(PathSensitivity.NONE)
      outputs
          .files((mapFolders + lobbyFolder).map { it.resolve("nav.rwfnav") })
          .withPropertyName("navFiles")
    }

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
  val writer = registerNavManifestWriter("writeRwfNavManifest$suffix", "maps/${folder.name}/nav.rwfnav")
  val bake =
      tasks.register<JavaExec>("bakeRwfMap$suffix") {
        group = "rwf"
        description = "Bakes the ${folder.name} map."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("bake", folder.absolutePath)
        inputs.files(folder.resolve("map.yml"), folder.resolve("blocks.schem"))
        outputs.files(folder.resolve("nav.rwfnav"), folder.resolve("nav.summary.json"))
        finalizedBy(writer)
      }
  val verify =
      tasks.register<JavaExec>("verifyRwfMap$suffix") {
        group = "rwf"
        description = "Verifies the committed nav files of the ${folder.name} map."
        classpath = sourceSets.main.get().runtimeClasspath
        mainClass = mainClassName
        args("verify", folder.absolutePath)
        inputs.dir(folder)
        dependsOn(fetchRwfNavs)
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
  fetchRwfNavs { mustRunAfter(bake) }
}

val lobbyWriter = registerNavManifestWriter("writeRwfNavManifestLobby", "lobby/nav.rwfnav")

val bakeRwfLobby =
    tasks.register<JavaExec>("bakeRwfLobby") {
      group = "rwf"
      description = "Bakes the lobby's nav files from its blocks.schem."
      classpath = sourceSets.main.get().runtimeClasspath
      mainClass = mainClassName
      args("bake-lobby", lobbyFolder.absolutePath)
      inputs.files(lobbyFolder.resolve("lobby.yml"), lobbyFolder.resolve("blocks.schem"))
      outputs.files(lobbyFolder.resolve("nav.rwfnav"), lobbyFolder.resolve("nav.summary.json"))
      finalizedBy(lobbyWriter)
    }

fetchRwfNavs { mustRunAfter(bakeRwfLobby) }

// A fetch in the same invocation as a bake runs last, so the bake's bytes are what it finds.
navManifestWriters.forEach { writer -> fetchRwfNavs { mustRunAfter(writer) } }

val verifyRwfLobby =
    tasks.register<JavaExec>("verifyRwfLobby") {
      group = "rwf"
      description = "Verifies the committed lobby's hash, places and nav files."
      classpath = sourceSets.main.get().runtimeClasspath
      mainClass = mainClassName
      args("verify-lobby", lobbyFolder.absolutePath)
      inputs.dir(lobbyFolder)
      dependsOn(fetchRwfNavs)
      mustRunAfter(bakeRwfLobby)
    }

bakeRwfMaps { dependsOn(bakeRwfLobby) }

// These suites declare the shipped terrain/navigation as inputs. When an operator explicitly
// requests a rebake and tests in one invocation, finish generation before reading those inputs.
listOf(":rwf", ":rwfbots").forEach { consumer ->
  rootProject.project(consumer).tasks.named("test") {
    mustRunAfter(bakeRwfMaps, bakeRwfLobby)
    navManifestWriters.forEach { writer -> mustRunAfter(writer) }
  }
}

verifyRwfMaps { dependsOn(verifyRwfLobby) }

tasks.check { dependsOn(verifyRwfMaps) }

// CI fetches and decodes every shipped artifact and checks it against the manifest and the shipped
// map metadata. Full deterministic rebakes stay in verifyRwfMaps, which is available to the
// operator and local extended suites.
tasks.test {
  // The largest shipped navigation artifact expands to over 200 MiB before its graph is decoded.
  maxHeapSize = "2g"
  dependsOn(fetchRwfNavs)
  mustRunAfter(bakeRwfLobby)
  navManifestWriters.forEach { writer -> mustRunAfter(writer) }
  inputs.dir(mapsRoot).withPropertyName("shippedMaps").withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(lobbyFolder)
      .withPropertyName("shippedLobby")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .file(rwfRoot.resolve("nav-manifest.json"))
      .withPropertyName("navManifest")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwf.root", rwfRoot.absolutePath)
  systemProperty("thestorm.rwf.maps", mapsRoot.absolutePath)
  systemProperty("thestorm.rwf.lobby", lobbyFolder.absolutePath)
}
