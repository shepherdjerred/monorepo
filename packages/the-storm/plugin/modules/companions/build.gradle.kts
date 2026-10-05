plugins { id("storm.jooq-conventions") }

dependencies {
  implementation(project(":chat"))
  implementation(project(":essentials"))
  compileOnly(libs.citizens) { isTransitive = false }
  testImplementation(libs.citizens) { isTransitive = false }
  compileOnly(libs.coreprotect) { isTransitive = false }
  testImplementation(libs.coreprotect) { isTransitive = false }
}
// The shared brain contract lives outside the plugin build. A missing file
// would otherwise copy nothing and only fail when TheStorm enables.
val companionContract = rootProject.file("../../storm-brain/contracts/companion-chat.json")
tasks.processResources {
  val contract = companionContract
  inputs.file(contract)
  doFirst { check(contract.isFile) { "Missing shared companion contract: $contract" } }
  from(contract) { into("contracts") }
}

// Real Paper exercises Citizens bodies and native survival; never shipped in production.
val e2e = sourceSets.create("e2e") {
  compileClasspath += sourceSets.main.get().output + configurations.compileClasspath.get()
  runtimeClasspath += output + compileClasspath
}
configurations[e2e.implementationConfigurationName].extendsFrom(configurations.implementation.get())
configurations[e2e.compileOnlyConfigurationName].extendsFrom(configurations.compileOnly.get())
val e2eJar = tasks.register<Jar>("e2eJar") {
  archiveFileName = "TheStormCompanionsE2E.jar"
  from(e2e.output)
  dependsOn(e2e.classesTaskName)
}
tasks.assemble { dependsOn(e2eJar) }
