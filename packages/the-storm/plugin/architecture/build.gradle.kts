// Architecture rules over every project, enforced with ArchUnit.
plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  testImplementation(project(":dist"))
  rootProject.childProjects.values
      .filter { it.projectDir.parentFile.name == "modules" }
      .forEach { testImplementation(project(it.path)) }
  testImplementation(libs.findLibrary("archunit").get())
  // npcs, companions and rwfbots compile against Citizens (compileOnly, so not on
  // their runtime classpath); ArchUnit needs the classes to resolve the Citizens rules.
  testRuntimeOnly(libs.findLibrary("citizens").get()) { isTransitive = false }
}
