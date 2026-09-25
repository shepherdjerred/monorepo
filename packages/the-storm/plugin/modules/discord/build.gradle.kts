plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  implementation(libs.findLibrary("jda").get()) {
    // Voice is not used; opus natives are large.
    exclude(module = "opus-java")
    exclude(module = "tink")
  }
}
