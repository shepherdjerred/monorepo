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
    maven("https://maven.enginehub.org/repo/") {
      content { includeGroupByRegex("com\\.sk89q.*"); includeGroupByRegex("org\\.enginehub.*") }
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
        "mail",
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

modules.forEach { name ->
  include(name)
  project(":$name").projectDir = file("modules/$name")
}
