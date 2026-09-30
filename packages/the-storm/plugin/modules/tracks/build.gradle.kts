plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  // Purchases are paid through the economy's Wallets port.
  implementation(project(":economy"))
  // LuckPerms is on the server; tracks grant levels as LuckPerms groups.
  compileOnly(libs.findLibrary("luckperms-api").get())
}
