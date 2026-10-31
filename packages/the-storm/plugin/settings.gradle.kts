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
    // WorldEdit (gameplay + the MCBridge agent bridge). Exclusive, so these
    // groups resolve from enginehub only: Maven Central mirrors some of them
    // with different POM bytes, which breaks dependency verification.
    exclusiveContent {
      forRepository { maven("https://maven.enginehub.org/repo/") }
      filter {
        includeGroupByRegex("com\\.sk89q.*")
        includeGroupByRegex("org\\.enginehub.*")
      }
    }
    ivy("https://ci.citizensnpcs.co/job/Citizens2/${citizensPin.groupValues[2]}/artifact/dist/target") {
      patternLayout { artifact("Citizens-[revision].jar") }
      metadataSources { artifact() }
      content { includeModule("net.citizensnpcs", "citizens-main") }
    }
    maven("https://maven.playpro.com") { content { includeGroup("net.coreprotect") } }
    // Compile against the exact API shipped by the immutable runtime artifact.
    ivy("https://cdn.modrinth.com/data/LJNGWSvH/versions/clrLeCYp") {
      patternLayout { artifact("[artifact]-[revision].[ext]") }
      metadataSources { artifact() }
      content { includeModule("ac.grim.artifact", "grimac-bukkit") }
    }
  }
}

rootProject.name = "the-storm"

// CI's Gradle user home lasts one workflow, so its local build cache always starts
// empty. CI's verify step names the homelab build cache node (gradle-build-cache) and
// one of two users: default-branch builds hold the write password and store task
// outputs; pull requests hold the read-only password and only load them. The node
// enforces those levels. Without GRADLE_BUILD_CACHE_URL, builds use the local cache.
val remoteBuildCacheUrl = providers.environmentVariable("GRADLE_BUILD_CACHE_URL").orNull

if (remoteBuildCacheUrl != null) {
  val username =
      providers.environmentVariable("GRADLE_BUILD_CACHE_USERNAME").orNull
          ?: error("GRADLE_BUILD_CACHE_URL requires GRADLE_BUILD_CACHE_USERNAME")
  val writePassword = providers.environmentVariable("GRADLE_BUILD_CACHE_WRITE_PASSWORD").orNull
  val readPassword = providers.environmentVariable("GRADLE_BUILD_CACHE_READ_PASSWORD").orNull
  check((writePassword == null) != (readPassword == null)) {
    "GRADLE_BUILD_CACHE_URL requires exactly one of GRADLE_BUILD_CACHE_WRITE_PASSWORD " +
        "or GRADLE_BUILD_CACHE_READ_PASSWORD"
  }
  buildCache {
    remote<HttpBuildCache> {
      url = uri(remoteBuildCacheUrl)
      isAllowInsecureProtocol = false
      isPush = writePassword != null
      credentials {
        this.username = username
        password = writePassword ?: readPassword
      }
    }
  }
}

// Every gameplay module is registered here up front (Phase 0 scaffolding), so
// parallel work never has to touch this file.
val modules =
    listOf(
        "economy",
        "safety",
        "shops",
        "chat",
        "discord",
        "essentials",
        "messages",
        "mail",
        "shards",
        "tracks",
        "towns",
        "creative",
        "npcs",
        "companions",
        "quests",
        "reset",
        "spells",
        "mechanics",
        "arena",
        "mobs",
        "qol",
        "skills",
        "seasonal",
        "skylands",
        "world",
        "tickets",
        "agent",
        "rwf",
        "rwfbots",
        "advancements",
    )

include("core", "architecture", "dist")

// MCBridge: the agent bridge plugin (its own MCBridge.jar, never part of TheStorm.jar).
include("bridge")

modules.forEach { name ->
  include(name)
  project(":$name").projectDir = file("modules/$name")
}

// Offline tooling under tools/: not a gameplay module, so dist never shades it
// and the architecture project (which analyses dist and modules/*) never sees it.
include("rwfmap")
project(":rwfmap").projectDir = file("tools/rwfmap")
