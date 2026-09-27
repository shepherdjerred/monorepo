plugins { id("storm.module-conventions") }

tasks.test {
  inputs
      .file(layout.projectDirectory.file("../../../server/owned/plugins/TheStorm/seasonal.yml"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedSeasonalContent")
}
