plugins { id("storm.jooq-conventions") }

// Teleports are paid in crystals through the economy module's Wallets port.
dependencies { implementation(project(":economy")) }

// EssentialsConfigTest parses the essentials.yml the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/essentials.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
