plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  // Quest givers, turn-ins and markers go through the NPCs' app ports.
  implementation(project(":npcs"))
  // Crystal rewards are paid through the economy's Wallets port.
  implementation(project(":economy"))
  // Level objectives and track conditions read the tracks' TrackLevels port.
  implementation(project(":tracks"))
  // LuckPerms is on the server; permission, title and spell rewards are LuckPerms nodes.
  compileOnly(libs.findLibrary("luckperms-api").get())
}

// The shipped-content tests read the repository-owned server files; declaring them as inputs
// makes a content change rerun the tests instead of reusing a cached result.
tasks.test {
  inputs
      .dir(layout.projectDirectory.dir("../../../server/owned/plugins/TheStorm"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedContent")
}
