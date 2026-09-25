plugins { id("storm.module-conventions") }

// The shipped shards.yml is parsed by a test, so it is a test input.
val shippedConfig = file("../../../server/owned/plugins/TheStorm/shards.yml")

tasks.test {
  inputs.file(shippedConfig).withPropertyName("shippedConfig")
  systemProperty("thestorm.shards.config", shippedConfig.absolutePath)
}
