pluginManagement {
  repositories {
    maven("https://maven.fabricmc.net/")
    gradlePluginPortal()
  }
  includeBuild("../plugin/build-logic")
}

dependencyResolutionManagement {
  versionCatalogs { create("libs") { from(files("../plugin/gradle/libs.versions.toml")) } }
}

rootProject.name = "the-storm-client"
