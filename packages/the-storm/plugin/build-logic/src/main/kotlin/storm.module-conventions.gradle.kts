// A Paper-facing project: compiles against the Paper API (provided at runtime
// by the server) and tests with MockBukkit. Every module except core depends
// on core.
plugins { id("storm.java-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

dependencies {
  compileOnly(lib("paper-api"))
  testImplementation(lib("paper-api"))
  testImplementation(lib("mockbukkit"))
  if (project.path != ":core") {
    implementation(project(":core"))
  }
}
