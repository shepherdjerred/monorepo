plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  implementation(project(":economy"))
  implementation(project(":towns"))
  implementation(libs.findLibrary("jda").get()) {
    // Voice is not used; opus natives are large.
    exclude(module = "opus-java")
    exclude(module = "tink")
  }
}
