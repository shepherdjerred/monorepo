plugins { id("storm.jooq-conventions") }

// Standalone Paper fixture for the inventory snapshot and persistent marker used by imports.
val e2e = sourceSets.create("e2e") {
  compileClasspath += sourceSets.main.get().output + configurations.compileClasspath.get()
  runtimeClasspath += output + compileClasspath
}
configurations[e2e.implementationConfigurationName].extendsFrom(configurations.implementation.get())
configurations[e2e.compileOnlyConfigurationName].extendsFrom(configurations.compileOnly.get())

val e2eJar = tasks.register<Jar>("e2eJar") {
  archiveFileName = "TheStormHistoricalStockE2E.jar"
  from(e2e.output)
  from(sourceSets.main.get().output) {
    include("com/shepherdjerred/thestorm/shops/adapter/paper/HistoricalStock*.class")
  }
  dependsOn(e2e.classesTaskName)
}
tasks.assemble { dependsOn(e2eJar) }

dependencies {
  // Wallets, Crystals, AccountId and CrystalFormatter: every trade moves crystals.
  implementation(project(":economy"))
  // Track.SHOPKEEPER gates chest-shop creation and sets the shop limit.
  implementation(project(":tracks"))
}
