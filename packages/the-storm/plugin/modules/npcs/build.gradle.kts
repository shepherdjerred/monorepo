plugins { id("storm.jooq-conventions") }

dependencies {
  testImplementation(libs.mockito)
  compileOnly(libs.citizens) { isTransitive = false }
  testImplementation(libs.citizens) { isTransitive = false }
  // Trainer NPCs sell track levels through the tracks' TrackPurchases and TrackLevels ports.
  implementation(project(":tracks"))
  // Trainer prices are shown with the economy's CrystalFormatter.
  implementation(project(":economy"))
}
