# JVM build and test

Read this when configuring Gradle, Maven, JUnit, Kotlin compilation, build caching, integration tests, or dependency versions.

## Wrappers and toolchains

Use `./gradlew` and `./mvnw`. Gradle 9.6.1 runs on JVM 17–26 and can provision compilation/test toolchains. Kotlin validates toolchain and JVM-target alignment.

Kotlin DSL became the default generated DSL for `gradle init` in Gradle 8.2, not 8.0.

## Gradle task correctness

Cacheable tasks need complete declared inputs and outputs:

```kotlin
val generateVersion by tasks.registering {
    val versionText = providers.provider { project.version.toString() }
    inputs.property("version", versionText)
    val output = layout.buildDirectory.file("generated/version.txt")
    outputs.file(output)
    doLast {
        val target = output.get().asFile.toPath()
        java.nio.file.Files.createDirectories(target.parent)
        java.nio.file.Files.writeString(target, versionText.get())
    }
}
```

A typed cacheable task is preferable for reusable production logic.

## Maven compilation

Prefer `maven.compiler.release`. If a project has Kotlin sources, configure `kotlin-maven-plugin` compile/test-compile executions and order Java compilation correctly. A version property and stdlib dependency do not compile Kotlin.

## JUnit 6

JUnit 6.1.2 requires Java 17 and is a major upgrade. Use the Jupiter/Platform BOM or build-tool support, exact assertions, parameterized tests/classes, and opt-in parallel execution only with isolated state.

Gradle:

```kotlin
tasks.test {
    useJUnitPlatform()
}
```

## Maven test lifecycle

Surefire normally runs unit tests in `test`. Failsafe runs integration tests only when bound to both `integration-test` and `verify`. Do not claim `mvn verify` runs integration tests without that binding.

Do not normalize skip flags. An artifact assembled without tests is not verified.

## Versions

Avoid embedding current library/plugin versions in evergreen patterns. Use a version catalog, BOM, or clearly dated snapshot. Major lines such as Spring Boot 4 and JUnit 6 need migration review.

## Primary documentation

- [Kotlin Gradle project configuration](https://kotlinlang.org/docs/gradle-configure-project.html)
- [Kotlin JUnit tests](https://kotlinlang.org/docs/jvm-test-using-junit.html)
- [kotlinx.coroutines API](https://kotlinlang.org/api/kotlinx.coroutines/)
- [kotlinx.coroutines releases](https://github.com/Kotlin/kotlinx.coroutines/releases/latest)
- [Gradle release notes](https://docs.gradle.org/current/release-notes.html)
- [Gradle compatibility](https://docs.gradle.org/current/userguide/compatibility.html)
- [Gradle wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html)
- [Gradle toolchains](https://docs.gradle.org/current/userguide/toolchains.html)
- [Gradle Kotlin DSL](https://docs.gradle.org/current/userguide/kotlin_dsl.html)
- [Gradle 8.2](https://docs.gradle.org/8.2/release-notes.html)
- [Java testing](https://docs.gradle.org/current/userguide/java_testing.html)
- [JVM test suites](https://docs.gradle.org/current/userguide/jvm_test_suite_plugin.html)
- [Build cache](https://docs.gradle.org/current/userguide/build_cache.html)
- [Gradle performance](https://docs.gradle.org/current/userguide/performance.html)
- [Gradle 9 upgrade](https://docs.gradle.org/current/userguide/upgrading_version_9.html)
- [Maven downloads](https://maven.apache.org/download.cgi)
- [Maven lifecycle](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html)
- [Maven Wrapper](https://maven.apache.org/wrapper/)
- [Compiler release](https://maven.apache.org/plugins/maven-compiler-plugin/examples/set-compiler-release.html)
- [Surefire skip behavior](https://maven.apache.org/surefire/maven-surefire-plugin/examples/skipping-tests.html)
- [Failsafe usage](https://maven.apache.org/surefire/maven-failsafe-plugin/usage.html)
- [JUnit Platform with Surefire](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html)
- [JUnit user guide](https://docs.junit.org/current/user-guide/)
- [JUnit assertions](https://docs.junit.org/6.1.2/writing-tests/assertions.html)
- [JUnit parallel execution](https://docs.junit.org/6.1.2/writing-tests/parallel-execution.html)
- [Parameterized tests](https://docs.junit.org/6.1.2/writing-tests/parameterized-classes-and-tests.html)
- [JUnit build support](https://docs.junit.org/6.1.2/running-tests/build-support.html)
