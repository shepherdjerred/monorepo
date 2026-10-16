plugins { id("storm.module-conventions") }
val libs = the<VersionCatalogsExtension>().named("libs")
dependencies { compileOnly(libs.findLibrary("grim").get()) { isTransitive = false } }

tasks.processResources {
  from(rootProject.file("../../storm-brain/contracts/content-moderation.json")) { into("contracts") }
  from(rootProject.file("../../mc-harness/src/protocol/evidence-contract.json")) { into("contracts") }
}
