plugins { id("storm.module-conventions") }

dependencies {
  // Trainer NPCs sell track levels through the tracks' TrackPurchases and TrackLevels ports.
  implementation(project(":tracks"))
  // Trainer prices are shown with the economy's CrystalFormatter.
  implementation(project(":economy"))
}
