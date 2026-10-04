pluginManagement { includeBuild("build-logic") }

dependencyResolutionManagement {
  repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
  repositories {
    mavenCentral()
    // Paper API and its Mojang/md_5 dependencies.
    maven("https://repo.papermc.io/repository/maven-public/")
    // BlueMap API (town claim markers).
    maven("https://repo.bluecolored.de/releases") {
      content { includeGroup("de.bluecolored") }
    }
    // WorldEdit API for the MCBridge agent bridge (bridge/).
    maven("https://maven.enginehub.org/repo/") {
      content {
        includeGroupByRegex("com\\.sk89q\\.worldedit.*")
        includeGroupByRegex("org\\.enginehub.*")
        includeGroup("com.sk89q")
        includeGroup("com.sk89q.lib")
      }
    }
  }
}

rootProject.name = "the-storm"

// Every gameplay module is registered here up front (Phase 0 scaffolding), so
// parallel work never has to touch this file.
val modules =
    listOf(
        "economy",
        "shops",
        "chat",
        "discord",
        "essentials",
        "messages",
        "shards",
        "tracks",
        "towns",
        "npcs",
        "quests",
        "spells",
        "mechanics",
        "arena",
        "mobs",
        "qol",
        "skills",
        "seasonal",
        "world",
        "tickets",
        "agent",
    )

include("core", "architecture", "dist")

// MCBridge: the agent bridge plugin (its own MCBridge.jar, never part of TheStorm.jar).
include("bridge")

modules.forEach { name ->
  include(name)
  project(":$name").projectDir = file("modules/$name")
}
