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
