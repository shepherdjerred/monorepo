// Conversion-only plugin. Never shaded into TheStorm or installed in a gameplay image.
plugins { id("storm.java-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")
dependencies {
  compileOnly(libs.findLibrary("paper-api").get())
  testImplementation(libs.findLibrary("paper-api").get())
}
tasks.jar { archiveFileName = "StormConversionGuard.jar" }
