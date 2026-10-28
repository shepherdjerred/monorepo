plugins { id("storm.jooq-conventions") }

val verifyManagedStargatesFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedStargatesFlag") {
      inventory = layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
      source = layout.projectDirectory.file("src/main/java/com/shepherdjerred/thestorm/mechanics/adapter/remote/FliptStargatesGate.java")
      flagSource = "the-storm-stargates"
    }

tasks.named("compileJava") { dependsOn(verifyManagedStargatesFlag) }

// Mechanisms are gated by the Mechanic track's level permissions (tracks.app.Track).
dependencies {
  implementation(project(":tracks"))
  implementation(project(":towns"))
  implementation(project(":essentials"))
  implementation(project(":creative"))
}

// A second, test-only Paper plugin lets the real-server E2E harness install
// mechanics with a minimal Protection provider. It is never included in
// TheStorm.jar or a production server image.
val e2e = sourceSets.create("e2e") {
  compileClasspath += sourceSets.main.get().output + configurations.compileClasspath.get()
  runtimeClasspath += output + compileClasspath
}

configurations[e2e.implementationConfigurationName].extendsFrom(configurations.implementation.get())
configurations[e2e.compileOnlyConfigurationName].extendsFrom(configurations.compileOnly.get())

val e2eJar = tasks.register<Jar>("e2eJar") {
  archiveFileName = "TheStormMechanicsE2E.jar"
  from(e2e.output)
  dependsOn(e2e.classesTaskName)
}

tasks.assemble { dependsOn(e2eJar) }
