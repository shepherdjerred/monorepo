plugins { id("storm.jooq-conventions") }

dependencies {
  // Match rewards and kit purchases move Red Warfare credits through the economy module's Wallets
  // port.
  implementation(project(":economy"))
  // Lobbies and results are announced through the discord module's relay port.
  implementation(project(":discord"))
  // Team and dead chat go through the chat module's membership, routing and taps.
  implementation(project(":chat"))
}

// The Java Flipt identifiers must agree with the shared managed flag inventory.
val flagInventory =
    layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
val remote = "src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote"

val verifyManagedRwfFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedRwfFlag") {
      inventory = flagInventory
      source = layout.projectDirectory.file("$remote/FliptRwfGate.java")
      flagSource = "the-storm-rwf"
    }

val verifyManagedRwfKitsFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedRwfKitsFlag") {
      inventory = flagInventory
      source = layout.projectDirectory.file("$remote/FliptRwfKitsGate.java")
      flagSource = "the-storm-rwf-kits"
    }

val verifyManagedRwfKillstreaksFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedRwfKillstreaksFlag") {
      inventory = flagInventory
      source = layout.projectDirectory.file("$remote/FliptRwfKillstreaksGate.java")
      flagSource = "the-storm-rwf-killstreaks"
    }

tasks.named("compileJava") {
  dependsOn(verifyManagedRwfFlag, verifyManagedRwfKitsFlag, verifyManagedRwfKillstreaksFlag)
}

// Each Red Warfare feature flag the match reads, by inventory source and Java constant.
mapOf(
        "the-storm-rwf-match-flow" to "MATCH_FLOW_FLAG_KEY",
        "the-storm-rwf-carry-over" to "CARRY_OVER_FLAG_KEY",
        "the-storm-rwf-death-feed" to "DEATH_FEED_FLAG_KEY",
        "the-storm-rwf-team-chat" to "TEAM_CHAT_FLAG_KEY",
        "the-storm-rwf-spectator-tools" to "SPECTATOR_TOOLS_FLAG_KEY",
        "the-storm-rwf-bomb-effects" to "BOMB_EFFECTS_FLAG_KEY",
        "the-storm-rwf-stats" to "STATS_FLAG_KEY")
    .forEach { (flagSourceId, constantName) ->
      val task =
          tasks.register<VerifyManagedFlag>(
              "verifyManagedFlag-" + flagSourceId.removePrefix("the-storm-rwf-")) {
            inventory =
                layout.projectDirectory.file(
                    "../../../../feature-flags/src/managed-flag-inventory.json")
            source =
                layout.projectDirectory.file(
                    "src/main/java/com/shepherdjerred/thestorm/rwf/adapter/remote/FliptRwfFeatures.java")
            flagSource = flagSourceId
            flagConstant = constantName
          }
      tasks.named("compileJava") { dependsOn(task) }
    }

// The content tests parse the rwf config, kits and maps the server ships.
tasks.test {
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/rwf.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/rwf-archive.json"))
      .withPropertyName("archiveContract")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(rootProject.file("../server/owned/plugins/TheStorm/rwf"))
      .withPropertyName("shippedContent")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
