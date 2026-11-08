plugins { id("storm.jooq-conventions") }

dependencies {
  implementation(project(":qol"))
  compileOnly(libs.bluemap.api)
  compileOnly(libs.grim) { isTransitive = false }
  testImplementation(libs.grim) { isTransitive = false }
}

tasks.test {
  inputs.file(rootProject.file("../server/owned/plugins/TheStorm/skytravel.json"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
