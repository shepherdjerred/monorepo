plugins { id("storm.jooq-conventions") }

// Wave rewards are paid in crystals through the economy module's Wallets port.
dependencies {
  implementation(project(":economy"))
  implementation(project(":towns"))
  // Lobbies, boss waves and runs are announced through the discord module's relay port.
  implementation(project(":discord"))
  testImplementation(libs.mockito)
}

// The content tests parse the arena config and content the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/arena.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(rootProject.file("../server/owned/plugins/TheStorm/arena"))
      .withPropertyName("shippedContent")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
