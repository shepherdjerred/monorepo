plugins { id("storm.jooq-conventions") }

// Combat tags refuse teleports through essentials' TeleportGuards port, and the
// sleep vote leaves AFK players out through its AfkStatus port.
dependencies { implementation(project(":essentials")) }

// QolConfigTest parses the qol.yml the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/qol.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
