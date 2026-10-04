plugins {
  alias(libs.plugins.fabric.loom)
  id("storm.java-conventions")
}

version = "1.0.0"
group = "com.shepherdjerred.thestorm"

dependencies {
  minecraft(libs.client.minecraft)
  implementation(libs.fabric.loader)
  implementation(libs.fabric.api)
  implementation(libs.jackson.databind)
  include(libs.jackson.databind)
  include(libs.jackson.core)
  include(libs.jackson.annotations)
  compileOnly(libs.errorprone.annotations)
  testCompileOnly(libs.errorprone.annotations)
}

pmd { ruleSetFiles = files("../plugin/config/pmd/ruleset.xml") }

loom {
  runs {
    named("client") {
      val gameDir = providers.gradleProperty("previewGameDir")
      if (gameDir.isPresent) runDirectory.set(file(gameDir.get()))
      else runDirectory.set(layout.buildDirectory.dir("preview"))
      if (System.getProperty("os.name").startsWith("Mac")) jvmArguments.add("-XstartOnFirstThread")
      val session = providers.gradleProperty("previewSession")
      if (session.isPresent) systemProperties.put("storm.client.session", session.get())
      programArguments.addAll("--username", "StormPreview", "--width", "1280", "--height", "720")
    }
  }
}

fabricApi {
  configureTests {
    createSourceSet = true
    modId = "storm-client-tests"
    enableGameTests = false
    enableClientGameTests = true
    eula = true
  }
}

tasks.processResources {
  inputs.property("version", project.version)
  filesMatching("fabric.mod.json") { expand("version" to project.version) }
}
