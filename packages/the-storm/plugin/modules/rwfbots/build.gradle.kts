plugins { id("storm.module-conventions") }

dependencies {
  // Citizens is a runtime plugin (server/plugins.json); only rwfbots.adapter.citizens
  // may use it here (architecture tests). Non-transitive: the plugin jar is the API.
  compileOnly(libs.citizens) { isTransitive = false }
  testCompileOnly(libs.citizens) { isTransitive = false }
}

// The shipped personality files are parsed by a test, so they are a test input.
val shippedPersonalities = file("../../../server/owned/plugins/TheStorm/rwfbots/personalities")

tasks.test {
  inputs
      .dir(shippedPersonalities)
      .withPropertyName("shippedPersonalities")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwfbots.personalities", shippedPersonalities.absolutePath)
}
