pluginManagement { includeBuild("build-logic") }

// Citizens publishes mutable Maven snapshots. Use the same immutable, checksum-verified
// Jenkins artifact as the server; Maven timestamp normalization breaks Gradle locking.
val citizensPin = Regex("(?m)^citizens = \"([^\"]+-b(\\d+))\"$")
    .find(file("gradle/libs.versions.toml").readText())
    ?: error("Citizens must be pinned to a Jenkins build in libs.versions.toml")

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
    ivy("https://ci.citizensnpcs.co/job/Citizens2/${citizensPin.groupValues[2]}/artifact/dist/target") {
      patternLayout { artifact("Citizens-[revision].jar") }
      metadataSources { artifact() }
      content { includeModule("net.citizensnpcs", "citizens-main") }
    }
    maven("https://maven.playpro.com") { content { includeGroup("net.coreprotect") } }
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
        "companions",
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
        "rwf",
        "rwfbots",
    )

include("core", "architecture", "dist")

modules.forEach { name ->
  include(name)
  project(":$name").projectDir = file("modules/$name")
}

// Offline tooling under tools/: not a gameplay module, so dist never shades it
// and the architecture project (which analyses dist and modules/*) never sees it.
include("rwfmap")

project(":rwfmap").projectDir = file("tools/rwfmap")
