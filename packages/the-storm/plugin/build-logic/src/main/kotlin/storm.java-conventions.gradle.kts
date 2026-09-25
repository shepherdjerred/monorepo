// Strict Java baseline for every project: Java 25, all javac lints as errors,
// Error Prone + NullAway (JSpecify mode) + Picnic checks as errors,
// google-java-format, a curated PMD ruleset, JaCoCo, and no skipped tests.
import net.ltgt.gradle.errorprone.errorprone

plugins {
  `java-library`
  jacoco
  pmd
  id("net.ltgt.errorprone")
  id("com.diffplug.spotless")
}

val libs = the<VersionCatalogsExtension>().named("libs")

fun lib(alias: String) = libs.findLibrary(alias).get()

fun version(alias: String): String = libs.findVersion(alias).get().requiredVersion

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }

dependencyLocking { lockAllConfigurations() }

dependencies {
  compileOnly(lib("jspecify"))
  testCompileOnly(lib("jspecify"))
  errorprone(lib("errorprone-core"))
  errorprone(lib("nullaway"))
  errorprone(lib("errorprone-support-contrib"))

  testImplementation(platform(lib("junit-bom")))
  testImplementation(lib("junit-jupiter"))
  testImplementation(lib("assertj"))
  testRuntimeOnly(lib("junit-platform-launcher"))
}

tasks.withType<JavaCompile>().configureEach {
  options.release = 25
  options.encoding = "UTF-8"
  options.compilerArgs.addAll(listOf("-Xlint:all", "-Xlint:-processing", "-Werror", "-parameters"))
  options.errorprone {
    disableWarningsInGeneratedCode = true
    excludedPaths = ".*/build/generated/.*"
    error("NullAway")
    option("NullAway:OnlyNullMarked", "true")
    option("NullAway:JSpecifyMode", "true")
    option("NullAway:CheckOptionalEmptiness", "true")
    option("NullAway:AssertsEnabled", "true")
  }
}

spotless {
  java {
    target("src/**/*.java")
    googleJavaFormat(version("google-java-format"))
    formatAnnotations()
    removeUnusedImports()
  }
}

pmd {
  toolVersion = version("pmd")
  isConsoleOutput = true
  ruleSets = emptyList()
  ruleSetFiles = rootProject.files("config/pmd/ruleset.xml")
}

jacoco { toolVersion = version("jacoco") }

tasks.withType<Pmd>().configureEach {
  // Generated jOOQ sources are not ours to lint.
  exclude("**/generated/**")
}

val noSkippedTests =
    tasks.register<NoSkippedTests>("noSkippedTests") {
      reports.from(
          layout.buildDirectory.dir("test-results/test").map { dir ->
            dir.asFileTree.matching { include("TEST-*.xml") }
          })
    }

tasks.test {
  useJUnitPlatform()
  // sqlite-jdbc loads a native library; JDK 25 warns unless native access is granted.
  jvmArgs("--enable-native-access=ALL-UNNAMED")
  maxHeapSize = "512m"
  maxParallelForks = 1
  finalizedBy(noSkippedTests)
}

tasks.jacocoTestReport {
  dependsOn(tasks.test)
  reports {
    xml.required = true
    html.required = false
  }
}

tasks.check { dependsOn(noSkippedTests, tasks.jacocoTestReport) }

tasks.withType<AbstractArchiveTask>().configureEach {
  // Byte-identical jars for identical sources, so an unchanged plugin never
  // produces a new image digest.
  isPreserveFileTimestamps = false
  isReproducibleFileOrder = true
}

// `gradle resolveAndLockAll --write-locks` refreshes every gradle.lockfile.
tasks.register("resolveAndLockAll") {
  notCompatibleWithConfigurationCache("resolves every configuration to write lock state")
  doFirst {
    require(gradle.startParameter.isWriteDependencyLocks) { "run with --write-locks" }
  }
  doLast { configurations.filter { it.isCanBeResolved }.forEach { it.resolve() } }
}
