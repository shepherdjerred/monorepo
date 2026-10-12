plugins { id("storm.module-conventions") }

// Running events are named in the wake post through the discord module's relay port.
dependencies { implementation(project(":discord")) }

tasks.test {
  inputs
      .file(layout.projectDirectory.file("../../../server/owned/plugins/TheStorm/seasonal.yml"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedSeasonalContent")
}
