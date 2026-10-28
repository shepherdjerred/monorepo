plugins { id("storm.module-conventions") }

// SkylandsConfigTest parses the generation identity shared with the image guard.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/skylands.json"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
