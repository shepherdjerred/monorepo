plugins { id("storm.jooq-conventions") }

dependencies {
  // Bots fill rwf matches through its app ports (BotBodies, BotActions, MatchView, MatchEvents).
  implementation(project(":rwf"))
  // Citizens is a runtime plugin (server/plugins.json); only rwfbots.adapter.citizens
  // may use it here (architecture tests). Non-transitive: the plugin jar is the API.
  compileOnly(libs.citizens) { isTransitive = false }
  testCompileOnly(libs.citizens) { isTransitive = false }
}

// The shipped personality files and rwfbots.yml are parsed by tests, so they are test inputs.
val shippedPersonalities = file("../../../server/owned/plugins/TheStorm/rwfbots/personalities")
val shippedConfig = file("../../../server/owned/plugins/TheStorm/rwfbots.yml")

tasks.test {
  inputs
      .dir(shippedPersonalities)
      .withPropertyName("shippedPersonalities")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .file(shippedConfig)
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwfbots.personalities", shippedPersonalities.absolutePath)
  systemProperty("thestorm.rwfbots.config", shippedConfig.absolutePath)
}
