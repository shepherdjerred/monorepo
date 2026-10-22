plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

// Catalog tests read these shipped files directly, outside the test classpath.
tasks.test {
  for (name in listOf("towns.yml", "heritage.yml", "parcels.yml")) {
    inputs.file(rootProject.file("../server/owned/plugins/TheStorm/$name"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
  }
}

dependencies {
  // Town treasuries are economy accounts, paid through the Wallets port.
  implementation(project(":economy"))
  // Founding needs Governor I, and the owner's Governor level sets the claim limit.
  implementation(project(":tracks"))
  implementation(project(":mail"))
  implementation(project(":shops"))
  // BlueMap is on the server; towns draw their claims on the web map.
  compileOnly(libs.findLibrary("bluemap-api").get())
  compileOnly(libs.findLibrary("worldedit-bukkit").get())
  testImplementation(libs.findLibrary("worldedit-bukkit").get())
}
