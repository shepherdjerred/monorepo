plugins { id("storm.jooq-conventions") }

// Match rewards are paid in crystals through the economy module's Wallets port.
dependencies { implementation(project(":economy")) }

// The Java Flipt identifiers must agree with the shared managed flag inventory.
val verifyManagedRwfFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedRwfFlag") {
      inventory =
          layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
      source =
          layout.projectDirectory.file(
              "src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptRwfGate.java")
      flagSource = "the-storm-rwf"
    }

tasks.named("compileJava") { dependsOn(verifyManagedRwfFlag) }

// The content tests parse the rwf config, kits and maps the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/rwf.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(rootProject.file("../server/owned/plugins/TheStorm/rwf"))
      .withPropertyName("shippedContent")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
