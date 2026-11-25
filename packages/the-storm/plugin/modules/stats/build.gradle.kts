plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  implementation(project(":economy"))
  implementation(project(":towns"))
  implementation(project(":skills"))
  implementation(project(":tracks"))
  implementation(project(":quests"))
  implementation(project(":arena"))
  implementation(project(":rwf"))
  implementation(project(":essentials"))
  compileOnly(libs.findLibrary("luckperms-api").get())
  testImplementation(libs.findLibrary("luckperms-api").get())
  testImplementation(libs.findLibrary("mockito").get())
}

tasks.test {
  inputs
      .file(layout.projectDirectory.file("../../../server/owned/plugins/TheStorm/stats.yml"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedStatsConfig")
  inputs
      .file(layout.projectDirectory.file("../../../../storm-stats/contracts/ingest-v1.json"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ingestContract")
}
