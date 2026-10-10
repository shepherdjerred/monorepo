plugins { id("storm.module-conventions") }

tasks.processResources {
  from(rootProject.file("../public-status.json"))
}
