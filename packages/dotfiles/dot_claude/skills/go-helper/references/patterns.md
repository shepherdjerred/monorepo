# Go Patterns and Idioms

Common Go patterns covering error handling, interfaces, generics, concurrency, context, iterators, struct embedding, and testing patterns.

## Error Handling

### The Basic Pattern

Go's error handling follows an explicit pattern: check errors immediately after every call that can fail.

```go
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doing something: %w", err)
}
// use result
```

### Wrapping Errors with Context

Use `fmt.Errorf` with `%w` to wrap errors, preserving the original while adding context. This creates an error chain that can be inspected with `errors.Is` and `errors.As`.

```go
func loadUser(id string) (*User, error) {
    data, err := db.Query("SELECT * FROM users WHERE id = $1", id)
    if err != nil {
        return nil, fmt.Errorf("querying user %s: %w", id, err)
    }
    user, err := parseUser(data)
    if err != nil {
        return nil, fmt.Errorf("parsing user %s: %w", id, err)
    }
    return user, nil
}
```

### Sentinel Errors

Sentinel errors are package-level variables that represent specific error conditions. Callers check for them using `errors.Is`.

```go
package mypackage

import "errors"

var (
    ErrNotFound    = errors.New("not found")
    ErrConflict    = errors.New("conflict")
    ErrForbidden   = errors.New("forbidden")
)

func GetItem(id string) (*Item, error) {
    item, ok := store[id]
    if !ok {
        return nil, fmt.Errorf("item %s: %w", id, ErrNotFound)
    }
    return item, nil
}

// Caller
item, err := GetItem("abc")
if errors.Is(err, mypackage.ErrNotFound) {
    // handle not found specifically
}
```

### Custom Error Types

For errors that carry structured data, define a type implementing the `error` interface.

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s - %s", e.Field, e.Message)
}

func Validate(u *User) error {
    if u.Name == "" {
        return &ValidationError{Field: "name", Message: "required"}
    }
    if u.Age < 0 {
        return &ValidationError{Field: "age", Message: "must be non-negative"}
    }
    return nil
}

// Caller extracts the structured error
var valErr *ValidationError
if errors.As(err, &valErr) {
    fmt.Printf("field %s: %s\n", valErr.Field, valErr.Message)
}
```

### Multi-Error Handling

Go 1.20+ supports wrapping multiple errors with `errors.Join` and `fmt.Errorf` with multiple `%w` verbs.

```go
// Join multiple errors
err1 := step1()
err2 := step2()
err3 := step3()
if err := errors.Join(err1, err2, err3); err != nil {
    return err // contains all non-nil errors
}

// Multiple %w in fmt.Errorf
err := fmt.Errorf("failed: %w and %w", err1, err2)
// errors.Is(err, err1) == true
// errors.Is(err, err2) == true
```

### Panic and Recover

Use `panic` only for truly unrecoverable situations (programmer errors, impossible states). Use `recover` in deferred functions to catch panics at API boundaries.

```go
// Only panic for programmer errors
func MustParse(s string) *Config {
    cfg, err := Parse(s)
    if err != nil {
        panic(fmt.Sprintf("MustParse: %v", err))
    }
    return cfg
}

// Recover at API boundary (HTTP handler, goroutine root)
func safeHandler(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("panic recovered: %v\n%s", r, debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

## Interfaces

### Design Principles

Go interfaces are satisfied implicitly - no `implements` keyword. This enables loose coupling.

```go
// Small, focused interfaces (Go proverb: "The bigger the interface, the weaker the abstraction")
type Storer interface {
    Store(ctx context.Context, key string, value []byte) error
}

type Loader interface {
    Load(ctx context.Context, key string) ([]byte, error)
}

// Compose when needed
type Storage interface {
    Storer
    Loader
}
```

### Accept Interfaces, Return Structs

Functions should accept interfaces for flexibility and return concrete types for clarity.

```go
// Good: accepts interface
func ProcessData(r io.Reader) (*Result, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return nil, err
    }
    return &Result{Data: data}, nil
}

// Works with any io.Reader: files, HTTP bodies, buffers, strings
ProcessData(os.Stdin)
ProcessData(resp.Body)
ProcessData(bytes.NewReader(data))
ProcessData(strings.NewReader("hello"))
```

### Interface Assertions and Checks

```go
// Type assertion
val, ok := i.(ConcreteType)
if ok {
    // use val as ConcreteType
}

// Type switch
switch v := i.(type) {
case string:
    fmt.Println("string:", v)
case int:
    fmt.Println("int:", v)
case io.Reader:
    data, _ := io.ReadAll(v)
    fmt.Println("reader:", string(data))
default:
    fmt.Println("unknown type")
}

// Compile-time interface check
var _ io.ReadCloser = (*MyType)(nil)
```

### Common Standard Library Interfaces

| Interface | Methods | Purpose |
|-----------|---------|---------|
| `io.Reader` | `Read([]byte) (int, error)` | Read bytes |
| `io.Writer` | `Write([]byte) (int, error)` | Write bytes |
| `io.Closer` | `Close() error` | Release resources |
| `io.ReadWriter` | `Read` + `Write` | Bidirectional I/O |
| `io.ReadCloser` | `Read` + `Close` | Readable + closeable |
| `fmt.Stringer` | `String() string` | String representation |
| `error` | `Error() string` | Error value |
| `sort.Interface` | `Len`, `Less`, `Swap` | Sortable collection |
| `http.Handler` | `ServeHTTP(ResponseWriter, *Request)` | HTTP handler |
| `context.Context` | `Deadline`, `Done`, `Err`, `Value` | Request scoping |
| `encoding.TextMarshaler` | `MarshalText() ([]byte, error)` | Text serialization |
| `json.Marshaler` | `MarshalJSON() ([]byte, error)` | JSON serialization |

### Functional Options Pattern

Use functional options for configurable constructors without breaking API compatibility.

```go
type Server struct {
    host    string
    port    int
    timeout time.Duration
    logger  *slog.Logger
}

type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func WithLogger(l *slog.Logger) Option {
    return func(s *Server) { s.logger = l }
}

func NewServer(host string, opts ...Option) *Server {
    s := &Server{
        host:    host,
        port:    8080,
        timeout: 30 * time.Second,
        logger:  slog.Default(),
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
srv := NewServer("localhost",
    WithPort(9090),
    WithTimeout(60*time.Second),
)
```

## Generics (Go 1.18+)

### Type Parameters

```go
// Generic function
func Filter[T any](s []T, pred func(T) bool) []T {
    var result []T
    for _, v := range s {
        if pred(v) {
            result = append(result, v)
        }
    }
    return result
}

// Generic struct
type Pair[T, U any] struct {
    First  T
    Second U
}

func NewPair[T, U any](first T, second U) Pair[T, U] {
    return Pair[T, U]{First: first, Second: second}
}
```

### Type Constraints

```go
// Built-in constraints (from constraints package or inline)
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 | ~string
}

// ~ allows underlying types (type aliases, defined types)
type MyInt int
// MyInt satisfies ~int but not int

// comparable constraint - supports == and !=
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s {
        if v == target {
            return true
        }
    }
    return false
}

// Method constraint
type Validator interface {
    Validate() error
}

func ValidateAll[T Validator](items []T) error {
    for _, item := range items {
        if err := item.Validate(); err != nil {
            return err
        }
    }
    return nil
}
```

### Generic Type Aliases (Go 1.24+)

```go
// Type alias with parameters
type Set[T comparable] = map[T]struct{}

// Use it
var s Set[string]
s = make(Set[string])
s["hello"] = struct{}{}
```

### When to Use Generics

Use generics for:
- Container types (sets, stacks, queues, trees)
- Utility functions operating on slices/maps of any type
- Reducing boilerplate when the same logic applies to multiple types

Avoid generics when:
- Interfaces already solve the problem cleanly
- The code only works with one or two types
- It makes the code harder to read

## Concurrency

### Goroutines

```go
// Start a goroutine
go func() {
    // runs concurrently
    result := compute()
    fmt.Println(result)
}()

// Goroutines are lightweight (~2KB initial stack)
// You can run millions of them
```

### Channels

```go
// Unbuffered channel (synchronous)
ch := make(chan string)

go func() {
    ch <- "hello" // blocks until receiver is ready
}()
msg := <-ch // blocks until sender sends

// Buffered channel (async up to capacity)
ch := make(chan int, 100)

// Directional channels (for function signatures)
func producer(out chan<- int) { out <- 42 }
func consumer(in <-chan int)  { v := <-in }

// Close and range
close(ch)
for v := range ch {
    fmt.Println(v) // iterates until channel is closed
}

// Select for multiplexing
select {
case msg := <-ch1:
    fmt.Println("from ch1:", msg)
case msg := <-ch2:
    fmt.Println("from ch2:", msg)
case <-time.After(5 * time.Second):
    fmt.Println("timeout")
}
```

### sync Package

```go
// Mutex for shared state
type SafeCounter struct {
    mu sync.Mutex
    v  map[string]int
}

func (c *SafeCounter) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.v[key]++
}

// RWMutex for read-heavy workloads
type Cache struct {
    mu    sync.RWMutex
    items map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.items[key]
    return v, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[key] = value
}

// Once for one-time initialization
var once sync.Once
var instance *DB

func GetDB() *DB {
    once.Do(func() {
        instance = connectDB()
    })
    return instance
}

// WaitGroup for waiting on goroutines
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

### Worker Pool Pattern

```go
func workerPool(ctx context.Context, jobs <-chan Job, numWorkers int) <-chan Result {
    results := make(chan Result, numWorkers)
    var wg sync.WaitGroup

    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobs {
                select {
                case <-ctx.Done():
                    return
                case results <- process(job):
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    return results
}
```

### Fan-Out/Fan-In

```go
func fanOut(ctx context.Context, input <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := 0; i < workers; i++ {
        channels[i] = worker(ctx, input)
    }
    return channels
}

func fanIn(ctx context.Context, channels ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    merged := make(chan int)

    for _, ch := range channels {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range ch {
                select {
                case <-ctx.Done():
                    return
                case merged <- v:
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(merged)
    }()

    return merged
}
```

### errgroup for Concurrent Error Handling

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]string, len(urls))

    for i, url := range urls {
        g.Go(func() error {
            body, err := fetch(ctx, url)
            if err != nil {
                return fmt.Errorf("fetching %s: %w", url, err)
            }
            results[i] = body
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

## Context

### Creating Contexts

```go
// Background context (top-level, never canceled)
ctx := context.Background()

// With cancellation
ctx, cancel := context.WithCancel(parentCtx)
defer cancel()

// With timeout (relative duration)
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()

// With deadline (absolute time)
ctx, cancel := context.WithDeadline(parentCtx, time.Now().Add(5*time.Second))
defer cancel()

// With value (use sparingly, prefer function parameters)
ctx = context.WithValue(parentCtx, requestIDKey, "abc-123")
```

### Using Context

```go
// Pass context as first parameter
func fetchUser(ctx context.Context, id string) (*User, error) {
    // Check for cancellation
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }

    // Pass to downstream calls
    row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = $1", id)
    // ...
}

// HTTP handler receives context from request
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    user, err := fetchUser(ctx, r.URL.Query().Get("id"))
    // ...
}
```

### Context Best Practices

- Always pass context as the first parameter named `ctx`
- Never store context in a struct; pass it explicitly
- Always call the cancel function (defer it immediately)
- Derive from the incoming context, never create `context.Background()` mid-chain
- Use `context.WithValue` only for request-scoped data (request IDs, auth tokens), not for function parameters
- Check `ctx.Err()` or `ctx.Done()` in long-running operations

## Iterators (Go 1.23+)

### Iterator Function Types

The `iter` package defines two function types:

```go
// Single-value iterator
type Seq[V any] func(yield func(V) bool)

// Key-value iterator
type Seq2[K, V any] func(yield func(K, V) bool)
```

### Creating Iterators

```go
// Filter iterator
func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if pred(v) {
                if !yield(v) {
                    return
                }
            }
        }
    }
}

// Map iterator
func Map[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range seq {
            if !yield(f(v)) {
                return
            }
        }
    }
}

// Limit iterator
func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i >= n {
                return
            }
            if !yield(v) {
                return
            }
            i++
        }
    }
}
```

### Standard Library Iterator Support

```go
// slices package
for i, v := range slices.All(mySlice) { }    // index, value
for v := range slices.Values(mySlice) { }     // values only
for v := range slices.Backward(mySlice) { }   // reverse order
collected := slices.Collect(myIterator)        // iterator -> slice
sorted := slices.Sorted(myIterator)            // sort values

// maps package
for k, v := range maps.All(myMap) { }         // all entries
for k := range maps.Keys(myMap) { }           // keys only
for v := range maps.Values(myMap) { }         // values only
collected := maps.Collect(mySeq2)              // iterator -> map
```

### Pull Iterators

When ranging is not natural, convert to pull-style iteration:

```go
next, stop := iter.Pull(mySeq)
defer stop()

v1, ok := next()
if !ok { return }

v2, ok := next()
if !ok { return }

// Pull2 for key-value iterators
next2, stop2 := iter.Pull2(mySeq2)
defer stop2()
```

## Struct Embedding

### Basic Embedding

```go
type Logger struct {
    Prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.Prefix, msg)
}

type Service struct {
    Logger          // Embedded (promoted methods)
    Name   string
}

s := Service{
    Logger: Logger{Prefix: "SVC"},
    Name:   "auth",
}
s.Log("started")           // Promoted from Logger
s.Logger.Log("direct call") // Also works
```

### Interface Embedding in Structs

Useful for partial interface implementation and the decorator pattern.

```go
// Wrap an interface, override specific methods
type LoggingReader struct {
    io.Reader // Embedded interface
    logger    *slog.Logger
}

func (lr *LoggingReader) Read(p []byte) (int, error) {
    n, err := lr.Reader.Read(p) // Delegate to wrapped reader
    lr.logger.Info("read", "bytes", n, "err", err)
    return n, err
}

// Still satisfies io.Reader
var _ io.Reader = (*LoggingReader)(nil)
```

### Embedding vs Named Fields

```go
// Embedding: promotes methods, acts like "is-a" (composition)
type Server struct {
    http.Handler // Server IS-A handler
}

// Named field: explicit access, acts like "has-a"
type Server struct {
    handler http.Handler // Server HAS-A handler
}

// Prefer named fields when:
// - You want to hide the embedded type's methods
// - Multiple embedded types have conflicting method names
// - The relationship is clearly "has-a"
```

## Testing Patterns

### Table-Driven Tests

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 2, 3, 5},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
        {"mixed", -1, 5, 4},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.expected {
                t.Errorf("Add(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.expected)
            }
        })
    }
}
```

### Test Helpers

```go
// t.Helper() marks a function as a test helper
// so errors report the caller's line, not the helper's
func assertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

// Cleanup function
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    assertNoError(t, err)
    t.Cleanup(func() { db.Close() })
    return db
}
```

### Subtests and Parallel Tests

```go
func TestParallel(t *testing.T) {
    tests := []struct {
        name  string
        input string
        want  string
    }{
        {"uppercase", "hello", "HELLO"},
        {"empty", "", ""},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Run subtests in parallel
            got := strings.ToUpper(tt.input)
            if got != tt.want {
                t.Errorf("got %q, want %q", got, tt.want)
            }
        })
    }
}
```

### Interface Mocking

```go
// Define interface for dependencies
type UserStore interface {
    GetUser(ctx context.Context, id string) (*User, error)
}

// Mock implementation for tests
type mockUserStore struct {
    getUser func(ctx context.Context, id string) (*User, error)
}

func (m *mockUserStore) GetUser(ctx context.Context, id string) (*User, error) {
    return m.getUser(ctx, id)
}

func TestService(t *testing.T) {
    store := &mockUserStore{
        getUser: func(ctx context.Context, id string) (*User, error) {
            if id == "123" {
                return &User{Name: "Alice"}, nil
            }
            return nil, ErrNotFound
        },
    }
    svc := NewService(store)
    user, err := svc.GetUser(context.Background(), "123")
    // assert...
}
```
