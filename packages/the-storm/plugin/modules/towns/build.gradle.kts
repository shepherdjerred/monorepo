plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

// TownsConfigTest reads this shipped file directly, outside the test classpath.
tasks.test {
  inputs.file(rootProject.file("../server/owned/plugins/TheStorm/towns.yml"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
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
