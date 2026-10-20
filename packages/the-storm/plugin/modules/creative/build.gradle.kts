plugins { id("storm.jooq-conventions") }

dependencies {
  compileOnly(libs.coreprotect) { isTransitive = false }
  compileOnly(libs.worldedit.bukkit)
  testImplementation(libs.worldedit.bukkit)
  compileOnly(libs.bluemap.api)
  compileOnly(libs.grim) { isTransitive = false }
  implementation(project(":arena"))
}

tasks.test {
  inputs
      .file(layout.projectDirectory.file("../../../server/owned/plugins/TheStorm/creative.yml"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedCreativeConfig")
  inputs
      .file(layout.projectDirectory.file("../../../server/patches/coreprotect.json"))
      .withPathSensitivity(PathSensitivity.RELATIVE)
      .withPropertyName("ownedCoreProtectPatch")
}
