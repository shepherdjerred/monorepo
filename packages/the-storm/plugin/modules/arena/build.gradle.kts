plugins { id("storm.jooq-conventions") }

// Wave rewards are paid in crystals through the economy module's Wallets port.
dependencies { implementation(project(":economy")) }

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
