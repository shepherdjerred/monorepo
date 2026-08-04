# Modern Java and Kotlin

Read this when using Java previews, virtual threads, structured concurrency, scoped values, Kotlin coroutines, or Java/Kotlin nullability.

## Java release model

Java SE does not define LTS. Vendors define support lifecycles; Oracle designates Java 25 as LTS. JDK 26 is the current feature release.

## Virtual threads

Use virtual-thread-per-task execution for high-concurrency blocking I/O:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var future = executor.submit(this::load);
    return future.get();
}
```

They do not make CPU work faster. JEP 491 in JDK 24 removed nearly all synchronized pinning, so diagnose rather than replacing locks reflexively.

## Structured concurrency

Structured Concurrency is still preview and has changed shape several times. JDK 25's fifth preview uses `StructuredTaskScope.open()` and `Joiner` policies. JDK 26 contains a sixth preview; always use the target JDK's docs and preview flags.

## Scoped values

Scoped Values finalized in JDK 25. Bind with `ScopedValue.where(key, value).run(...)` or `.call(...)`. Old preview `runWhere` code no longer compiles.

## Other current Java APIs

- Foreign Function and Memory finalized in JDK 22.
- Module import declarations, compact source files, and flexible constructor bodies finalized in JDK 25.
- Compact object headers are default-enabled in JDK 25 with workload-dependent memory effects.
- Non-generational ZGC and `ZGenerational` were removed/obsoleted; use current `UseZGC` behavior.

## Kotlin language

Kotlin 2.4 supports Java 26 and stabilizes context parameters. Guard conditions stabilized in Kotlin 2.2. K2 is the normal compiler, not an experimental property.

## Coroutines

Structured builders own child lifecycles. Preserve `CancellationException`, close custom executor dispatchers, and understand `Dispatchers.IO` elasticity before adding `limitedParallelism` views.

## Nullability

Kotlin platform types come from Java declarations without sufficient nullability information. Choose an annotation ecosystem deliberately. JSpecify provides modern nullness semantics for shared Java APIs; JetBrains and Eclipse annotations remain valid when explicitly configured.

## Primary documentation

- [JDK 26](https://openjdk.org/projects/jdk/26/)
- [JDK 25](https://openjdk.org/projects/jdk/25/)
- [JDK 24](https://openjdk.org/projects/jdk/24/)
- [JEP 491](https://openjdk.org/jeps/491)
- [JEP 505](https://openjdk.org/jeps/505)
- [JEP 506](https://openjdk.org/jeps/506)
- [JEP 511](https://openjdk.org/jeps/511)
- [JEP 512](https://openjdk.org/jeps/512)
- [JEP 513](https://openjdk.org/jeps/513)
- [JEP 519](https://openjdk.org/jeps/519)
- [JEP 521](https://openjdk.org/jeps/521)
- [JEP 502](https://openjdk.org/jeps/502)
- [JEP 454](https://openjdk.org/jeps/454)
- [JEP 444](https://openjdk.org/jeps/444)
- [JEP 474](https://openjdk.org/jeps/474)
- [JEP 490](https://openjdk.org/jeps/490)
- [StructuredTaskScope](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html)
- [ScopedValue](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html)
- [Executors](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html)
- [HttpClient](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html)
- [Kotlin releases](https://kotlinlang.org/docs/releases.html)
- [Kotlin 2.2](https://kotlinlang.org/docs/whatsnew22.html)
- [Kotlin 2.3](https://kotlinlang.org/docs/whatsnew23.html)
- [Kotlin 2.4](https://kotlinlang.org/docs/whatsnew24.html)
- [K2 migration](https://kotlinlang.org/docs/k2-compiler-migration-guide.html)
- [Coroutine basics](https://kotlinlang.org/docs/coroutines-basics.html)
- [Coroutine contexts and dispatchers](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)
- [Cancellation and timeouts](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [Coroutine exception handling](https://kotlinlang.org/docs/exception-handling.html)
- [Java-to-Kotlin nullability](https://kotlinlang.org/docs/java-to-kotlin-nullability-guide.html)
- [Java interoperability](https://kotlinlang.org/docs/java-interop.html)
- [Dispatchers.IO](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-dispatchers/-i-o.html)
