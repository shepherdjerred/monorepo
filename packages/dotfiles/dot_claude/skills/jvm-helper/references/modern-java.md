# Modern Java Features

Comprehensive guide to Java 21 LTS features and preview features progressing through Java 22-25. Focus is on finalized features in Java 21 with notes on what has since been finalized in Java 22-25.

## Records (JEP 395, finalized Java 16)

Records are transparent, immutable data carriers. The compiler generates the constructor, accessors (named after components, not getField), `equals`, `hashCode`, and `toString`.

### Basic Records

```java
record Point(int x, int y) {}

Point p = new Point(3, 4);
p.x();            // 3 (accessor, not getX)
p.y();            // 4
p.toString();     // Point[x=3, y=4]

// Equals based on all components
new Point(3, 4).equals(new Point(3, 4)); // true
```

### Compact Constructors

The compact constructor validates/normalizes without repeating field assignments:

```java
record Range(int lo, int hi) {
    Range {  // compact constructor - assignments happen implicitly after
        if (lo > hi) throw new IllegalArgumentException(
            "lo (%d) > hi (%d)".formatted(lo, hi));
    }
}

// Normalizing constructor
record EmailAddress(String value) {
    EmailAddress {
        value = value.strip().toLowerCase();
    }
}
```

### Custom Constructors and Methods

```java
record Name(String first, String last) {
    // Additional constructor must delegate to canonical
    Name(String full) {
        this(full.split(" ")[0], full.split(" ")[1]);
    }

    String fullName() { return first + " " + last; }

    // Static factory
    static Name of(String first, String last) {
        return new Name(first, last);
    }
}
```

### Records with Generics and Interfaces

```java
record Pair<A, B>(A first, B second) implements Comparable<Pair<A, B>> {
    @Override
    public int compareTo(Pair<A, B> other) { /* ... */ }
}

// Records can implement interfaces but cannot extend classes
sealed interface Shape permits Circle, Rect {}
record Circle(double radius) implements Shape {}
record Rect(double w, double h) implements Shape {}
```

### Limitations

Records cannot: extend other classes (implicitly extend `java.lang.Record`), declare instance fields beyond components, be abstract. Components are implicitly `final`. Records can: implement interfaces, have static fields/methods, have instance methods, be generic, be local (declared inside methods), be annotated.

## Sealed Classes (JEP 409, finalized Java 17)

Sealed classes restrict which classes can extend them, enabling exhaustive pattern matching.

```java
// Sealed interface with permitted subtypes
public sealed interface Expr
    permits Literal, Add, Multiply, Negate {
}

record Literal(double value) implements Expr {}
record Add(Expr left, Expr right) implements Expr {}
record Multiply(Expr left, Expr right) implements Expr {}
record Negate(Expr operand) implements Expr {}

// Exhaustive computation - compiler verifies all cases
double compute(Expr expr) {
    return switch (expr) {
        case Literal(var v)        -> v;
        case Add(var l, var r)     -> compute(l) + compute(r);
        case Multiply(var l, var r) -> compute(l) * compute(r);
        case Negate(var e)         -> -compute(e);
        // No default needed - all cases covered
    };
}
```

### Sealed Class Modifiers

Permitted subtypes must use one of:

- `final` - no further extension
- `sealed` - further restricted extension
- `non-sealed` - opens up for unrestricted extension

```java
sealed class Account permits SavingsAccount, CheckingAccount, CryptoAccount {}
final class SavingsAccount extends Account {}
sealed class CheckingAccount extends Account permits PremiumChecking {}
non-sealed class CryptoAccount extends Account {} // anyone can extend
final class PremiumChecking extends CheckingAccount {}
```

If subtypes are in the same file, `permits` can be omitted:

```java
sealed interface Json {
    record JString(String value) implements Json {}
    record JNumber(double value) implements Json {}
    record JBool(boolean value) implements Json {}
    record JNull() implements Json {}
    record JArray(List<Json> elements) implements Json {}
    record JObject(Map<String, Json> fields) implements Json {}
}
```

## Pattern Matching

### Pattern Matching for instanceof (JEP 394, finalized Java 16)

```java
// Before: cast after instanceof
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}

// After: pattern variable bound in scope
if (obj instanceof String s) {
    System.out.println(s.length());
}

// Works with && (short-circuit)
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}

// Negation pattern
if (!(obj instanceof String s)) {
    return; // s not in scope here
}
// s IS in scope here (definite assignment)
System.out.println(s.length());
```

### Pattern Matching for switch (JEP 441, finalized Java 21)

```java
// Type patterns in switch
String describe(Object obj) {
    return switch (obj) {
        case Integer i    -> "int: " + i;
        case Long l       -> "long: " + l;
        case Double d     -> "double: " + d;
        case String s     -> "string: " + s;
        case int[] arr    -> "int array of length " + arr.length;
        case null         -> "null";
        default           -> obj.getClass().getName();
    };
}
```

### Guarded Patterns

```java
// when clause adds conditions
String classify(Object obj) {
    return switch (obj) {
        case Integer i when i < 0  -> "negative";
        case Integer i when i == 0 -> "zero";
        case Integer i             -> "positive";
        case String s when s.isBlank() -> "blank string";
        case String s              -> "string: " + s;
        default -> "other";
    };
}
```

### Record Patterns (JEP 440, finalized Java 21)

Destructure records directly in patterns:

```java
record Point(int x, int y) {}
record Line(Point start, Point end) {}

// instanceof with record pattern
if (obj instanceof Point(int x, int y)) {
    System.out.println("(%d, %d)".formatted(x, y));
}

// Switch with record pattern
String describe(Object obj) {
    return switch (obj) {
        case Point(var x, var y) -> "point at %d,%d".formatted(x, y);
        case Line(Point(var x1, var y1), Point(var x2, var y2)) ->
            "line from (%d,%d) to (%d,%d)".formatted(x1, y1, x2, y2);
        default -> "unknown";
    };
}

// Combining sealed types + records + patterns
sealed interface Shape permits Circle, Rect {}
record Circle(Point center, double radius) implements Shape {}
record Rect(Point topLeft, Point bottomRight) implements Shape {}

String info(Shape shape) {
    return switch (shape) {
        case Circle(Point(var cx, var cy), var r) ->
            "circle at (%d,%d) radius %.1f".formatted(cx, cy, r);
        case Rect(Point(var x1, var y1), Point(var x2, var y2)) ->
            "rect from (%d,%d) to (%d,%d)".formatted(x1, y1, x2, y2);
    };
}
```

### Unnamed Variables and Patterns (JEP 456, finalized Java 22)

Use `_` when a variable or pattern component is not needed:

```java
// Unused catch variable
try { /* ... */ } catch (NumberFormatException _) {
    System.out.println("Not a number");
}

// Unused loop variable
int count = 0;
for (var _ : collection) { count++; }

// Unused lambda parameter
map.forEach((_, value) -> process(value));

// Unnamed pattern in record destructuring
case Point(var x, _) -> "x=" + x;  // ignore y component

// Multiple unnamed in same scope (allowed, since no name conflict)
if (obj instanceof Pair(var first, _)) {
    System.out.println("first: " + first);
}
```

### Primitive Types in Patterns (preview Java 23-25)

```java
// Expected to finalize soon
switch (statusCode) {
    case 200 -> "OK";
    case 404 -> "Not Found";
    case int i when i >= 500 -> "Server Error: " + i;
    case int i -> "Other: " + i;
}
```

## Virtual Threads (JEP 444, finalized Java 21)

Virtual threads are lightweight threads managed by the JVM rather than the OS. They enable writing blocking code at massive scale without thread pool tuning.

### Creating Virtual Threads

```java
// Simple start
Thread.startVirtualThread(() -> {
    var data = blockingHttpCall();  // blocks virtual thread, not OS thread
    process(data);
});

// Builder pattern
Thread vt = Thread.ofVirtual()
    .name("worker-", 0)           // prefix + counter
    .start(() -> doWork());

// Executor (recommended for most use cases)
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();

    for (var future : futures) {
        System.out.println(future.get());
    }
}
```

### When to Use Virtual Threads

Use virtual threads for:

- I/O-bound tasks (HTTP calls, database queries, file I/O)
- High-concurrency servers handling many simultaneous connections
- Fan-out patterns (calling multiple services concurrently)

Do NOT use virtual threads for:

- CPU-intensive computation (use platform threads or ForkJoinPool)
- Tasks requiring thread-local caching with large objects (each VT has its own)
- Code using `synchronized` blocks that do I/O inside them (use ReentrantLock instead, as synchronized pins the carrier thread)

### Virtual Threads with Existing APIs

```java
// Works with ExecutorService
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

// Works with CompletableFuture
var cf = CompletableFuture.supplyAsync(() -> fetch(url), executor);

// HttpClient uses virtual threads internally in Java 21+
HttpClient client = HttpClient.newHttpClient();
```

## Structured Concurrency (preview since Java 21, 5th preview in Java 25)

Structured concurrency treats groups of related tasks as a unit, ensuring child tasks complete before the parent scope exits.

```java
// Using StructuredTaskScope (preview API)
// Compile with: javac --enable-preview --source 21
ScopedValue<String> USER = ScopedValue.newInstance();

try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User> userTask = scope.fork(() -> fetchUser(id));
    Subtask<List<Order>> ordersTask = scope.fork(() -> fetchOrders(id));

    scope.join();           // wait for all subtasks
    scope.throwIfFailed();  // propagate exceptions

    return new UserDashboard(userTask.get(), ordersTask.get());
}

// ShutdownOnSuccess - returns first successful result
try (var scope = new StructuredTaskScope.ShutdownOnSuccess<String>()) {
    scope.fork(() -> fetchFromPrimary());
    scope.fork(() -> fetchFromBackup());

    scope.join();
    return scope.result();  // first successful result
}
```

## Scoped Values (preview since Java 21, finalized Java 25)

Scoped values are an alternative to ThreadLocal for sharing immutable data within and across threads in a structured way.

```java
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

void handleRequest(Request req) {
    User user = authenticate(req);
    ScopedValue.runWhere(CURRENT_USER, user, () -> {
        processRequest(req);  // CURRENT_USER is accessible here
    });
}

void processRequest(Request req) {
    User user = CURRENT_USER.get();  // access without parameter passing
    // ...
}

// Works with StructuredTaskScope - child tasks inherit scoped values
ScopedValue.runWhere(CURRENT_USER, user, () -> {
    try (var scope = new StructuredTaskScope<>()) {
        scope.fork(() -> {
            // CURRENT_USER.get() works here too
            return doWork();
        });
        scope.join();
    }
});
```

## Sequenced Collections (JEP 431, finalized Java 21)

Three new interfaces for collections with defined encounter order:

```java
// SequencedCollection<E> extends Collection<E>
// Methods: addFirst, addLast, getFirst, getLast, removeFirst, removeLast, reversed

List<String> list = new ArrayList<>(List.of("a", "b", "c"));
list.getFirst();   // "a"
list.getLast();    // "c"
list.addFirst("z");
list.reversed().forEach(System.out::println);  // c, b, a, z

// SequencedSet<E> extends SequencedCollection<E>, Set<E>
SequencedSet<String> set = new LinkedHashSet<>(List.of("x", "y", "z"));
set.getFirst();   // "x"
set.getLast();    // "z"
set.reversed();   // reversed view

// SequencedMap<K,V> extends Map<K,V>
SequencedMap<String, Integer> map = new LinkedHashMap<>();
map.put("one", 1);
map.put("two", 2);
map.putFirst("zero", 0);
map.firstEntry();   // zero=0
map.lastEntry();    // two=2
map.pollLastEntry(); // removes and returns two=2
map.sequencedKeySet();
map.sequencedValues();
map.sequencedEntrySet();
```

Existing classes that gain these interfaces: `ArrayList`, `LinkedList`, `LinkedHashSet`, `TreeSet`, `LinkedHashMap`, `TreeMap`, `ConcurrentSkipListSet`, `ConcurrentSkipListMap`, and their unmodifiable wrappers.

## Foreign Function & Memory API (JEP 454, finalized Java 22)

Replaces JNI for calling native code and managing off-heap memory safely.

### Key Concepts

- **Arena** - manages lifecycle of memory segments (auto or confined)
- **MemorySegment** - represents a contiguous region of memory (heap or off-heap)
- **MemoryLayout** - describes memory structure (struct layout, sequence layout)
- **Linker** - links Java code with native functions
- **SymbolLookup** - finds native function addresses

### Calling Native Functions

```java
// Call strlen from C standard library
try (Arena arena = Arena.ofConfined()) {
    // Look up the native function
    Linker linker = Linker.nativeLinker();
    SymbolLookup stdlib = linker.defaultLookup();
    MethodHandle strlen = linker.downcallHandle(
        stdlib.find("strlen").orElseThrow(),
        FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS)
    );

    // Allocate native string
    MemorySegment str = arena.allocateFrom("Hello, FFM!");

    // Call native function
    long len = (long) strlen.invoke(str);
    System.out.println("Length: " + len);  // 11
}
```

### Off-Heap Memory

```java
try (Arena arena = Arena.ofConfined()) {
    // Allocate array of 100 ints
    MemorySegment segment = arena.allocate(ValueLayout.JAVA_INT, 100);

    // Write values
    for (int i = 0; i < 100; i++) {
        segment.setAtIndex(ValueLayout.JAVA_INT, i, i * 2);
    }

    // Read values
    int val = segment.getAtIndex(ValueLayout.JAVA_INT, 50);  // 100
}
// Memory automatically freed when arena closes
```

## Stream Gatherers (JEP 485, finalized Java 24)

Custom intermediate stream operations:

```java
// Built-in gatherers
import java.util.stream.Gatherers;

// Fixed-size windows
Stream.of(1, 2, 3, 4, 5)
    .gather(Gatherers.windowFixed(2))
    .toList();  // [[1,2], [3,4], [5]]

// Sliding windows
Stream.of(1, 2, 3, 4, 5)
    .gather(Gatherers.windowSliding(3))
    .toList();  // [[1,2,3], [2,3,4], [3,4,5]]

// Fold (stateful reduction)
Stream.of(1, 2, 3, 4)
    .gather(Gatherers.fold(() -> 0, Integer::sum))
    .toList();  // [10]

// Scan (running accumulation)
Stream.of(1, 2, 3, 4)
    .gather(Gatherers.scan(() -> 0, Integer::sum))
    .toList();  // [1, 3, 6, 10]

// mapConcurrent - parallel map with virtual threads
Stream.of(url1, url2, url3)
    .gather(Gatherers.mapConcurrent(10, this::fetch))
    .toList();
```

## Compact Source Files and Instance Main Methods (finalized Java 25)

Simplified entry points for new programmers:

```java
// Before (traditional)
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}

// After (Java 25) - no class declaration needed
void main() {
    println("Hello, World!");  // implicit import of IO methods
}

// Module imports also available (Java 25)
import module java.base;  // imports all public types from java.base
```

## Other Notable Features

### Text Blocks (finalized Java 15)

```java
String json = """
        {
            "name": "%s",
            "age": %d
        }
        """.formatted(name, age);

// Trailing whitespace control with \s
// Line continuation with \ at end of line
String text = """
        This is a long \
        single line\s\
        with trailing space""";
```

### Switch Expressions (finalized Java 14)

```java
// Arrow form (no fall-through)
int numLetters = switch (day) {
    case MONDAY, FRIDAY, SUNDAY -> 6;
    case TUESDAY                -> 7;
    case THURSDAY, SATURDAY     -> 8;
    case WEDNESDAY              -> 9;
};

// Block with yield
String result = switch (status) {
    case 200 -> "OK";
    case 404 -> {
        log("Not found");
        yield "Not Found";
    }
    default -> "Unknown";
};
```
