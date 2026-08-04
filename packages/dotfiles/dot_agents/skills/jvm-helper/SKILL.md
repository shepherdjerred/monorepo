---
name: jvm-helper
description: Current Java, Kotlin, Gradle, Maven, JUnit, JVM diagnostics, packaging, and performance guidance. Use when writing or reviewing Java or Kotlin, build files, JVM tests, concurrency, GraalVM Native Image, jlink/jpackage, or JVM tuning.
---

# JVM Helper

Use the project's wrappers and toolchains, distinguish stable APIs from previews, and measure runtime behavior before changing JVM flags. Current releases are not automatic migration targets for an existing project.

## Current baseline

Verified 2026-08-03:

| Component | Current | Boundary |
| --- | --- | --- |
| Java | JDK 26 GA | Java 25 is Oracle-designated LTS; lifecycle and support vary by vendor |
| Kotlin | 2.4.10 | Kotlin 2.4 adds Java 26 support and stable context parameters |
| Gradle | 9.6.1 | Runs on JVM 17–26; use the project wrapper |
| Maven | 3.9.16 stable | 3.10 and Maven 4 remain preview lines |
| JUnit | 6.1.2 | Requires Java 17; major migration from JUnit 5 |
| kotlinx.coroutines | 1.11.0 | Follow structured cancellation and dispatcher lifecycles |

Spring Boot 4.1.0, Ktor 3.5.1, and Shadow 9.6.1 are current, but their major upgrades are not drop-in substitutions for an existing build.

Read [references/releases.md](references/releases.md) for the 75-page research ledger. Read [references/java-and-kotlin.md](references/java-and-kotlin.md) for current language/concurrency APIs. Read [references/build-and-test.md](references/build-and-test.md) for wrappers, Gradle, Maven, JUnit, and build-cache correctness. Read [references/diagnostics-and-packaging.md](references/diagnostics-and-packaging.md) for jcmd/JFR/JMX, JVM tuning, jlink, jpackage, and Native Image.

## Establish the toolchain

```bash
java --version
javac --version
./gradlew --version
./mvnw --version
```

Prefer repository wrappers and declared Java toolchains. A globally installed current JDK does not change the project's source, target, runtime, or support contract.

## Command authority

Build and test commands create outputs and can resolve dependencies:

```bash
./gradlew build
./mvnw verify
```

Live-process diagnostics can pause, attach to, or materially affect the target. Inspect the command's documented impact and production authority before running `jcmd`, `jmap`, heap dumps, or JFR operations. `jmap` is experimental and unsupported; prefer supported `jcmd` operations where appropriate.

## Verification without skipped tests

Do not recommend `-x test`, `-DskipTests`, or `maven.test.skip` as a normal workflow. `assemble` only creates artifacts and does not satisfy verification.

For Maven, `verify` runs integration tests only when Failsafe or another plugin is bound to the `integration-test` and `verify` lifecycle phases. Check the POM before making the claim.

For Gradle, configure `useJUnitPlatform()` and the intended test suites. JUnit parallel execution is opt-in and must preserve test isolation.

## Java concurrency

Virtual threads are appropriate for large numbers of blocking tasks, not CPU-bound parallelism. Create them through application-owned executors and close executor lifecycles.

JDK 24 eliminated nearly all virtual-thread pinning caused by `synchronized`. Do not mechanically replace correct synchronization with `ReentrantLock`; use JFR or `jcmd` to diagnose remaining pinning cases.

Structured Concurrency remains preview. The API changed across previews. On JDK 25, use `StructuredTaskScope.open()` or `open(Joiner...)`, compile with `--enable-preview --release 25`, and run with `--enable-preview`. Verify the exact target JDK docs before copying an example.

Scoped Values finalized in JDK 25:

```java
ScopedValue.where(CURRENT_USER, user).run(() -> handle(request));
```

Do not use removed preview-era `runWhere` examples.

`HttpClient` makes no guarantee that its default executor uses virtual threads. If blocking `send` should run in a virtual thread, create that ownership explicitly.

## Kotlin coroutines

Preserve cooperative cancellation. A broad `catch (Exception)` can swallow `CancellationException`:

```kotlin
try {
    performWork()
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (failure: IOException) {
    handleFailure(failure)
}
```

`Dispatchers.IO` defaults to `max(64, availableProcessors)` parallelism and is configurable. `limitedParallelism` views can exceed that nominal bound. Treat these as implementation controls, not an application concurrency budget.

Close executor-backed dispatchers:

```kotlin
Executors.newFixedThreadPool(4).asCoroutineDispatcher().use { dispatcher ->
    withContext(dispatcher) { performWork() }
}
```

K2 has been the default compiler since Kotlin 2.0. Remove obsolete `-Pkotlin.experimental.tryK2=true` guidance. Kotlin guard conditions were preview in 2.1 and stable in 2.2.

## Nullability

Platform types cross an unchecked Java/Kotlin boundary. Use an identified annotation ecosystem and migration mode. Prefer JSpecify for new shared Java APIs where it fits; otherwise name the chosen JetBrains or Eclipse annotations rather than using unqualified `@Nullable` examples.

## Build correctness

Gradle cacheable tasks must declare every input and output. A generated version file needs the project version as an input; otherwise a version change can reuse stale output.

Use `maven.compiler.release` rather than redundant source/target/release settings. A Maven project containing Kotlin sources needs `kotlin-maven-plugin` executions ordered correctly with Java compilation; declaring `kotlin.version` alone does nothing.

Avoid fast-decaying dependency versions in generic snippets. Use version catalogs, BOMs, project properties, or clearly dated examples and consult migration guides for majors.

## Diagnostics and tuning

Tune from evidence:

1. Establish resource limits and latency/throughput SLOs.
2. Collect JFR, GC, native-memory, thread, and allocation evidence.
3. Change one supported option.
4. Load test the real workload.
5. Retain only measured improvement and document rollback.

Do not prescribe fixed heap ratios, stack sizes, compiler threads, pause targets, or direct-memory limits as universal defaults. Current JDKs use generational ZGC through `-XX:+UseZGC`; `-XX:+ZGenerational` is obsolete.

Heap dumps can contain secrets. Write them only to a private, access-controlled, capacity-checked path. Never enable unauthenticated or unencrypted remote JMX; use local attach, authenticated TLS, or an SSH-protected path.

## Packaging

- JDK 25 `jlink` uses numeric compression such as `--compress=2`.
- JDK 26 supports `--compress=zip-6` and related named levels.
- `jpackage` does not cross-compile; build each package format on its target platform.
- Native Image uses closed-world analysis. Tracing-agent output covers only exercised behavior; prefer framework plugins and reachability metadata, then test representative paths.
- Remove obsolete canonical `--no-fallback` guidance and measure artifact/runtime size rather than promising fixed megabytes.

## Review checklist

- Verify wrapper, JDK, Kotlin, build-tool, and test-platform versions.
- Label previews and compile/run them with the exact target release.
- Preserve cancellation and close custom executor/dispatcher lifecycles.
- Do not claim HttpClient internals or stale virtual-thread pinning behavior.
- Run tests without skip flags and verify Maven lifecycle bindings.
- Declare complete Gradle task inputs and configure Kotlin Maven compilation explicitly.
- Treat live-process diagnostics and heap dumps according to operational impact.
- Secure JMX and diagnostic artifacts.
- Tune from JFR/GC/native-memory evidence, not generic flag recipes.
- Version-gate jlink syntax and build jpackage artifacts on each target platform.
