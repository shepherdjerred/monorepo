plugins { id("storm.jooq-conventions") }

// Real Citizens admission proof; retained for committer-run acceptance outside CI.
val e2e = sourceSets.create("e2e") {
  compileClasspath += sourceSets.main.get().output + configurations.compileClasspath.get()
  runtimeClasspath += output + compileClasspath
}
configurations[e2e.implementationConfigurationName].extendsFrom(configurations.implementation.get())
configurations[e2e.compileOnlyConfigurationName].extendsFrom(configurations.compileOnly.get())
val e2eJar = tasks.register<Jar>("e2eJar") {
  archiveFileName = "TheStormNpcAdmissionE2E.jar"
  from(e2e.output)
  dependsOn(e2e.classesTaskName)
}
tasks.assemble { dependsOn(e2eJar) }

dependencies {
  implementation(project(":mobs"))
  testImplementation(libs.mockito)
  compileOnly(libs.citizens) { isTransitive = false }
  testImplementation(libs.citizens) { isTransitive = false }
  // Trainer NPCs sell track levels through the tracks' TrackPurchases and TrackLevels ports.
  implementation(project(":tracks"))
  // Trainer prices are shown with the economy's CrystalFormatter.
  implementation(project(":economy"))
}
