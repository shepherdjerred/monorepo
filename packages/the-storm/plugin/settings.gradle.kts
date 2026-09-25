pluginManagement { includeBuild("build-logic") }

dependencyResolutionManagement {
  repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
  repositories {
    mavenCentral()
    // Paper API and its Mojang/md_5 dependencies.
    maven("https://repo.papermc.io/repository/maven-public/")
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
    )

include("core", "architecture", "dist")

modules.forEach { name ->
  include(name)
  project(":$name").projectDir = file("modules/$name")
}
