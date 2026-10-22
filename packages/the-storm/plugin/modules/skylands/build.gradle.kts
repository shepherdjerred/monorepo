plugins { id("storm.module-conventions") }

// SkylandsConfigTest parses the skylands.yml the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/skylands.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
