# Kotlin Patterns and Idioms

Comprehensive guide to Kotlin language features, patterns, and modern development with the K2 compiler and Kotlin Multiplatform.

## Null Safety

Kotlin's type system distinguishes nullable and non-nullable types at compile time, eliminating most NullPointerExceptions.

### Nullable Types

```kotlin
// Non-nullable - cannot hold null
var name: String = "Alice"
// name = null  // compile error

// Nullable - can hold null
var nullable: String? = null
nullable = "hello"
// nullable.length  // compile error - must handle null
```

### Safe Operators

```kotlin
// Safe call operator ?.
val length: Int? = nullable?.length  // null if nullable is null

// Chained safe calls
val city: String? = user?.address?.city

// Safe call with let for non-null execution
nullable?.let { value ->
    println("Length: ${value.length}")
}

// Elvis operator ?: (default value)
val len: Int = nullable?.length ?: 0
val name: String = input ?: throw IllegalArgumentException("name required")
val result: String = nullable ?: return  // early return

// Not-null assertion !! (throws NPE if null - avoid when possible)
val forced: Int = nullable!!.length

// Safe cast
val str: String? = value as? String  // null if cast fails (instead of ClassCastException)
```

### Smart Casts

The compiler tracks null checks and casts automatically:

```kotlin
fun process(value: String?) {
    if (value == null) return
    // Compiler knows value is String (non-null) here
    println(value.length)
}

fun handleResult(result: Any) {
    when (result) {
        is String -> println(result.length)      // smart cast to String
        is Int    -> println(result + 1)          // smart cast to Int
        is List<*> -> println(result.size)        // smart cast to List
    }
}

// Improved smart casts in Kotlin 2.0 (K2 compiler)
// K2 can smart cast in more scenarios, including:
// - Variables captured in lambdas
// - Inline function calls
// - Property-based smart casts after checks in when/if
```

### Platform Types

When calling Java code, Kotlin infers platform types (noted as `T!`) which can be treated as nullable or non-null. Always annotate nullability when writing Java code consumed by Kotlin, using `@Nullable` and `@NotNull`.

## Coroutines

Kotlin coroutines enable asynchronous, non-blocking code that reads like sequential code.

### Suspend Functions

```kotlin
// suspend marks a function that can be paused and resumed
suspend fun fetchUser(id: Int): User {
    val response = httpClient.get("https://api.example.com/users/$id")
    return response.body<User>()
}

// Suspend functions can only be called from other suspend functions or coroutine builders
```

### Coroutine Builders

```kotlin
// launch - fire and forget, returns Job
val job: Job = scope.launch {
    val user = fetchUser(1)
    updateUI(user)
}
job.cancel()  // cancel if needed
job.join()    // wait for completion

// async - returns Deferred<T> with a result
val deferred: Deferred<User> = scope.async {
    fetchUser(1)
}
val user: User = deferred.await()

// runBlocking - bridges blocking and suspend worlds (for main/tests)
fun main() = runBlocking {
    val user = fetchUser(1)
    println(user)
}

// coroutineScope - creates a scope, suspends until all children complete
suspend fun loadData() = coroutineScope {
    val users = async { fetchUsers() }
    val posts = async { fetchPosts() }
    Pair(users.await(), posts.await())
}
```

### Structured Concurrency

Coroutines follow a parent-child hierarchy. If a parent is cancelled, all children are cancelled. If a child fails, the parent and siblings are cancelled (unless using `supervisorScope`).

```kotlin
// Regular scope - child failure cancels parent and siblings
suspend fun riskyOperation() = coroutineScope {
    launch { task1() }  // cancelled if task2 throws
    launch { task2() }  // cancelled if task1 throws
}

// supervisorScope - child failure does NOT cancel siblings
suspend fun independentTasks() = supervisorScope {
    launch { task1() }  // continues even if task2 throws
    launch { task2() }  // continues even if task1 throws
}

// Job hierarchy
val parentJob = scope.launch {
    val childJob = launch {
        delay(1000)
        println("child")
    }
}
parentJob.cancel()  // cancels childJob too
```

### Dispatchers

```kotlin
// Dispatchers.Default - CPU-intensive work (shared thread pool, size = num cores)
withContext(Dispatchers.Default) {
    heavyComputation()
}

// Dispatchers.IO - blocking I/O (expandable thread pool, up to 64 threads)
withContext(Dispatchers.IO) {
    readFile()
    databaseQuery()
}

// Dispatchers.Main - UI thread (Android, JavaFX, Swing with coroutine extensions)
withContext(Dispatchers.Main) {
    updateUI()
}

// Dispatchers.Unconfined - starts in caller thread, resumes in whatever thread
// Use sparingly, mainly for testing

// Custom dispatcher from executor
val dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
```

### Flow

Cold asynchronous stream that emits values sequentially:

```kotlin
// Creating flows
fun numbers(): Flow<Int> = flow {
    for (i in 1..5) {
        delay(100)
        emit(i)
    }
}

// Collecting flows
numbers().collect { value ->
    println(value)
}

// Flow operators
numbers()
    .filter { it % 2 == 0 }
    .map { it * 10 }
    .take(3)
    .collect { println(it) }

// flowOf and asFlow
val flow1 = flowOf(1, 2, 3)
val flow2 = listOf("a", "b", "c").asFlow()

// Combining flows
val combined = flow1.zip(flow2) { num, str -> "$num-$str" }
// Emits: "1-a", "2-b", "3-c"

// flatMapConcat, flatMapMerge, flatMapLatest
flow1.flatMapConcat { id -> fetchDetails(id) }

// StateFlow - hot flow with current value (like LiveData)
private val _state = MutableStateFlow(UiState.Loading)
val state: StateFlow<UiState> = _state.asStateFlow()

// SharedFlow - hot flow for events
private val _events = MutableSharedFlow<Event>()
val events: SharedFlow<Event> = _events.asSharedFlow()

// Convert cold flow to shared
val shared = coldFlow
    .shareIn(scope, SharingStarted.WhileSubscribed(5000), replay = 1)
```

### Exception Handling in Coroutines

```kotlin
// try-catch in coroutine
launch {
    try {
        riskyOperation()
    } catch (e: Exception) {
        handleError(e)
    }
}

// CoroutineExceptionHandler (last resort, launch only, not async)
val handler = CoroutineExceptionHandler { _, exception ->
    log("Caught: $exception")
}
scope.launch(handler) { riskyOperation() }

// async exceptions are thrown at await()
val deferred = async { riskyOperation() }
try {
    deferred.await()
} catch (e: Exception) {
    handleError(e)
}
```

## Data Classes

```kotlin
data class User(
    val id: Long,
    val name: String,
    val email: String,
    val role: Role = Role.USER  // default value
)

// Auto-generated: equals, hashCode, toString, copy, componentN
val user = User(1, "Alice", "alice@example.com")
val admin = user.copy(role = Role.ADMIN)

// Destructuring
val (id, name, email) = user
println("$name: $email")

// In collections
val users = listOf(user, admin)
users.sortedBy { it.name }
users.associateBy { it.id }  // Map<Long, User>
```

### Data Class vs Record

| Feature        | Kotlin data class                            | Java record                   |
| -------------- | -------------------------------------------- | ----------------------------- |
| Mutability     | Can use `var` (mutable) or `val` (immutable) | Always immutable              |
| Inheritance    | Can inherit from classes/interfaces          | Can implement interfaces only |
| `copy()`       | Generated automatically                      | Not available                 |
| Default values | Supported                                    | Not supported                 |
| componentN     | Generated                                    | Not available                 |

## Sealed Classes and Interfaces

```kotlin
// Sealed class - all subtypes known at compile time
sealed class NetworkResult<out T> {
    data class Success<T>(val data: T) : NetworkResult<T>()
    data class Error(val code: Int, val message: String) : NetworkResult<Nothing>()
    data object Loading : NetworkResult<Nothing>()
}

// Exhaustive when - compiler enforces all cases
fun <T> handle(result: NetworkResult<T>) = when (result) {
    is NetworkResult.Success -> showData(result.data)
    is NetworkResult.Error   -> showError(result.message)
    NetworkResult.Loading    -> showSpinner()
    // No else needed - all cases covered
}

// Sealed interface (can implement multiple)
sealed interface UiEvent {
    data class Click(val x: Int, val y: Int) : UiEvent
    data class KeyPress(val key: Char) : UiEvent
    data object BackPressed : UiEvent
}

// Nesting sealed hierarchies
sealed interface Animal {
    sealed class Dog : Animal {
        data object Labrador : Dog()
        data object Poodle : Dog()
    }
    sealed class Cat : Animal {
        data object Siamese : Cat()
        data object Persian : Cat()
    }
}
```

### Guard Conditions in when (Kotlin 2.1)

```kotlin
sealed interface Command {
    data class Move(val dx: Int, val dy: Int) : Command
    data class Print(val message: String) : Command
}

fun execute(command: Command) = when (command) {
    is Command.Move if command.dx == 0 && command.dy == 0 -> "no-op"
    is Command.Move -> "move by (${command.dx}, ${command.dy})"
    is Command.Print -> "print: ${command.message}"
}
```

## Extension Functions

```kotlin
// Add methods to existing types without inheritance
fun String.removeWhitespace(): String = this.replace("\\s".toRegex(), "")
"hello world".removeWhitespace()  // "helloworld"

// Extension properties
val String.wordCount: Int
    get() = this.split("\\s+".toRegex()).size
"one two three".wordCount  // 3

// Generic extensions
fun <T> List<T>.secondOrNull(): T? = if (size >= 2) this[1] else null

// Extension on nullable types
fun String?.orEmpty(): String = this ?: ""

// Extensions are resolved statically (at compile time, not runtime)
// If a member function exists with same signature, member wins
```

### Scope Functions Summary

| Function | Context object | Return value   | Use case                |
| -------- | -------------- | -------------- | ----------------------- |
| `let`    | `it`           | Lambda result  | Null-safe transforms    |
| `run`    | `this`         | Lambda result  | Object config + compute |
| `with`   | `this`         | Lambda result  | Grouping calls          |
| `apply`  | `this`         | Context object | Object configuration    |
| `also`   | `it`           | Context object | Side effects, logging   |

```kotlin
// Chaining scope functions
val result = fetchData()
    .also { log("Fetched: $it") }
    .let { transform(it) }
    .also { log("Transformed: $it") }
```

## K2 Compiler

The K2 compiler (stable in Kotlin 2.0) is a complete rewrite of the Kotlin compiler frontend.

### Key Improvements

- **2x faster compilation** on average (initialization up to 488% faster, analysis up to 376% faster)
- **Unified architecture** for all backends (JVM, JS, Wasm, Native)
- **Improved smart casts** in more scenarios (closures, inline functions, properties)
- **Better type inference** reduces need for explicit type annotations
- **Foundation for future features** like context receivers, name-based destructuring

### Migration

```kotlin
// build.gradle.kts - K2 is default in Kotlin 2.0+
plugins {
    kotlin("jvm") version "2.1.0"
}

// If needed, explicitly set language version
kotlin {
    compilerOptions {
        languageVersion.set(KotlinVersion.KOTLIN_2_0)
    }
}
```

### Checking Compatibility

```bash
# Build with K2 and check for issues
./gradlew build -Pkotlin.experimental.tryK2=true

# In Kotlin 2.0+, K2 is the default - no flag needed
```

## Kotlin Multiplatform (KMP)

Share code across JVM, JS, Wasm, iOS, Android, desktop, and server.

### Project Structure

```
project/
  src/
    commonMain/    # Shared code - expect declarations
    commonTest/    # Shared tests
    jvmMain/       # JVM-specific - actual declarations
    iosMain/       # iOS-specific
    jsMain/        # JavaScript-specific
```

### Declaring Targets

```kotlin
// build.gradle.kts
plugins {
    kotlin("multiplatform") version "2.1.0"
}

kotlin {
    jvm()
    iosArm64()
    iosSimulatorArm64()
    js(IR) { browser() }

    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            implementation("io.ktor:ktor-client-core:3.0.0")
        }
        jvmMain.dependencies {
            implementation("io.ktor:ktor-client-cio:3.0.0")
        }
    }
}
```

### Expect/Actual

```kotlin
// commonMain - declare expected API
expect fun platformName(): String
expect class PlatformLogger() {
    fun log(message: String)
}

// jvmMain - provide actual implementation
actual fun platformName(): String = "JVM"
actual class PlatformLogger actual constructor() {
    actual fun log(message: String) = println("[JVM] $message")
}

// iosMain
actual fun platformName(): String = "iOS"
actual class PlatformLogger actual constructor() {
    actual fun log(message: String) = NSLog("[iOS] $message")
}
```

## Useful Kotlin Idioms

### Collection Operations

```kotlin
// Filter and transform
val adults = users.filter { it.age >= 18 }.map { it.name }

// Grouping
val byCity = users.groupBy { it.city }

// Associate
val byId: Map<Long, User> = users.associateBy { it.id }

// Partition
val (minors, adults) = users.partition { it.age < 18 }

// Null-safe collection operations
val names = users.mapNotNull { it.nickname }  // skip nulls

// Sequences for lazy processing (large collections)
users.asSequence()
    .filter { it.isActive }
    .map { it.name }
    .take(10)
    .toList()
```

### Delegation

```kotlin
// Class delegation
interface Repository { fun find(id: Int): Item? }
class CachingRepository(private val delegate: Repository) : Repository by delegate {
    override fun find(id: Int): Item? {
        return cache.get(id) ?: delegate.find(id)?.also { cache.put(id, it) }
    }
}

// Property delegation
val lazyValue: String by lazy { computeExpensiveValue() }
var observed: String by Delegates.observable("initial") { _, old, new ->
    println("$old -> $new")
}
val props: Map<String, Any?> = mapOf("name" to "Alice", "age" to 30)
val name: String by props  // delegates to map lookup
```

### Type-Safe Builders (DSL)

```kotlin
// HTML DSL example
fun html(init: HTML.() -> Unit): HTML = HTML().apply(init)

html {
    head { title("Page") }
    body {
        p("Hello")
        a(href = "https://example.com") { +"Click here" }
    }
}
```

### Inline Functions and Reified Types

```kotlin
// Inline function avoids lambda allocation overhead
inline fun <T> measureTime(block: () -> T): Pair<T, Long> {
    val start = System.nanoTime()
    val result = block()
    return result to (System.nanoTime() - start)
}

// Reified type parameters (only in inline functions)
inline fun <reified T> parseJson(json: String): T {
    return objectMapper.readValue(json, T::class.java)
}
val user: User = parseJson("""{"name":"Alice"}""")
```
