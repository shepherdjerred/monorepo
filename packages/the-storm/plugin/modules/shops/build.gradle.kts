plugins { id("storm.jooq-conventions") }

dependencies {
  // Wallets, Crystals, AccountId and CrystalFormatter: every trade moves crystals.
  implementation(project(":economy"))
  // Track.SHOPKEEPER gates chest-shop creation and sets the shop limit.
  implementation(project(":tracks"))
}
