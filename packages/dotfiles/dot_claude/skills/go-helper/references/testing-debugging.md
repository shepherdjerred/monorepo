# Testing and Debugging Go

Guide to go test, table-driven tests, benchmarks, fuzzing, testify, the delve debugger, profiling with pprof, and the race detector.

## Testing with go test

### Basic Usage

```bash
# Run all tests
go test ./...

# Run tests in specific package
go test ./pkg/mypackage

# Run specific test function
go test -run TestMyFunction ./...
go test -run TestMyFunction/subtest_name ./...

# Verbose output
go test -v ./...

# Short mode (skip long tests)
go test -short ./...

# Run with count (disable caching)
go test -count=1 ./...

# Set timeout
go test -timeout 120s ./...

# Parallel test limit
go test -parallel 4 ./...

# List tests without running
go test -list '.*' ./...

# Show test binary output
go test -v -count=1 ./...

# JSON output
go test -json ./...
```

### Test Organization

```go
// Unit tests: same package, same file or _test.go suffix
// File: calculator.go
package calculator

func Add(a, b int) int { return a + b }

// File: calculator_test.go
package calculator

import "testing"

func TestAdd(t *testing.T) {
    if got := Add(2, 3); got != 5 {
        t.Errorf("Add(2, 3) = %d, want 5", got)
    }
}
```

```go
// Black-box tests: test the public API from outside
// File: calculator_test.go
package calculator_test

import (
    "testing"
    "github.com/user/project/calculator"
)

func TestAdd(t *testing.T) {
    if got := calculator.Add(2, 3); got != 5 {
        t.Errorf("Add(2, 3) = %d, want 5", got)
    }
}
```

### Integration Tests

```go
// tests/integration_test.go
//go:build integration

package tests

import "testing"

func TestDatabaseIntegration(t *testing.T) {
    // Only runs with: go test -tags integration ./tests/
    db := connectTestDB(t)
    // ...
}
```

### TestMain

Use `TestMain` for setup/teardown that applies to all tests in a package.

```go
func TestMain(m *testing.M) {
    // Setup
    db := setupTestDB()

    // Run tests
    code := m.Run()

    // Teardown
    db.Close()
    os.Exit(code)
}
```

### Test Helpers and Cleanup

```go
func setupServer(t *testing.T) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status":"ok"}`))
    }))
    t.Cleanup(func() { srv.Close() })
    return srv
}

// TempDir creates a temp directory cleaned up after test
func TestFileOps(t *testing.T) {
    dir := t.TempDir() // auto-cleaned after test
    path := filepath.Join(dir, "test.txt")
    os.WriteFile(path, []byte("hello"), 0644)
    // ...
}
```

## Table-Driven Tests

The idiomatic Go testing pattern: define test cases as data, loop through them.

### Basic Table-Driven Test

```go
func TestParseSize(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    int64
        wantErr bool
    }{
        {name: "bytes", input: "100B", want: 100},
        {name: "kilobytes", input: "1KB", want: 1024},
        {name: "megabytes", input: "5MB", want: 5 * 1024 * 1024},
        {name: "empty", input: "", wantErr: true},
        {name: "invalid", input: "abc", wantErr: true},
        {name: "negative", input: "-1KB", wantErr: true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseSize(tt.input)
            if (err != nil) != tt.wantErr {
                t.Fatalf("ParseSize(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("ParseSize(%q) = %d, want %d", tt.input, got, tt.want)
            }
        })
    }
}
```

### Parallel Table-Driven Tests

```go
func TestSlugify(t *testing.T) {
    tests := map[string]struct {
        input string
        want  string
    }{
        "simple":       {input: "Hello World", want: "hello-world"},
        "special chars": {input: "Hello, World!", want: "hello-world"},
        "multiple spaces": {input: "hello   world", want: "hello-world"},
        "already slug":  {input: "hello-world", want: "hello-world"},
    }

    for name, tt := range tests {
        t.Run(name, func(t *testing.T) {
            t.Parallel()
            got := Slugify(tt.input)
            if got != tt.want {
                t.Errorf("Slugify(%q) = %q, want %q", tt.input, got, tt.want)
            }
        })
    }
}
```

### Table Tests with Complex Setup

```go
func TestHTTPHandler(t *testing.T) {
    tests := []struct {
        name       string
        method     string
        path       string
        body       string
        wantStatus int
        wantBody   string
    }{
        {
            name:       "get existing",
            method:     http.MethodGet,
            path:       "/users/1",
            wantStatus: http.StatusOK,
            wantBody:   `{"id":"1","name":"Alice"}`,
        },
        {
            name:       "get missing",
            method:     http.MethodGet,
            path:       "/users/999",
            wantStatus: http.StatusNotFound,
        },
        {
            name:       "create user",
            method:     http.MethodPost,
            path:       "/users",
            body:       `{"name":"Bob"}`,
            wantStatus: http.StatusCreated,
        },
    }

    handler := NewRouter()

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            var body io.Reader
            if tt.body != "" {
                body = strings.NewReader(tt.body)
            }
            req := httptest.NewRequest(tt.method, tt.path, body)
            rec := httptest.NewRecorder()

            handler.ServeHTTP(rec, req)

            if rec.Code != tt.wantStatus {
                t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
            }
            if tt.wantBody != "" && strings.TrimSpace(rec.Body.String()) != tt.wantBody {
                t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
            }
        })
    }
}
```

## Benchmarks

### Writing Benchmarks

```go
func BenchmarkFibonacci(b *testing.B) {
    for b.Loop() {
        Fibonacci(20)
    }
}

// Benchmark with different inputs
func BenchmarkSort(b *testing.B) {
    sizes := []int{10, 100, 1000, 10000}
    for _, size := range sizes {
        b.Run(fmt.Sprintf("size_%d", size), func(b *testing.B) {
            data := generateRandomSlice(size)
            b.ResetTimer()
            for b.Loop() {
                sorted := make([]int, len(data))
                copy(sorted, data)
                sort.Ints(sorted)
            }
        })
    }
}

// Report memory allocations
func BenchmarkConcat(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        var s string
        for i := 0; i < 100; i++ {
            s += "x"
        }
    }
}

func BenchmarkBuilder(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        var sb strings.Builder
        for i := 0; i < 100; i++ {
            sb.WriteString("x")
        }
        _ = sb.String()
    }
}
```

### Running Benchmarks

```bash
# Run all benchmarks
go test -bench=. ./...

# Run specific benchmark
go test -bench=BenchmarkFibonacci ./...

# With memory allocation stats
go test -bench=. -benchmem ./...

# Run N times for stable results
go test -bench=. -count=5 ./...

# Set benchmark time
go test -bench=. -benchtime=5s ./...
go test -bench=. -benchtime=10000x ./...  # Exact iterations

# Compare benchmarks (using benchstat)
go test -bench=. -count=10 ./... > old.txt
# Make changes...
go test -bench=. -count=10 ./... > new.txt
go install golang.org/x/perf/cmd/benchstat@latest
benchstat old.txt new.txt
```

### Benchmark Output

```
BenchmarkSort/size_10-8        5000000    230 ns/op    80 B/op    1 allocs/op
BenchmarkSort/size_100-8        500000   3200 ns/op   896 B/op    1 allocs/op
BenchmarkSort/size_1000-8        30000  42000 ns/op  8192 B/op    1 allocs/op
```

## Fuzzing (Go 1.18+)

### Writing Fuzz Tests

```go
func FuzzParseJSON(f *testing.F) {
    // Seed corpus: known-good inputs
    f.Add([]byte(`{"name":"alice"}`))
    f.Add([]byte(`{"name":"bob","age":30}`))
    f.Add([]byte(`{}`))
    f.Add([]byte(`[]`))

    f.Fuzz(func(t *testing.T, data []byte) {
        var result map[string]any
        err := json.Unmarshal(data, &result)
        if err != nil {
            return // Invalid input is fine, just skip
        }
        // If we could unmarshal, we should be able to marshal back
        encoded, err := json.Marshal(result)
        if err != nil {
            t.Errorf("failed to re-marshal: %v", err)
        }
        // Round-trip should produce valid JSON
        var result2 map[string]any
        if err := json.Unmarshal(encoded, &result2); err != nil {
            t.Errorf("round-trip failed: %v", err)
        }
    })
}

func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Add("12345")

    f.Fuzz(func(t *testing.T, s string) {
        reversed := Reverse(s)
        doubleReversed := Reverse(reversed)
        if s != doubleReversed {
            t.Errorf("Reverse(Reverse(%q)) = %q", s, doubleReversed)
        }
        if len(s) != len(reversed) {
            t.Errorf("len mismatch: %d != %d", len(s), len(reversed))
        }
    })
}
```

### Running Fuzz Tests

```bash
# Run fuzz test for 30 seconds
go test -fuzz=FuzzParseJSON -fuzztime=30s ./...

# Run until failure
go test -fuzz=FuzzParseJSON ./...

# Run as regular test (seed corpus only)
go test -run=FuzzParseJSON ./...

# Fuzz with specific parallelism
go test -fuzz=FuzzReverse -fuzztime=1m -parallel=4 ./...
```

### Corpus Management

Failing inputs are saved to `testdata/fuzz/<FuncName>/` and automatically included in future test runs:

```
testdata/
  fuzz/
    FuzzParseJSON/
      corpus/
        abc123    # Auto-generated failing input
      seed/       # Optional: manually added seeds
```

## Testify

### Assertions

```go
import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestWithTestify(t *testing.T) {
    // assert: test continues on failure
    assert.Equal(t, 5, Add(2, 3))
    assert.NotNil(t, result)
    assert.True(t, ok)
    assert.Contains(t, "hello world", "hello")
    assert.Len(t, items, 3)
    assert.Empty(t, emptySlice)
    assert.Error(t, err)
    assert.ErrorIs(t, err, ErrNotFound)
    assert.ErrorAs(t, err, &targetErr)
    assert.NoError(t, err)
    assert.InDelta(t, 3.14, pi, 0.01)
    assert.Eventually(t, func() bool { return ready }, time.Second, 10*time.Millisecond)

    // require: test stops immediately on failure (uses t.FailNow)
    require.NoError(t, err)   // Stop if error, no point continuing
    require.NotNil(t, result) // Stop if nil, would panic below
    assert.Equal(t, "Alice", result.Name) // Fine to continue
}
```

### Mocks

```go
import "github.com/stretchr/testify/mock"

type MockStore struct {
    mock.Mock
}

func (m *MockStore) Get(ctx context.Context, id string) (*Item, error) {
    args := m.Called(ctx, id)
    if args.Get(0) == nil {
        return nil, args.Error(1)
    }
    return args.Get(0).(*Item), args.Error(1)
}

func TestService(t *testing.T) {
    store := new(MockStore)
    store.On("Get", mock.Anything, "123").Return(&Item{Name: "test"}, nil)
    store.On("Get", mock.Anything, "999").Return(nil, ErrNotFound)

    svc := NewService(store)

    item, err := svc.GetItem(ctx, "123")
    require.NoError(t, err)
    assert.Equal(t, "test", item.Name)

    _, err = svc.GetItem(ctx, "999")
    assert.ErrorIs(t, err, ErrNotFound)

    store.AssertExpectations(t)
}
```

### go-cmp for Deep Comparison

```go
import "github.com/google/go-cmp/cmp"

func TestDeepEqual(t *testing.T) {
    got := fetchConfig()
    want := &Config{Name: "test", Port: 8080}

    if diff := cmp.Diff(want, got); diff != "" {
        t.Errorf("config mismatch (-want +got):\n%s", diff)
    }
}
```

## Delve Debugger

### Installation

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
```

### Starting Delve

```bash
# Debug current package
dlv debug ./cmd/myapp

# Debug with arguments
dlv debug ./cmd/myapp -- --config config.yaml

# Debug test
dlv test ./pkg/mypackage
dlv test ./pkg/mypackage -- -run TestMyFunction

# Attach to running process
dlv attach <pid>

# Debug core dump
dlv core ./myapp core.dump

# Run in headless mode (for IDE integration)
dlv debug --headless --listen=:2345 --api-version=2 ./cmd/myapp
```

### Delve Commands

```
# Breakpoints
break main.main                  # Set by function name
break main.go:42                 # Set by file:line
break mypackage.MyFunc           # Set in package
condition 1 x > 10               # Conditional breakpoint
breakpoints                      # List breakpoints
clear 1                          # Remove breakpoint
clearall                         # Remove all breakpoints

# Execution
continue (c)                     # Run until breakpoint
next (n)                         # Step over
step (s)                         # Step into
stepout                          # Step out of current function
restart (r)                      # Restart program

# Inspection
print (p) variableName           # Print variable
locals                           # Show all local variables
args                             # Show function arguments
whatis variableName              # Show type of variable
set variableName = value         # Modify variable

# Stack
stack (bt)                       # Print stack trace
frame 2                          # Switch to stack frame
up                               # Move up stack frame
down                             # Move down stack frame

# Goroutines
goroutines                       # List all goroutines
goroutine 5                      # Switch to goroutine 5
goroutines -t                    # Show goroutine stack traces

# Threads
threads                          # List threads
thread 3                         # Switch to thread
```

### VS Code Integration

Install the Go extension. It uses delve automatically. Add launch configuration:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch Package",
            "type": "go",
            "request": "launch",
            "mode": "auto",
            "program": "${workspaceFolder}/cmd/myapp",
            "args": ["--config", "config.yaml"]
        },
        {
            "name": "Debug Test",
            "type": "go",
            "request": "launch",
            "mode": "test",
            "program": "${workspaceFolder}/pkg/mypackage",
            "args": ["-test.run", "TestMyFunction"]
        }
    ]
}
```

## Profiling with pprof

### Adding pprof to Your Application

```go
import (
    "net/http"
    _ "net/http/pprof" // Register pprof handlers
)

func main() {
    // Start pprof server on separate port
    go func() {
        http.ListenAndServe("localhost:6060", nil)
    }()

    // Your application code...
}
```

### Collecting Profiles

```bash
# CPU profile (30 seconds by default)
go tool pprof http://localhost:6060/debug/pprof/profile
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=60

# Heap (memory) profile
go tool pprof http://localhost:6060/debug/pprof/heap

# Goroutine profile
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Block profile (contention)
go tool pprof http://localhost:6060/debug/pprof/block

# Mutex profile
go tool pprof http://localhost:6060/debug/pprof/mutex

# Allocs profile (all past allocations)
go tool pprof http://localhost:6060/debug/pprof/allocs

# Thread creation profile
go tool pprof http://localhost:6060/debug/pprof/threadcreate
```

### Profiling Tests

```bash
# CPU profile from tests
go test -cpuprofile=cpu.prof -bench=. ./...
go tool pprof cpu.prof

# Memory profile from tests
go test -memprofile=mem.prof -bench=. ./...
go tool pprof mem.prof

# Block profile
go test -blockprofile=block.prof ./...

# Mutex profile
go test -mutexprofile=mutex.prof ./...
```

### pprof Interactive Commands

```
# Top functions by CPU/memory
top
top 20
top -cum  # Cumulative (including callees)

# Show specific function
list functionName

# Show call graph as text
tree

# Generate visualization
web          # Open in browser (requires graphviz)
svg          # Generate SVG

# Filter
top -cum -nodecount=20 -focus=mypackage
```

### Web UI

```bash
# Open interactive web UI with flame graph (Go 1.26: opens flame graph by default)
go tool pprof -http=:8080 cpu.prof
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap

# Compare two profiles
go tool pprof -diff_base=old.prof new.prof
```

### Execution Tracer

```bash
# Collect trace
curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5

# From tests
go test -trace=trace.out ./...

# View trace
go tool trace trace.out
```

The trace viewer shows:
- Goroutine scheduling and blocking
- System calls
- GC events
- Network I/O
- Heap allocation

### Flight Recorder (Go 1.25+)

```go
import "runtime/trace"

fr := trace.NewFlightRecorder()
fr.Start()

// When something interesting happens...
fr.WriteTo(file) // Snapshot the ring buffer
```

## Race Detector

### Using the Race Detector

```bash
# Build with race detector
go build -race ./...

# Test with race detector
go test -race ./...

# Run with race detector
go run -race ./cmd/myapp
```

### What It Detects

The race detector finds data races: concurrent unsynchronized access to shared memory where at least one access is a write.

```go
// This has a data race:
var count int
go func() { count++ }()
go func() { count++ }()

// Fixed with mutex:
var mu sync.Mutex
var count int
go func() { mu.Lock(); count++; mu.Unlock() }()
go func() { mu.Lock(); count++; mu.Unlock() }()

// Or atomic:
var count atomic.Int64
go func() { count.Add(1) }()
go func() { count.Add(1) }()
```

### Race Detector Notes

- Adds ~5-10x CPU overhead and ~5-10x memory overhead
- Only detects races that actually occur during execution (not all possible races)
- Always run `go test -race` in CI
- No false positives: if it reports a race, there is one
- Set `GORACE` environment variable for options:

```bash
# Log to file
GORACE="log_path=/tmp/race.log" go test -race ./...

# Halt on first race
GORACE="halt_on_error=1" go test -race ./...

# History size (default 1, increase for better stack traces)
GORACE="history_size=5" go test -race ./...
```

## testing/synctest (Go 1.25+)

For testing concurrent code with a fake clock:

```go
import "testing/synctest"

func TestTimeout(t *testing.T) {
    synctest.Run(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()

        done := make(chan struct{})
        go func() {
            // Simulate work
            time.Sleep(3 * time.Second) // Uses fake clock
            close(done)
        }()

        select {
        case <-done:
            // Work completed before timeout
        case <-ctx.Done():
            t.Fatal("unexpected timeout")
        }
    })
}
```

## CI/CD Testing Pattern

### GitHub Actions

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.26'

      - name: Vet
        run: go vet ./...

      - name: Lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest

      - name: Test
        run: go test -race -coverprofile=coverage.out ./...

      - name: Coverage
        run: go tool cover -func=coverage.out

      - name: Build
        run: go build ./...
```
