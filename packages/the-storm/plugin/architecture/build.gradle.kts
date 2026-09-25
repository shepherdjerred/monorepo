// Architecture rules over every project, enforced with ArchUnit.
plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  testImplementation(project(":dist"))
  rootProject.childProjects.values
      .filter { it.projectDir.parentFile.name == "modules" }
      .forEach { testImplementation(project(it.path)) }
  testImplementation(libs.findLibrary("archunit").get())
}
