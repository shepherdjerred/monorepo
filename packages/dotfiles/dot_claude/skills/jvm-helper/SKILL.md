---
name: jvm-helper
description: |
  Java and Kotlin development with modern patterns, build tools, and JVM tooling
  When user works with .java or .kt files, mentions Java, Kotlin, Gradle, Maven, JVM, or JDK features
---

# JVM Helper Agent

## What's New

### Java Releases

- **Java 25 LTS** (Sep 2025): Next LTS after 21. Finalizes: Scoped Values, Module Import Declarations, Compact Source Files / Instance Main Methods, Flexible Constructor Bodies, Compact Object Headers, Generational Shenandoah. Previews: Structured Concurrency (5th), Primitive Types in Patterns (3rd), Stable Values, PEM Encodings
- **Java 24** (Mar 2025): 24 JEPs. Finalizes Stream Gatherers, Class-File API. Previews: Flexible Constructor Bodies (3rd), Primitive Types in Patterns (2nd). Deprecates 32-bit x86 port
- **Java 23** (Sep 2024): Primitive Types in Patterns preview, Module Import Declarations preview, Implicitly Declared Classes (3rd preview). Removes String Templates (design issues). Introduces Oracle GraalVM JIT as JDK option
- **Java 22** (Mar 2024): 12 JEPs. Finalizes Foreign Function & Memory API (JEP 454), Unnamed Variables & Patterns (JEP 456). Previews: Statements before super(), Implicitly Declared Classes (2nd)
- **Java 21 LTS** (Sep 2023): 15 JEPs. Finalizes Virtual Threads (JEP 444), Record Patterns (JEP 440), Pattern Matching for switch (JEP 441), Sequenced Collections (JEP 431). Previews: String Templates, Structured Concurrency, Scoped Values, Unnamed Patterns

### Kotlin Releases

- **Kotlin 2.1** (Nov 2024): Guard conditions in `when` expressions, basic Swift export support, stable Gradle DSL for compiler options, K2 kapt enabled by default (2.1.20), Lombok `@SuperBuilder` support
- **Kotlin 2.0** (May 2024): Stable K2 compiler - 2x faster compilation on average (initialization up to 488% faster, analysis up to 376% faster). Unified pipeline for all backends (JVM, JS, Wasm, Native). Improved smart casts, redesigned multiplatform compilation scheme

## Overview

This skill covers Java and Kotlin development on the JVM, including modern language features (Java 21+ and Kotlin 2.x), build tools (Gradle and Maven), packaging tools (jlink, jpackage, GraalVM native-image), and JVM tuning. The user manages Java via mise (LTS versions), so focus on Java 21 LTS features with awareness of 25 LTS additions.

## CLI Commands

### Auto-Approved Safe Commands

```bash
# Compile Java source
javac --version
javac -d out src/Main.java

# Run Java program
java --version
java -cp out Main

# Interactive Java REPL
jshell

# Kotlin compiler
kotlinc --version
kotlinc hello.kt -include-runtime -d hello.jar

# Gradle (read-only / build)
gradle --version
./gradlew tasks
./gradlew build
./gradlew test
./gradlew check
./gradlew dependencies
./gradlew dependencyInsight --dependency <name>
./gradlew projects

# Maven (read-only / build)
mvn --version
mvn compile
mvn test
mvn package
mvn dependency:tree
mvn dependency:resolve
mvn help:effective-pom
mvn help:active-profiles

# JDK tools
jar --list --file app.jar
javap -c MyClass.class
jps
jstack <pid>
jmap -histo <pid>
jcmd <pid> VM.flags
jfr print recording.jfr
```

### Build and Package

```bash
# Gradle build
./gradlew clean build
./gradlew build -x test          # skip tests
./gradlew :module:build           # specific module
./gradlew bootRun                 # Spring Boot
./gradlew assemble                # build without tests
./gradlew jar                     # build JAR

# Maven build
mvn clean package
mvn package -DskipTests
mvn -pl module-name package       # specific module
mvn spring-boot:run               # Spring Boot
mvn verify                        # run integration tests

# Create runtime image with jlink
jlink --module-path $JAVA_HOME/jmods:mods \
  --add-modules com.myapp \
  --output custom-runtime \
  --strip-debug --compress zip-6

# Create installable package with jpackage
jpackage --input lib/ --main-jar app.jar \
  --main-class com.example.Main \
  --name MyApp --type dmg

# GraalVM native image
native-image -jar app.jar myapp
native-image --no-fallback -jar app.jar
```

## Modern Java Essentials (21 LTS)

### Records

```java
// Immutable data carrier - auto-generates constructor, equals, hashCode, toString, accessors
record Point(int x, int y) {}

// Records can have custom constructors and methods
record Range(int lo, int hi) {
    Range {  // compact constructor for validation
        if (lo > hi) throw new IllegalArgumentException();
    }
    int length() { return hi - lo; }
}

// Records can implement interfaces
record NamedPoint(String name, int x, int y) implements Serializable {}
```

### Sealed Classes

```java
// Restrict which classes can extend
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double w, double h) implements Shape {}
record Triangle(double a, double b, double c) implements Shape {}

// Exhaustive switch - compiler verifies all cases covered
double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.w() * r.h();
        case Triangle t  -> { /* Heron's formula */ yield 0; }
    };
}
```

### Pattern Matching

```java
// Pattern matching for instanceof
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}

// Pattern matching for switch with guards
String format(Object obj) {
    return switch (obj) {
        case Integer i when i > 0 -> "positive: " + i;
        case Integer i            -> "non-positive: " + i;
        case String s             -> "string: " + s;
        case null                 -> "null";
        default                   -> "other: " + obj;
    };
}

// Record patterns (destructuring)
record Point(int x, int y) {}
if (obj instanceof Point(int x, int y)) {
    System.out.println("x=" + x + " y=" + y);
}

// Nested record patterns
record Line(Point start, Point end) {}
switch (shape) {
    case Line(Point(var x1, var y1), Point(var x2, var y2)) ->
        System.out.println("Line from (%d,%d) to (%d,%d)".formatted(x1, y1, x2, y2));
}
```

### Virtual Threads

```java
// Create virtual threads directly
Thread.startVirtualThread(() -> {
    // lightweight, ideal for I/O-bound tasks
    var result = fetchFromDatabase();
});

// With executor
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i ->
        executor.submit(() -> handleRequest(i))
    );
}

// Virtual thread builder
Thread vt = Thread.ofVirtual()
    .name("worker-", 0)
    .start(() -> doWork());
```

### Sequenced Collections

```java
// New interfaces: SequencedCollection, SequencedSet, SequencedMap
SequencedCollection<String> list = new ArrayList<>(List.of("a", "b", "c"));
list.getFirst();      // "a"
list.getLast();       // "c"
list.addFirst("z");
list.reversed();     // reversed view

SequencedMap<String, Integer> map = new LinkedHashMap<>();
map.putFirst("first", 1);
map.putLast("last", 99);
map.firstEntry();     // first=1
map.pollLastEntry();  // removes and returns last
map.sequencedKeySet().reversed();
```

### Unnamed Variables (finalized in Java 22, preview in 21)

```java
// Underscore for unused variables
try { /* ... */ } catch (Exception _) { log("failed"); }

for (var _ : collection) { count++; }

map.forEach((_, value) -> process(value));

// Unnamed patterns in switch
case Point(var x, _) -> "x=" + x;  // ignore y
```

## Kotlin Essentials

### Null Safety

```kotlin
// Non-null by default
var name: String = "hello"
// name = null  // compile error

// Nullable types with ?
var nullable: String? = null

// Safe call operator
val length = nullable?.length  // null if nullable is null

// Elvis operator
val len = nullable?.length ?: 0

// Not-null assertion (use sparingly)
val forced = nullable!!.length  // throws if null

// Smart cast after null check
if (nullable != null) {
    println(nullable.length)  // compiler knows it's non-null
}
```

### Data Classes and Sealed Classes

```kotlin
// Auto-generates equals, hashCode, toString, copy, componentN
data class User(val name: String, val age: Int)
val user = User("Alice", 30)
val copy = user.copy(age = 31)

// Sealed class hierarchy (exhaustive when)
sealed class Result<out T> {
    data class Success<T>(val data: T) : Result<T>()
    data class Error(val message: String) : Result<Nothing>()
    data object Loading : Result<Nothing>()
}
when (result) {
    is Result.Success -> println(result.data)
    is Result.Error   -> println(result.message)
    Result.Loading    -> println("loading...")
}
```

### Extension Functions and Scope Functions

```kotlin
// Extension function
fun String.isPalindrome(): Boolean = this == this.reversed()
"racecar".isPalindrome()  // true

// Scope functions
// let - transform, null-safe operations
nullable?.let { println(it.length) }

// apply - configure object, returns receiver
val config = Config().apply {
    host = "localhost"
    port = 8080
}

// also - side effects, returns receiver
val list = mutableListOf(1, 2).also { println("Initial: $it") }

// run - compute and return result
val result = connection.run {
    connect()
    query("SELECT ...")
}

// with - group calls on object
with(builder) {
    setName("app")
    setVersion("1.0")
    build()
}
```

### Coroutines

```kotlin
// Suspend function
suspend fun fetchUser(id: Int): User {
    return httpClient.get("/users/$id").body()
}

// Launch coroutine (fire and forget)
scope.launch {
    val user = fetchUser(1)
    updateUI(user)
}

// Async/await (concurrent)
val deferred1 = async { fetchUser(1) }
val deferred2 = async { fetchUser(2) }
val users = listOf(deferred1.await(), deferred2.await())

// Structured concurrency with coroutineScope
suspend fun loadDashboard() = coroutineScope {
    val profile = async { fetchProfile() }
    val feed = async { fetchFeed() }
    Dashboard(profile.await(), feed.await())
}
```

## When to Ask for Help

Ask the user for clarification when:

- Choice between Java and Kotlin for a new module is unclear
- Build tool selection (Gradle vs Maven) needs deciding
- Spring Boot vs Quarkus vs Micronaut framework choice
- GraalVM native-image compatibility concerns exist
- Complex multi-module project structure decisions
- JVM tuning for specific workload characteristics
- Migration strategy between Java versions

---

See `references/` for detailed guides:

- `modern-java.md` - Records, sealed classes, pattern matching, virtual threads, structured concurrency, FFM API
- `kotlin-patterns.md` - Null safety, coroutines, sealed classes, extension functions, K2 compiler, KMP
- `build-tools.md` - Gradle Kotlin DSL, Maven, GraalVM native-image, jlink, jpackage, JVM tuning
