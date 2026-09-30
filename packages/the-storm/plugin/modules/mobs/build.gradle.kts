plugins { id("storm.module-conventions") }

// MobsConfigTest parses the mobs.yml the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/mobs.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
