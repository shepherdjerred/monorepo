// rwfmap: the offline map analysis for Search and Destroy bots. It bakes every
// rwf map (map.yml + blocks.schem) into the nav.rwfnav artifact rwfbots loads
// and verifies the committed artifacts byte for byte, so CI catches a stale or
// non-deterministic bake. It is a tool, not a gameplay module: dist never
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
  bakeRwfMaps { dependsOn(bake) }
  verifyRwfMaps { dependsOn(verify) }
}

tasks.check { dependsOn(verifyRwfMaps) }

// The end-to-end tests bake the shipped maps and compare them with the committed artifacts.
tasks.test {
  inputs.dir(mapsRoot).withPropertyName("shippedMaps").withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwf.maps", mapsRoot.absolutePath)
}
