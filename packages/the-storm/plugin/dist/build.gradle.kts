// Assembles TheStorm.jar: core, every gameplay module and the shared runtime
// libraries in one shaded jar. Dependencies are not relocated: paper-plugin.yml
// gives the plugin an isolated class loader, and relocation breaks
// sqlite-jdbc's native loading and Flyway's service discovery.
plugins { id("storm.dist-conventions") }

val gameplayModules =
    rootProject.childProjects.values.filter { it.projectDir.parentFile.name == "modules" }

dependencies { gameplayModules.forEach { implementation(project(it.path)) } }

tasks.processResources {
  val pluginVersion = project.version.toString()
  inputs.property("version", pluginVersion)
  filesMatching("paper-plugin.yml") { expand(mapOf("version" to pluginVersion)) }
}

tasks.shadowJar {
  archiveFileName = "TheStorm.jar"
  mergeServiceFiles()
  exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "module-info.class")
  // sqlite-jdbc ships natives for every OS. Keep the server's (Linux glibc) and
  // Apple silicon for local runServer.
  exclude { element ->
    val path = element.path
    path.startsWith("org/sqlite/native/") &&
        !path.startsWith("org/sqlite/native/Linux/aarch64/") &&
        !path.startsWith("org/sqlite/native/Linux/x86_64/") &&
        !path.startsWith("org/sqlite/native/Mac/aarch64/") &&
        !element.isDirectory
  }
}

tasks.jar { enabled = false }

tasks.assemble { dependsOn(tasks.shadowJar) }

val runServerDirectory = rootProject.file("run")
val prepareRunServerContent =
    tasks.register<Copy>("prepareRunServerContent") {
      from(rootProject.file("../server/owned/plugins/TheStorm"))
      into(runServerDirectory.resolve("plugins/TheStorm"))
    }

tasks.runServer {
  minecraftVersion("26.2")
  runDirectory = runServerDirectory
  dependsOn(prepareRunServerContent)
  downloadPlugins {
    url("https://cdn.modrinth.com/data/Vebnzrzj/versions/b0mk8uS6/LuckPerms-Bukkit-5.5.71.jar")
  }
}

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies { testImplementation(libs.findLibrary("archunit").get()) }
