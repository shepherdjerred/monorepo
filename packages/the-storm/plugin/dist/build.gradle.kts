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

// Disposable world fixtures for the full-module real-Paper suite. This jar is
// separate from TheStorm.jar and is never copied into the production image.
val e2e = sourceSets.create("e2e") {
  compileClasspath += configurations.compileClasspath.get() + sourceSets.main.get().output
  runtimeClasspath += output + compileClasspath
}
configurations[e2e.compileOnlyConfigurationName].extendsFrom(configurations.compileOnly.get())
val fixturesJar = tasks.register<Jar>("fixturesJar") {
  archiveFileName = "TheStormFixtures.jar"
  from(e2e.output)
  dependsOn(e2e.classesTaskName)
}
tasks.assemble { dependsOn(fixturesJar) }

val archiveTest = tasks.register<Exec>("archiveTest") {
  workingDir(rootProject.file("../server"))
  commandLine("mise", "exec", "--", "python3", "-m", "unittest", "-v", "test_archive_progression.py")
}
val worldRestoreTest = tasks.register<Exec>("worldRestoreTest") {
  workingDir(rootProject.file("../server"))
  commandLine("mise", "exec", "--", "python3", "-m", "unittest", "-v", "test_world_restore.py", "test_database_restore.py", "test_restoration_control.py", "test_restoration_json.py", "test_restoration_files.py", "test_restoration_activation.py", "test_restoration_install.py")
}
tasks.test {
  dependsOn(archiveTest, worldRestoreTest)
  // ModulesTest checks the shipped module inventory against the registry.
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/config.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}

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
    url("https://cdn.modrinth.com/data/1u6JkXh5/versions/F5ea2ov3/worldedit-bukkit-7.4.5.jar")
    url("https://cdn.modrinth.com/data/Lu3KuzdV/versions/3sehX6Sg/CoreProtect-CE-24.1.jar")
  }
}

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  testImplementation(libs.findLibrary("archunit").get())
  compileOnly(libs.findLibrary("coreprotect").get()) { isTransitive = false }
}
