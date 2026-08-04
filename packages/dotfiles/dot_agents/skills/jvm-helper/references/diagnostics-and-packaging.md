# JVM diagnostics and packaging

Read this when attaching to a JVM, collecting heap or flight recordings, configuring JMX, tuning memory/GC, using jlink/jpackage, or building Native Image.

## Attach impact

`jcmd` operations document impact levels and generally require the same user/machine. `jmap` is experimental and unsupported. Diagnose in a staging or approved production window according to the exact operation's impact.

## Heap and JMX security

Heap dumps commonly contain tokens, credentials, personal data, and application payloads. Use a private path with access control and available capacity; define retention and deletion.

Remote JMX provides control and inspection. Never expose it without authentication and TLS. Prefer local attach or an SSH-protected channel when practical.

## Measurement-first tuning

Collect JFR, GC logs, native-memory tracking, thread state, allocation, and system/container evidence. Change one supported flag, load test, and keep only a measured improvement.

Compact object headers are default-enabled in JDK 25; memory savings are workload-dependent. Current ZGC is generational by default, and `-XX:+ZGenerational` is obsolete.

## jlink

JDK 25 uses numeric compression levels such as `--compress=2`. JDK 26 adds `zip-0` through `zip-9`. Measure runtime-image size for the selected modules, platform, compression, and debug-symbol policy.

## jpackage

Each native package format must be created on its target platform. There is no cross-platform package build. Test signing, runtime image, upgrade, uninstall, and user-data behavior on the target OS.

## GraalVM Native Image

Native Image performs closed-world analysis. Dynamic reflection, resources, proxies, serialization, and JNI need reachable metadata or code-computed configuration.

Tracing-agent output observes only executed paths. Exercise representative workloads, merge and review metadata, and prefer framework plugins or the reachability metadata repository when available. Do not use `--no-fallback` as a current canonical requirement.

## Primary documentation

- [Java support roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html)
- [JDK 25 jlink](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html)
- [JDK 26 jlink](https://docs.oracle.com/en/java/javase/26/docs/specs/man/jlink.html)
- [jpackage](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jpackage.html)
- [jcmd](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html)
- [jmap](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jmap.html)
- [JMX agent security](https://docs.oracle.com/javase/8/docs/technotes/guides/management/agent.html)
- [Native Image](https://www.graalvm.org/latest/reference-manual/native-image/)
- [Tracing agent](https://www.graalvm.org/latest/reference-manual/native-image/guides/configure-with-tracing-agent/)
- [Native Image compatibility](https://www.graalvm.org/latest/reference-manual/native-image/metadata/Compatibility/)
- [Native Image memory management](https://www.graalvm.org/latest/reference-manual/native-image/optimizations-and-performance/MemoryManagement/)
- [Ktor releases](https://ktor.io/docs/releases.html)
- [Ktor latest](https://github.com/ktorio/ktor/releases/latest)
- [Spring Boot latest](https://github.com/spring-projects/spring-boot/releases/latest)
- [Shadow latest](https://github.com/GradleUp/shadow/releases/latest)
- [JUnit latest](https://github.com/junit-team/junit-framework/releases/latest)
