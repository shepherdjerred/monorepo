plugins { id("storm.module-conventions") }

dependencies {
  // Citizens is a runtime plugin (server/plugins.json); only rwfbots.adapter.citizens
  // may use it here (architecture tests). Non-transitive: the plugin jar is the API.
  compileOnly(libs.citizens) { isTransitive = false }
  testCompileOnly(libs.citizens) { isTransitive = false }
}
