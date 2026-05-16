# Java Quality Checklist

Concrete checklist of Java-specific items to evaluate when grading solutions. Each item is a signal that interviewers notice, positively or negatively.

---

## Collections & Data Structures

### Positive Signals

- [ ] `ArrayDeque` used for stack/queue operations (not legacy `Stack` or `LinkedList`)
- [ ] `TreeMap` with `floorEntry()`/`ceilingEntry()` for time-versioned or range-based lookups
- [ ] `LinkedHashMap` with access-order for LRU cache implementations
- [ ] `PriorityQueue` for scheduling, top-K, or expiration-based problems
- [ ] `ConcurrentHashMap` for thread-safe map access (not `Collections.synchronizedMap`)
- [ ] `EnumMap`/`EnumSet` when keys are enum types
- [ ] `Map.of()`/`List.of()`/`Set.of()` for immutable literals
- [ ] `computeIfAbsent` / `merge` instead of check-then-put patterns
- [ ] Correct initial capacity hints for `HashMap`/`ArrayList` when size is known

### Negative Signals

- [ ] Legacy `Stack` class used (should be `ArrayDeque`)
- [ ] `Vector` or `Hashtable` used (should be `ArrayList`/`HashMap`)
- [ ] `LinkedList` used as a general-purpose list (should be `ArrayList` unless frequent head insertion)
- [ ] `ArrayList` used where `HashMap` is needed for O(1) lookup
- [ ] Data structure choice doesn't match access patterns

---

## Modern Java Features (21+)

### Positive Signals

- [ ] `var` for local variable type inference where type is obvious from RHS
- [ ] `record` for immutable value objects (cells, nodes, entries, coordinates)
- [ ] Switch expressions with arrow syntax and pattern matching
- [ ] `sealed` classes/interfaces for closed type hierarchies
- [ ] Text blocks for multi-line strings
- [ ] `SequencedCollection` methods (`getFirst()`, `getLast()`, `reversed()`) where applicable
- [ ] `instanceof` pattern matching: `if (obj instanceof String s)` instead of cast

### Negative Signals

- [ ] Verbose type declarations where `var` is obvious: `HashMap<String, List<Integer>> map = new HashMap<String, List<Integer>>()`
- [ ] Mutable POJO where `record` is appropriate (no mutation needed)
- [ ] Verbose if-else chains where switch expression is cleaner
- [ ] Old-style `instanceof` + explicit cast

---

## Generics & Type Safety

### Positive Signals

- [ ] Proper generic type parameters on all collections
- [ ] PECS rule applied (Producer-Extends, Consumer-Super) for method parameters
- [ ] Bounded generics where appropriate: `<T extends Comparable<T>>`
- [ ] `Optional<V>` returned from methods that may not find a value
- [ ] `Optional.map`/`flatMap`/`orElse` instead of `isPresent()` + `get()`

### Negative Signals

- [ ] Raw types: `List` instead of `List<String>` -- MAJOR red flag
- [ ] Unchecked casts without justification
- [ ] `Optional` used as method parameter, field, or in collections
- [ ] `Optional.get()` without `isPresent()` check (or better: use `orElse`/`orElseThrow`)

---

## Immutability & Defensive Coding

### Positive Signals

- [ ] `final` on local variables that don't change (or `var` which is effectively final)
- [ ] Defensive copies on mutable input: `new ArrayList<>(input)` or `List.copyOf(input)`
- [ ] Unmodifiable views returned: `Collections.unmodifiableList()` or `List.copyOf()`
- [ ] `record` types (inherently immutable)
- [ ] No exposed mutable internal state

### Negative Signals

- [ ] Returning internal mutable collections directly (caller can modify internal state)
- [ ] Storing mutable parameters without copying (caller's mutations affect internal state)
- [ ] Public mutable fields
- [ ] Mutable static state

---

## Concurrency (When Applicable)

### Positive Signals

- [ ] `ReentrantReadWriteLock` for read-heavy concurrent access
- [ ] `ConcurrentHashMap` for lock-free concurrent maps
- [ ] `ExecutorService` / `Executors` for thread pool management
- [ ] `AtomicInteger`/`AtomicReference` for simple atomic operations
- [ ] Proper lock ordering to prevent deadlocks
- [ ] `try-finally` or `try-with-resources` for lock release
- [ ] `volatile` for visibility guarantees on shared variables

### Negative Signals

- [ ] Raw `synchronized` blocks where `java.util.concurrent` utilities are better
- [ ] `wait()`/`notify()` instead of higher-level concurrency primitives
- [ ] Missing synchronization on shared mutable state
- [ ] Holding locks during I/O or long operations
- [ ] `Thread.sleep()` for synchronization (busy waiting)

---

## Resource Management & I/O

### Positive Signals

- [ ] `try-with-resources` for all `AutoCloseable` resources
- [ ] `DataOutputStream`/`DataInputStream` for binary serialization
- [ ] `ByteBuffer` for efficient binary data manipulation
- [ ] `BufferedReader`/`BufferedWriter` wrapping raw streams
- [ ] `Path` and `Files` API instead of legacy `File` class

### Negative Signals

- [ ] Manual `close()` in `finally` block instead of try-with-resources
- [ ] Resources not closed at all (stream/reader/writer leaks)
- [ ] Legacy `File` API instead of `Path`/`Files`
- [ ] String concatenation for building file paths instead of `Path.resolve()`

---

## Naming & Structure

### Positive Signals

- [ ] Variables named for meaning: `resolvedPath`, `expirationTime`, `cellDependencies`
- [ ] Methods named for behavior: `resolveSymlinks()`, `detectCycle()`, `consumeOldestCredits()`
- [ ] Boolean methods/variables use is/has/can/should: `isExpired()`, `hasCircularDependency()`
- [ ] Helper methods extracted for reusable logic
- [ ] Single responsibility per method (typically < 20 lines of logic)
- [ ] Constants extracted: `private static final int MAX_RETRIES = 3` not magic numbers

### Negative Signals

- [ ] Single-letter names for important variables: `m`, `d`, `x`, `n` (loop indices `i`, `j` are fine)
- [ ] Generic names: `data`, `result`, `temp`, `obj`, `process()`
- [ ] Methods over 40 lines of logic
- [ ] Deeply nested conditionals (3+ levels)
- [ ] Copy-pasted logic blocks instead of extracted methods
- [ ] Magic numbers without explanation

---

## Exception Handling

### Positive Signals

- [ ] Specific exception types thrown: `IllegalArgumentException`, `NoSuchElementException`
- [ ] Descriptive exception messages: `throw new IllegalArgumentException("Cycle detected: " + path)`
- [ ] Custom exceptions for domain-specific errors when appropriate
- [ ] Exception handling at the right level (not too early, not swallowed)

### Negative Signals

- [ ] Empty catch blocks -- MAJOR red flag
- [ ] Catching `Exception` or `Throwable` broadly
- [ ] Generic `RuntimeException` thrown without specificity
- [ ] Exception used for control flow (using catch as an if-statement)
- [ ] Swallowing exceptions silently: `catch (Exception e) { /* ignore */ }`

---

## Code Smells to Flag

- [ ] `System.out.println` left for debugging (not intentional output)
- [ ] Commented-out code left in the solution
- [ ] Dead code (unreachable branches, unused methods)
- [ ] `== ` used for `String`/`Object` comparison instead of `.equals()`
- [ ] `String` concatenation with `+` inside loops (use `StringBuilder`)
- [ ] Missing `hashCode()` when `equals()` is overridden
- [ ] `null` used where `Optional` or empty collection is more appropriate
- [ ] Array used where `List` provides better API (unless performance-critical)

---

## OAI Problem-Specific Patterns

These patterns are particularly relevant for the common OAI interview problems:

| Problem Type              | Expected Java Pattern                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Time-versioned KV store   | `HashMap<K, TreeMap<Long, V>>` with `floorEntry()`                                    |
| LRU Cache                 | `LinkedHashMap` with access-order, or manual `HashMap` + doubly-linked list           |
| Path resolution (cd)      | `ArrayDeque<String>` as stack, `split("/")`                                           |
| Spreadsheet with formulas | `Map<String, Set<String>>` dependency graph, DFS cycle detection with 3-color marking |
| Resumable iterator        | Implement `Iterator<T>` interface, `record` for state checkpoint                      |
| In-memory database        | `Map<String, List<Map<String, String>>>` with stream-based filter/sort                |
| GPU credit ledger         | `TreeMap<Integer, CreditBatch>` or `PriorityQueue` ordered by timestamp               |
| Custom serialization      | `DataOutputStream`/`DataInputStream` with `writeUTF`/`readUTF`                        |
| Concurrent structures     | `ReentrantReadWriteLock` for read-heavy, `ConcurrentHashMap` for simple               |
| Cycle detection           | 3-color DFS (WHITE/GRAY/BLACK) via enum or `Set<Node>` visited/inProgress             |
