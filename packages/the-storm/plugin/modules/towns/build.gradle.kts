plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

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
