import java.io.File
import net.fabricmc.loom.configuration.processors.JarProcessor
import net.fabricmc.loom.util.ZipReprocessorUtil
import org.gradle.api.tasks.bundling.ZipEntryCompression

class ReproducibleMinecraftJarProcessor : JarProcessor {
  override fun getId() = "storm:reproducible-minecraft-archive:v1:stored"
  override fun setup() = Unit
  override fun process(file: File) {
    ZipReprocessorUtil.reprocessZip(file.toPath(), true, false, ZipEntryCompression.STORED)
  }
}

plugins {
  alias(libs.plugins.fabric.loom)
  id("storm.java-conventions")
}

version = "1.0.0"
group = "com.shepherdjerred.thestorm"

// Loom obtains these exact library pins from Minecraft 26.2. Upgrade the
// affected pins in every Minecraft compile/runtime configuration, including
// native transports. Remove the rules once Minecraft publishes patched pins;
// later upstream versions remain untouched.
configurations.configureEach {
  resolutionStrategy.eachDependency {
    if (requested.group == "io.netty" && requested.version == "4.2.15.Final") {
      useVersion(libs.versions.security.netty.get())
      because("Patched Netty compression, HTTP, and handler advisories")
    }
    if (requested.group == "at.yawk.lz4" && requested.name == "lz4-java" &&
        requested.version == "1.10.1") {
      useVersion(libs.versions.security.lz4.get())
      because("CVE-2026-106451")
    }
  }
}

// Fabric includes this bridge only in macOS client libraries. Keep its lock on macOS,
// where it resolves, while ignoring that absent platform-specific entry elsewhere.
if (!System.getProperty("os.name").startsWith("Mac")) {
  dependencyLocking {
    ignoredDependencies.add("ca.weblite:java-objc-bridge")
  }
}

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
  addJarProcessor(ReproducibleMinecraftJarProcessor())
  runs {
    named("client") {
      val gameDir = providers.gradleProperty("previewGameDir")
      if (gameDir.isPresent) runDirectory.set(file(gameDir.get()))
      else runDirectory.set(layout.buildDirectory.dir("preview"))
      if (System.getProperty("os.name").startsWith("Mac")) jvmArguments.add("-XstartOnFirstThread")
      val session = providers.gradleProperty("previewSession")
      if (session.isPresent) systemProperties.put("storm.client.session", session.get())
      // The mc-harness daemon names each client (`toolkit mc client start --name`).
      val username = providers.gradleProperty("previewUsername").getOrElse("StormPreview")
      programArguments.addAll("--username", username, "--width", "1280", "--height", "720")
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
