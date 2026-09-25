plugins { id("storm.jooq-conventions") }

// Spells are gated by the Spellcaster track's level permissions.
dependencies { implementation(project(":tracks")) }

// SpellsConfigTest parses the spells.yml the server ships.
val shippedConfig = file("../../../server/owned/plugins/TheStorm/spells.yml")

tasks.test {
  inputs.file(shippedConfig).withPropertyName("shippedConfig")
  systemProperty("thestorm.spells.config", shippedConfig.absolutePath)
}
