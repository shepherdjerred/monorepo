# Rust Patterns and Idioms

Common Rust patterns covering ownership, borrowing, traits, generics, lifetimes, async/await, error handling, and iterators.

## Ownership and Borrowing

### Move Semantics

Types that do not implement `Copy` are moved when assigned or passed to functions. After a move, the original binding is invalid.

```rust
let s1 = String::from("hello");
let s2 = s1;           // s1 is moved into s2
// println!("{s1}");    // Compile error: s1 has been moved

// Function parameters take ownership
fn take_ownership(s: String) {
    println!("{s}");
}   // s is dropped here

let s = String::from("hello");
take_ownership(s);
// s is no longer valid here
```

### Copy Types

Primitive types (`i32`, `f64`, `bool`, `char`) and tuples of Copy types implement `Copy`. Assignment copies instead of moves.

```rust
let x = 42;
let y = x;    // x is copied, both are valid
println!("{x} {y}");  // Works fine
```

### Borrowing Rules

1. Any number of immutable references `&T` can coexist
2. Only one mutable reference `&mut T` at a time
3. Cannot have `&T` and `&mut T` simultaneously
4. References must always be valid (no dangling refs)

```rust
let mut data = vec![1, 2, 3];

// Multiple immutable borrows - OK
let a = &data;
let b = &data;
println!("{a:?} {b:?}");

// Mutable borrow - OK after immutable borrows are done
data.push(4);

// Mutable borrow
let c = &mut data;
c.push(5);
// Cannot use `data` directly while `c` is alive
```

### Borrowing in Structs

```rust
// Struct that borrows data needs lifetime annotations
struct Excerpt<'a> {
    text: &'a str,
}

// Struct that owns data needs no lifetimes
struct OwnedExcerpt {
    text: String,
}

// Prefer owned data in structs unless there is a clear performance reason
// to borrow. Owned structs are easier to work with (no lifetime propagation).
```

### Interior Mutability

When mutation is needed behind a shared reference:

```rust
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

// Single-threaded: RefCell
let data = RefCell::new(vec![1, 2, 3]);
data.borrow_mut().push(4);

// Multi-threaded: Mutex or RwLock
let data = Arc::new(Mutex::new(vec![1, 2, 3]));
let clone = Arc::clone(&data);
std::thread::spawn(move || {
    clone.lock().unwrap().push(4);
});
```

## Traits

### Defining and Implementing Traits

```rust
trait Summary {
    // Required method
    fn summarize(&self) -> String;

    // Default implementation
    fn preview(&self) -> String {
        format!("{}...", &self.summarize()[..20])
    }
}

struct Article {
    title: String,
    content: String,
}

impl Summary for Article {
    fn summarize(&self) -> String {
        format!("{}: {}", self.title, self.content)
    }
}
```

### Trait Bounds

```rust
// impl Trait syntax (preferred for simple cases)
fn notify(item: &impl Summary) {
    println!("Breaking: {}", item.summarize());
}

// Trait bound syntax (needed for complex bounds)
fn notify<T: Summary + Display>(item: &T) {
    println!("{item}: {}", item.summarize());
}

// where clause (for readability with many bounds)
fn process<T, U>(t: &T, u: &U) -> String
where
    T: Summary + Clone,
    U: Display + Debug,
{
    format!("{}: {u:?}", t.summarize())
}

// Returning impl Trait
fn make_summary() -> impl Summary {
    Article {
        title: String::from("Title"),
        content: String::from("Content"),
    }
}
```

### Trait Objects (Dynamic Dispatch)

Use `dyn Trait` when the concrete type is not known at compile time.

```rust
// Box<dyn Trait> for owned trait objects
fn create_handler(kind: &str) -> Box<dyn Handler> {
    match kind {
        "file" => Box::new(FileHandler),
        "network" => Box::new(NetworkHandler),
        _ => Box::new(DefaultHandler),
    }
}

// &dyn Trait for borrowed trait objects
fn process(handler: &dyn Handler) {
    handler.handle();
}

// Vec of trait objects
let handlers: Vec<Box<dyn Handler>> = vec![
    Box::new(FileHandler),
    Box::new(NetworkHandler),
];
```

Trade-offs:

- Generics (`impl Trait`): monomorphized, zero-cost, larger binary, known at compile time
- Trait objects (`dyn Trait`): vtable dispatch, smaller binary, runtime polymorphism

### Trait Upcasting (Rust 1.86+)

```rust
trait Base {
    fn base_method(&self);
}

trait Extended: Base {
    fn extended_method(&self);
}

// Coerce &dyn Extended to &dyn Base directly
fn use_base(obj: &dyn Extended) {
    let base: &dyn Base = obj;  // Trait upcasting, no workaround needed
    base.base_method();
}
```

### Common Standard Library Traits

| Trait                | Purpose                                 | Derive?                  |
| -------------------- | --------------------------------------- | ------------------------ |
| `Debug`              | Debug formatting `{:?}`                 | Yes                      |
| `Clone`              | Explicit duplication                    | Yes                      |
| `Copy`               | Implicit copy on assign                 | Yes (if all fields Copy) |
| `PartialEq` / `Eq`   | Equality comparison                     | Yes                      |
| `PartialOrd` / `Ord` | Ordering comparison                     | Yes                      |
| `Hash`               | Hashing for HashMap/HashSet             | Yes                      |
| `Default`            | Default value                           | Yes                      |
| `Display`            | User-facing formatting                  | No (implement manually)  |
| `From` / `Into`      | Type conversion                         | No                       |
| `Iterator`           | Iteration protocol                      | No                       |
| `Drop`               | Custom destructor logic                 | No                       |
| `Send`               | Safe to transfer across threads         | Auto                     |
| `Sync`               | Safe to share references across threads | Auto                     |

## Generics

### Generic Functions

```rust
fn largest<T: PartialOrd>(list: &[T]) -> &T {
    let mut largest = &list[0];
    for item in &list[1..] {
        if item > largest {
            largest = item;
        }
    }
    largest
}
```

### Generic Structs

```rust
struct Point<T> {
    x: T,
    y: T,
}

impl<T> Point<T> {
    fn new(x: T, y: T) -> Self {
        Self { x, y }
    }
}

// Constrained impl block
impl<T: std::ops::Add<Output = T> + Copy> Point<T> {
    fn sum(&self) -> T {
        self.x + self.y
    }
}

// Impl for specific type
impl Point<f64> {
    fn distance_from_origin(&self) -> f64 {
        (self.x.powi(2) + self.y.powi(2)).sqrt()
    }
}
```

### Generic Enums

```rust
// The standard library's Result and Option are generic enums
enum MyResult<T, E> {
    Ok(T),
    Err(E),
}

// Newtype pattern with generics
struct Meters<T>(T);
struct Seconds<T>(T);
```

### Const Generics

```rust
// Array with compile-time known size
struct Matrix<const ROWS: usize, const COLS: usize> {
    data: [[f64; COLS]; ROWS],
}

impl<const ROWS: usize, const COLS: usize> Matrix<ROWS, COLS> {
    fn new() -> Self {
        Self {
            data: [[0.0; COLS]; ROWS],
        }
    }
}

let m: Matrix<3, 4> = Matrix::new();
```

## Lifetimes

### Lifetime Elision Rules

The compiler infers lifetimes following these rules:

1. Each input reference gets a distinct lifetime
2. If there is exactly one input lifetime, it applies to all output references
3. If one input is `&self` or `&mut self`, its lifetime applies to all output references

```rust
// Elided (compiler infers lifetimes)
fn first_word(s: &str) -> &str { ... }

// Equivalent explicit form
fn first_word<'a>(s: &'a str) -> &'a str { ... }
```

### When Explicit Lifetimes Are Needed

```rust
// Multiple input references - compiler cannot determine which output borrows from
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

// Different lifetimes for different inputs
fn first_of<'a, 'b>(x: &'a str, _y: &'b str) -> &'a str {
    x
}
```

### Lifetime Bounds on Structs

```rust
struct ImportantExcerpt<'a> {
    part: &'a str,
}

impl<'a> ImportantExcerpt<'a> {
    // Lifetime elision rule 3: &self lifetime applies to output
    fn level(&self) -> &str {
        self.part
    }
}
```

### Static Lifetime

```rust
// 'static means the reference lives for the entire program
let s: &'static str = "I live forever";

// Trait bounds with 'static
fn spawn_task(task: impl FnOnce() + Send + 'static) {
    std::thread::spawn(task);
}
```

## Error Handling

### The `?` Operator

```rust
use std::fs;
use std::io;

fn read_username() -> Result<String, io::Error> {
    let mut username = fs::read_to_string("username.txt")?;
    username.truncate(username.trim_end().len());
    Ok(username)
}
```

### Custom Error Types with thiserror

```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation failed: {field} - {message}")]
    Validation { field: String, message: String },
}
```

### Application-Level Errors with anyhow

```rust
use anyhow::{Context, Result, bail, ensure};

fn process_config(path: &str) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .context("Failed to read config file")?;

    let config: Config = serde_json::from_str(&content)
        .context("Failed to parse config")?;

    ensure!(config.port > 0, "Port must be positive, got {}", config.port);

    if config.name.is_empty() {
        bail!("Config name cannot be empty");
    }

    Ok(config)
}
```

### When to Use Each

- **thiserror**: Library code. Define specific error variants callers can match on.
- **anyhow**: Application code. Aggregate errors with context for logging/display.
- **Custom enum without thiserror**: When no external dependency is desired.

### Converting Between Error Types

```rust
// From trait implementations (thiserror does this with #[from])
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err)
    }
}

// map_err for manual conversion
let value = some_result.map_err(|e| AppError::NotFound(e.to_string()))?;
```

## Async/Await

### Basic Async Pattern

```rust
use tokio;

#[tokio::main]
async fn main() {
    let result = fetch_data("https://api.example.com").await;
    println!("{result:?}");
}

async fn fetch_data(url: &str) -> Result<String, reqwest::Error> {
    let response = reqwest::get(url).await?;
    let body = response.text().await?;
    Ok(body)
}
```

### Spawning Tasks

```rust
use tokio::task;

// Spawn concurrent tasks
let handle1 = task::spawn(async { fetch_users().await });
let handle2 = task::spawn(async { fetch_orders().await });

// Await both
let (users, orders) = tokio::join!(handle1, handle2);

// select! for first-to-complete
tokio::select! {
    result = fetch_fast() => println!("Fast: {result:?}"),
    result = fetch_slow() => println!("Slow: {result:?}"),
}
```

### Async Closures (Rust 1.85+)

```rust
// New in 2024 edition: async closures
let fetch = async |url: &str| {
    reqwest::get(url).await?.text().await
};

let body = fetch("https://example.com").await?;
```

### Channels

```rust
use tokio::sync::mpsc;

let (tx, mut rx) = mpsc::channel(100);

tokio::spawn(async move {
    tx.send("hello").await.unwrap();
});

while let Some(msg) = rx.recv().await {
    println!("Got: {msg}");
}
```

### Handling Blocking Code in Async Context

```rust
// Move blocking work to a dedicated thread pool
let result = tokio::task::spawn_blocking(|| {
    // CPU-intensive or blocking I/O work here
    expensive_computation()
}).await?;
```

### Async Testing

```rust
#[tokio::test]
async fn test_fetch() {
    let result = fetch_data("https://httpbin.org/get").await;
    assert!(result.is_ok());
}

// With timeout
#[tokio::test]
async fn test_with_timeout() {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        fetch_data("https://example.com"),
    ).await;
    assert!(result.is_ok());
}
```

## Iterator Patterns

### Creating Iterators

```rust
// From collections
let v = vec![1, 2, 3];
let iter = v.iter();          // yields &i32
let iter = v.iter_mut();      // yields &mut i32
let iter = v.into_iter();     // yields i32 (consumes vec)

// Range
let range = 0..10;            // 0 to 9
let inclusive = 0..=10;       // 0 to 10
```

### Common Adapters

```rust
let numbers = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// filter + map
let even_doubled: Vec<i32> = numbers.iter()
    .filter(|&&n| n % 2 == 0)
    .map(|&n| n * 2)
    .collect();
// [4, 8, 12, 16, 20]

// filter_map (filter + map combined)
let parsed: Vec<i32> = ["1", "two", "3", "four", "5"]
    .iter()
    .filter_map(|s| s.parse().ok())
    .collect();
// [1, 3, 5]

// flat_map
let words: Vec<&str> = vec!["hello world", "foo bar"]
    .iter()
    .flat_map(|s| s.split_whitespace())
    .collect();
// ["hello", "world", "foo", "bar"]

// take, skip, chain
let first_three: Vec<&i32> = numbers.iter().take(3).collect();
let after_five: Vec<&i32> = numbers.iter().skip(5).collect();
let combined: Vec<i32> = (0..3).chain(7..10).collect();

// enumerate, zip
for (i, val) in numbers.iter().enumerate() {
    println!("{i}: {val}");
}

let keys = vec!["a", "b", "c"];
let vals = vec![1, 2, 3];
let pairs: Vec<_> = keys.iter().zip(vals.iter()).collect();

// windows, chunks
for window in numbers.windows(3) {
    println!("{window:?}");
}
for chunk in numbers.chunks(3) {
    println!("{chunk:?}");
}
```

### Consuming Iterators

```rust
// collect into various types
let vec: Vec<i32> = (0..5).collect();
let set: HashSet<i32> = (0..5).collect();
let map: HashMap<&str, i32> = vec![("a", 1), ("b", 2)].into_iter().collect();
let string: String = vec!['h', 'e', 'l', 'l', 'o'].into_iter().collect();

// fold (reduce with initial value)
let sum = numbers.iter().fold(0, |acc, &x| acc + x);

// sum, product, min, max, count
let sum: i32 = numbers.iter().sum();
let product: i32 = numbers.iter().product();
let min = numbers.iter().min();
let max = numbers.iter().max();
let count = numbers.iter().count();

// any, all, find, position
let has_even = numbers.iter().any(|&n| n % 2 == 0);
let all_positive = numbers.iter().all(|&n| n > 0);
let first_even = numbers.iter().find(|&&n| n % 2 == 0);
let pos = numbers.iter().position(|&n| n == 5);
```

### Implementing Iterator

```rust
struct Counter {
    count: u32,
    max: u32,
}

impl Counter {
    fn new(max: u32) -> Self {
        Self { count: 0, max }
    }
}

impl Iterator for Counter {
    type Item = u32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.count < self.max {
            self.count += 1;
            Some(self.count)
        } else {
            None
        }
    }
}

// Use it
let sum: u32 = Counter::new(5).sum();  // 1+2+3+4+5 = 15
```

## Pattern Matching

### Match Expressions

```rust
// Match on enums
match command {
    Command::Quit => println!("Quitting"),
    Command::Echo(msg) => println!("{msg}"),
    Command::Move { x, y } => println!("Moving to ({x}, {y})"),
    Command::Color(r, g, b) => println!("Color: ({r}, {g}, {b})"),
}

// Match with guards
match number {
    n if n < 0 => println!("Negative"),
    0 => println!("Zero"),
    n if n % 2 == 0 => println!("Positive even"),
    _ => println!("Positive odd"),
}

// Match on tuples
match (x, y) {
    (0, 0) => println!("Origin"),
    (x, 0) | (0, x) => println!("On axis: {x}"),
    (x, y) => println!("Point: ({x}, {y})"),
}

// Destructuring in match
match &person {
    Person { name, age } if *age >= 18 => println!("{name} is an adult"),
    Person { name, .. } => println!("{name} is a minor"),
}
```

### Let Chains (Rust 2024 Edition)

```rust
// Combine let bindings with boolean conditions
if let Some(x) = opt_x && let Some(y) = opt_y && x > y {
    println!("x ({x}) is greater than y ({y})");
}

// In while loops
while let Some(item) = iter.next() && item.is_valid() {
    process(item);
}
```

## Smart Pointers

```rust
// Box<T> - heap allocation
let boxed = Box::new(5);

// Rc<T> - reference counted (single-threaded)
use std::rc::Rc;
let shared = Rc::new(vec![1, 2, 3]);
let clone = Rc::clone(&shared);  // Increments ref count

// Arc<T> - atomic reference counted (multi-threaded)
use std::sync::Arc;
let shared = Arc::new(Mutex::new(HashMap::new()));

// Cow<T> - clone-on-write
use std::borrow::Cow;
fn process(input: &str) -> Cow<str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input)
    }
}
```

## Type Conversions

```rust
// From/Into
impl From<Config> for String {
    fn from(config: Config) -> Self {
        format!("{}:{}", config.name, config.port)
    }
}

let s: String = config.into();

// TryFrom/TryInto for fallible conversions
impl TryFrom<&str> for Config {
    type Error = ParseError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        // parse the string into Config
        todo!()
    }
}

// AsRef / AsMut for cheap reference conversions
fn process(path: impl AsRef<std::path::Path>) {
    let path = path.as_ref();
    // works with &str, String, PathBuf, &Path
}
```
