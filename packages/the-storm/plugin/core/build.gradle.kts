plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

// Core exposes the shared runtime stack to every module.
dependencies {
  api(lib("jackson-databind"))
  api(lib("jackson-yaml"))
  api(lib("jooq"))
  implementation(lib("flyway-core"))
  implementation(lib("hikari"))
  runtimeOnly(lib("sqlite-jdbc"))
  testRuntimeOnly(lib("sqlite-jdbc"))
}
