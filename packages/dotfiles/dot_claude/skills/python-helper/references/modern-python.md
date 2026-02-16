# Modern Python Patterns

Comprehensive guide to modern Python features from 3.10 through 3.14: type hints, dataclasses, structural pattern matching, async/await, protocols, f-strings, exception groups, and more.

## Type Hints (3.10+ Modern Syntax)

### Union Types with `|` (3.10+)

The pipe operator replaces `Union` and `Optional` from `typing`:

```python
# Modern (3.10+, preferred)
def process(value: int | str) -> None: ...
def find(name: str) -> User | None: ...

# Legacy (still works, needed for older Python)
from typing import Union, Optional
def process(value: Union[int, str]) -> None: ...
def find(name: str) -> Optional[User]: ...
```

Use `X | None` instead of `Optional[X]` everywhere in 3.10+ code.

### Type Parameter Syntax (3.12+)

PEP 695 introduced a compact syntax for generics:

```python
# Modern (3.12+)
def first[T](items: list[T]) -> T:
    return items[0]

class Stack[T]:
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        return self._items.pop()

# Bounded type variables
def longest[T: str](a: T, b: T) -> T:
    return a if len(a) >= len(b) else b

# Constrained type variables
def add[T: (int, float)](a: T, b: T) -> T:
    return a + b

# Legacy (pre-3.12)
from typing import TypeVar, Generic
T = TypeVar('T')
class Stack(Generic[T]):
    ...
```

### Type Aliases with `type` Statement (3.12+)

```python
# Modern (3.12+)
type Vector = list[float]
type Matrix = list[Vector]
type Result[T] = T | None
type Handler[**P] = Callable[P, Awaitable[None]]
type Pair[T, U] = tuple[T, U]

# These support forward references naturally
type Tree[T] = T | list[Tree[T]]

# Legacy
from typing import TypeAlias
Vector: TypeAlias = list[float]
```

### TypeGuard and TypeIs

`TypeGuard` (3.10+) and `TypeIs` (3.13+) enable custom type narrowing:

```python
from typing import TypeGuard, TypeIs

# TypeGuard: narrowing assertion (output type may differ from input)
def is_str_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)

def process(items: list[object]) -> None:
    if is_str_list(items):
        # items is now list[str]
        print(" ".join(items))

# TypeIs (3.13+, preferred): narrowed type must be subtype of input
def is_positive_int(val: int | str) -> TypeIs[int]:
    return isinstance(val, int) and val > 0

def handle(val: int | str) -> None:
    if is_positive_int(val):
        # val narrowed to int
        print(val + 1)
    else:
        # val narrowed to str (the complement)
        print(val.upper())
```

`TypeIs` is preferred over `TypeGuard` in 3.13+ because it narrows both branches.

### ParamSpec and Concatenate

Preserve callable signatures in decorators:

```python
from typing import ParamSpec, Concatenate
from collections.abc import Callable
from functools import wraps

P = ParamSpec('P')

def log_call[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper

@log_call
def add(a: int, b: int) -> int:
    return a + b

# Concatenate: prepend parameters
def with_request[**P, R](
    func: Callable[Concatenate[Request, P], R]
) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(get_request(), *args, **kwargs)
    return wrapper
```

### Protocol (Structural Subtyping)

Define interfaces without inheritance:

```python
from typing import Protocol, runtime_checkable

class Renderable(Protocol):
    def render(self) -> str: ...

class Widget:
    def render(self) -> str:
        return "<widget/>"

# Widget satisfies Renderable without inheriting it
def display(item: Renderable) -> None:
    print(item.render())

display(Widget())  # Works - structural typing

# runtime_checkable enables isinstance() checks
@runtime_checkable
class Closable(Protocol):
    def close(self) -> None: ...

import io
assert isinstance(io.StringIO(), Closable)
```

### Literal, Final, ClassVar

```python
from typing import Literal, Final, ClassVar

# Literal: restrict to specific values
type Direction = Literal["north", "south", "east", "west"]
type HttpMethod = Literal["GET", "POST", "PUT", "DELETE"]

def move(direction: Direction) -> None: ...

# Final: immutable binding
MAX_RETRIES: Final = 3
MAX_RETRIES = 5  # Type error

# ClassVar: class-level only
class Config:
    default_timeout: ClassVar[int] = 30   # Class variable
    name: str                              # Instance variable
```

### Annotated and Self

```python
from typing import Annotated, Self

# Annotated: attach metadata to types (used by Pydantic, FastAPI, etc.)
from pydantic import Field
class User:
    name: Annotated[str, Field(min_length=1, max_length=100)]
    age: Annotated[int, Field(ge=0, le=150)]

# Self (3.11+): return type for fluent APIs and builders
class QueryBuilder:
    def where(self, condition: str) -> Self:
        self._conditions.append(condition)
        return self

    def limit(self, n: int) -> Self:
        self._limit = n
        return self
```

### ReadOnly TypedDict (3.13+)

```python
from typing import TypedDict, ReadOnly

class Config(TypedDict):
    name: ReadOnly[str]     # Cannot be modified
    debug: bool             # Can be modified

def update(config: Config) -> None:
    config["debug"] = True    # OK
    config["name"] = "new"    # Type error
```

### TypeVarTuple (Variadic Generics)

```python
from typing import TypeVarTuple, Unpack

Ts = TypeVarTuple('Ts')

def head[T, *Ts](first: T, *rest: *Ts) -> T:
    return first

# TypedDict for **kwargs (3.12+)
from typing import TypedDict, Unpack

class Options(TypedDict, total=False):
    timeout: int
    retries: int

def fetch(url: str, **kwargs: Unpack[Options]) -> str: ...
```

## Dataclasses

### Basic Usage

```python
from dataclasses import dataclass, field

@dataclass
class User:
    name: str
    email: str
    age: int = 0
    tags: list[str] = field(default_factory=list)

user = User("Alice", "alice@example.com", 30)
print(user)  # User(name='Alice', email='alice@example.com', age=30, tags=[])
```

### Frozen (Immutable) Dataclasses

```python
@dataclass(frozen=True)
class Point:
    x: float
    y: float

p = Point(1.0, 2.0)
p.x = 3.0  # Raises FrozenInstanceError
```

### Slots for Memory Efficiency

```python
@dataclass(slots=True)
class Measurement:
    timestamp: float
    value: float
    unit: str
```

`slots=True` (3.10+) generates `__slots__`, preventing arbitrary attribute assignment, reducing memory, and slightly improving access speed.

### Keyword-Only Fields

```python
from dataclasses import dataclass, KW_ONLY

@dataclass
class Request:
    url: str
    _: KW_ONLY
    method: str = "GET"
    timeout: int = 30
    headers: dict[str, str] = field(default_factory=dict)

# url is positional, rest are keyword-only
req = Request("https://api.example.com", method="POST", timeout=10)
```

### Post-Init Processing

```python
@dataclass
class Rectangle:
    width: float
    height: float
    area: float = field(init=False)

    def __post_init__(self) -> None:
        self.area = self.width * self.height
```

### InitVar for Init-Only Parameters

```python
from dataclasses import dataclass, InitVar

@dataclass
class Connection:
    host: str
    port: int
    password: InitVar[str]  # Not stored as field
    _authenticated: bool = field(init=False, default=False)

    def __post_init__(self, password: str) -> None:
        self._authenticated = self._verify(password)
```

### Inheritance

```python
@dataclass
class Animal:
    name: str
    sound: str = "..."

@dataclass
class Dog(Animal):
    breed: str = "unknown"
    sound: str = "woof"  # Override default

dog = Dog("Rex", breed="Lab")
```

### Utility Functions

```python
from dataclasses import asdict, astuple, replace, fields

point = Point(1.0, 2.0)
d = asdict(point)            # {"x": 1.0, "y": 2.0}
t = astuple(point)           # (1.0, 2.0)
p2 = replace(point, x=3.0)  # Point(x=3.0, y=2.0)  (3.13+: also copy.replace)
for f in fields(point):
    print(f.name, f.type)
```

## Structural Pattern Matching (3.10+)

### Basic Patterns

```python
match status_code:
    case 200:
        handle_success()
    case 301 | 302:
        handle_redirect()
    case 404:
        handle_not_found()
    case int(code) if code >= 500:
        handle_server_error(code)
    case _:
        handle_unknown()
```

### Sequence and Mapping Patterns

```python
match command.split():
    case ["quit"]:
        quit()
    case ["go", direction]:
        move(direction)
    case ["drop", *objects]:
        drop_items(objects)

match event:
    case {"type": "click", "x": x, "y": y}:
        handle_click(x, y)
    case {"type": "keypress", "key": str(key)}:
        handle_key(key)
```

### Class Patterns

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

def describe(point: Point) -> str:
    match point:
        case Point(x=0, y=0):
            return "origin"
        case Point(x=0, y=y):
            return f"on y-axis at {y}"
        case Point(x=x, y=0):
            return f"on x-axis at {x}"
        case Point(x=x, y=y) if x == y:
            return f"on diagonal at {x}"
        case _:
            return f"at ({point.x}, {point.y})"
```

### Guard Clauses and OR Patterns

```python
match value:
    case str(s) if len(s) > 100:
        truncated = s[:100] + "..."
    case str(s):
        truncated = s
    case int() | float() as num:
        truncated = str(num)
```

### Nested Patterns

```python
match config:
    case {"database": {"host": str(host), "port": int(port)}}:
        connect(host, port)
    case {"database": {"url": str(url)}}:
        connect_url(url)
```

## Async/Await

### Basic Coroutines

```python
import asyncio

async def fetch_data(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        return response.json()

# Run from sync code
result = asyncio.run(fetch_data("https://api.example.com"))
```

### Concurrent Execution

```python
async def fetch_all(urls: list[str]) -> list[dict]:
    async with httpx.AsyncClient() as client:
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        return [r.json() for r in responses]

# With error handling - return_exceptions prevents one failure cancelling all
results = await asyncio.gather(*tasks, return_exceptions=True)
for result in results:
    if isinstance(result, Exception):
        print(f"Failed: {result}")
```

### TaskGroup (3.11+, Preferred Over gather)

```python
async def process_urls(urls: list[str]) -> list[str]:
    results = []
    async with asyncio.TaskGroup() as tg:
        for url in urls:
            tg.create_task(fetch_and_store(url, results))
    return results  # All tasks completed or ExceptionGroup raised
```

`TaskGroup` is preferred over `gather()` for structured concurrency: if one task fails, all others are cancelled.

### Async Generators and Context Managers

```python
# Async generator
async def stream_lines(url: str):
    async with httpx.AsyncClient() as client:
        async with client.stream("GET", url) as response:
            async for line in response.aiter_lines():
                yield line

# Async context manager
from contextlib import asynccontextmanager

@asynccontextmanager
async def managed_connection(url: str):
    conn = await connect(url)
    try:
        yield conn
    finally:
        await conn.close()

async with managed_connection("postgres://...") as conn:
    await conn.execute("SELECT 1")
```

### Async Iteration

```python
# Async for loop
async for message in websocket:
    await handle(message)

# Async comprehension
results = [await process(item) async for item in aiter]
filtered = [x async for x in stream if await is_valid(x)]
```

### Semaphore for Concurrency Limiting

```python
async def fetch_limited(urls: list[str], max_concurrent: int = 10) -> list[str]:
    semaphore = asyncio.Semaphore(max_concurrent)

    async def fetch_one(url: str) -> str:
        async with semaphore:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url)
                return resp.text

    return await asyncio.gather(*[fetch_one(url) for url in urls])
```

## Walrus Operator `:=` (3.8+)

```python
# Assign and test in one expression
if (n := len(data)) > 10:
    print(f"Too much data: {n} items")

# In while loops
while chunk := file.read(8192):
    process(chunk)

# In comprehensions
results = [y for x in data if (y := expensive(x)) is not None]
```

## F-String Features

### Quote Reuse and Nesting (3.12+)

```python
# Quote reuse - same quotes inside and outside
names = ["Alice", "Bob"]
msg = f"Users: {", ".join(names)}"

# Nested f-strings
f"{f"{value:.2f}":>10}"

# Multiline with comments (3.12+)
query = f"""
    SELECT {", ".join([
        "id",       # primary key
        "name",     # user name
        "email",    # contact
    ])}
    FROM users
"""
```

### Formatting Tricks

```python
# Number formatting
f"{value:,.2f}"        # 1,234.56
f"{value:>10}"         # Right-align in 10 chars
f"{value:010}"         # Zero-pad to 10 digits
f"{ratio:.1%}"         # 85.0%
f"{num:#x}"            # 0xff (hex with prefix)
f"{num:_}"             # 1_000_000 (digit separator)

# Debug format (3.8+)
x = 42
f"{x=}"                # "x=42"
f"{x=:.2f}"            # "x=42.00"
f"{x + 1=}"            # "x + 1=43"

# Datetime
from datetime import datetime
now = datetime.now()
f"{now:%Y-%m-%d %H:%M}"  # "2026-02-08 14:30"
```

## Template Strings (3.14+)

```python
# t-strings return Template objects, not strings
from string.templatelib import Template, Interpolation

name = "world"
template = t"Hello {name}!"
# Template object with parts: ["Hello ", Interpolation(...), "!"]

# Use for custom processing (HTML escaping, SQL, i18n, etc.)
def html(template: Template) -> str:
    parts = []
    for item in template:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, Interpolation):
            parts.append(html_escape(str(item.value)))
    return "".join(parts)

safe = html(t"<p>{user_input}</p>")
```

## Exception Groups (3.11+)

```python
# Raise multiple exceptions
raise ExceptionGroup("errors", [
    ValueError("bad value"),
    TypeError("wrong type"),
    KeyError("missing key"),
])

# Catch with except*
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(op1())
        tg.create_task(op2())
except* ValueError as eg:
    for exc in eg.exceptions:
        log_value_error(exc)
except* TypeError as eg:
    for exc in eg.exceptions:
        log_type_error(exc)
```

`except*` can match multiple groups; unmatched exceptions propagate.

## Slots in Regular Classes

```python
class Point:
    __slots__ = ("x", "y")

    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

# Benefits: less memory, faster attribute access, prevents typos
p = Point(1, 2)
p.z = 3  # AttributeError - caught at runtime
```

## Context Managers

```python
from contextlib import contextmanager, suppress

# Custom context manager
@contextmanager
def timer(label: str):
    import time
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        print(f"{label}: {elapsed:.3f}s")

with timer("operation"):
    do_work()

# Suppress specific exceptions
with suppress(FileNotFoundError):
    os.remove("temp.txt")

# Multiple context managers (parenthesized, 3.10+)
with (
    open("input.txt") as fin,
    open("output.txt", "w") as fout,
):
    fout.write(fin.read())
```

## Deferred Annotations (3.14+)

```python
# Annotations are no longer evaluated eagerly
# Forward references work without quotes
class Tree:
    def __init__(self, children: list[Tree]) -> None:
        self.children = children

# Access annotations programmatically
from annotationlib import get_annotations, Format

get_annotations(Tree, format=Format.VALUE)       # Evaluates
get_annotations(Tree, format=Format.FORWARDREF)  # Returns ForwardRef objects
get_annotations(Tree, format=Format.STRING)       # Returns strings
```

## Enum Patterns

```python
from enum import Enum, auto, StrEnum

# String enum (3.11+)
class Color(StrEnum):
    RED = auto()    # "red"
    GREEN = auto()  # "green"
    BLUE = auto()   # "blue"

# Works directly as string
print(f"Color is {Color.RED}")  # "Color is red"

# Classic enum with values
class Status(Enum):
    PENDING = "pending"
    ACTIVE = "active"
    ARCHIVED = "archived"

    @property
    def is_active(self) -> bool:
        return self == Status.ACTIVE

# IntEnum for numeric enums that work as ints
from enum import IntEnum

class Priority(IntEnum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3

# Enum with methods and pattern matching
class Shape(Enum):
    CIRCLE = "circle"
    SQUARE = "square"
    TRIANGLE = "triangle"

match shape:
    case Shape.CIRCLE:
        area = math.pi * r**2
    case Shape.SQUARE:
        area = side**2
```

## Abstract Base Classes vs Protocols

```python
from abc import ABC, abstractmethod
from typing import Protocol

# ABC: Nominal typing - classes must explicitly inherit
class Animal(ABC):
    @abstractmethod
    def speak(self) -> str: ...

    @abstractmethod
    def move(self) -> None: ...

class Dog(Animal):  # Must inherit Animal
    def speak(self) -> str:
        return "Woof"

    def move(self) -> None:
        print("Running")

# Protocol: Structural typing - no inheritance needed
class Speaker(Protocol):
    def speak(self) -> str: ...

class Cat:  # No inheritance, but satisfies Speaker
    def speak(self) -> str:
        return "Meow"

def announce(speaker: Speaker) -> None:
    print(speaker.speak())

announce(Cat())  # Works - Cat has speak() method
announce(Dog())  # Also works
```

Use **Protocol** when you want duck typing with type safety. Use **ABC** when you want to enforce inheritance and shared implementation.

## Itertools and Functools Patterns

```python
import itertools
from functools import reduce, partial, cache, lru_cache

# itertools.batched (3.12+) - split into fixed-size chunks
for batch in itertools.batched(range(10), 3):
    print(batch)  # (0, 1, 2), (3, 4, 5), (6, 7, 8), (9,)

# itertools.chain - flatten iterables
combined = list(itertools.chain([1, 2], [3, 4], [5]))  # [1, 2, 3, 4, 5]
flat = list(itertools.chain.from_iterable([[1, 2], [3, 4]]))  # [1, 2, 3, 4]

# itertools.groupby - group consecutive elements
from operator import itemgetter
data = [("a", 1), ("a", 2), ("b", 3), ("b", 4)]
for key, group in itertools.groupby(data, key=itemgetter(0)):
    print(key, list(group))

# itertools.product - cartesian product
for x, y in itertools.product([1, 2], ["a", "b"]):
    print(x, y)  # (1, "a"), (1, "b"), (2, "a"), (2, "b")

# functools.cache - unbounded memoization (3.9+)
@cache
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# functools.lru_cache - bounded memoization
@lru_cache(maxsize=256)
def expensive(key: str) -> Result:
    return compute(key)

# functools.partial - pre-fill function arguments
from functools import partial
int_from_hex = partial(int, base=16)
int_from_hex("ff")  # 255

# functools.reduce
total = reduce(lambda acc, x: acc + x, [1, 2, 3, 4], 0)  # 10
```

## Pathlib (Modern File Operations)

```python
from pathlib import Path

# Create paths
p = Path("src") / "mypackage" / "core.py"
home = Path.home()
cwd = Path.cwd()

# Read and write
content = Path("config.json").read_text()
Path("output.txt").write_text("hello")
data = Path("image.png").read_bytes()

# Inspect
p.exists()
p.is_file()
p.is_dir()
p.suffix          # ".py"
p.stem            # "core"
p.name            # "core.py"
p.parent          # Path("src/mypackage")
p.parts           # ("src", "mypackage", "core.py")

# Glob
for py_file in Path("src").rglob("*.py"):
    print(py_file)

# Walk directories (3.12+)
for dirpath, dirnames, filenames in Path("src").walk():
    for f in filenames:
        print(dirpath / f)

# Copy and move (3.14+)
Path("source.txt").copy("dest.txt")
Path("old.txt").move("new.txt")
Path("src_dir").copy("dst_dir")  # Recursive directory copy

# Resolve and relative
p.resolve()                     # Absolute path
p.relative_to(Path("src"))     # Relative from base
```

## Descriptors and Properties

```python
# Property - controlled attribute access
class Temperature:
    def __init__(self, celsius: float) -> None:
        self._celsius = celsius

    @property
    def fahrenheit(self) -> float:
        return self._celsius * 9 / 5 + 32

    @fahrenheit.setter
    def fahrenheit(self, value: float) -> None:
        self._celsius = (value - 32) * 5 / 9

    @property
    def celsius(self) -> float:
        return self._celsius

t = Temperature(100)
print(t.fahrenheit)    # 212.0
t.fahrenheit = 32
print(t.celsius)       # 0.0

# Cached property (3.8+ functools, or 3.12+ no dependency)
from functools import cached_property

class DataProcessor:
    def __init__(self, path: str) -> None:
        self.path = path

    @cached_property
    def data(self) -> list[dict]:
        """Computed once, then cached as instance attribute."""
        return load_expensive_data(self.path)
```

## Collections Patterns

```python
from collections import defaultdict, Counter, deque, OrderedDict, namedtuple

# Counter - count occurrences
words = ["apple", "banana", "apple", "cherry", "banana", "apple"]
counts = Counter(words)
counts.most_common(2)  # [("apple", 3), ("banana", 2)]

# defaultdict - auto-initialize missing keys
graph: defaultdict[str, list[str]] = defaultdict(list)
graph["a"].append("b")  # No KeyError

# deque - efficient double-ended queue
history: deque[str] = deque(maxlen=10)
history.append("page1")
history.appendleft("page0")

# Named tuple (prefer dataclass for new code)
Point = namedtuple("Point", ["x", "y"])
p = Point(1, 2)
print(p.x, p.y)

# Typed named tuple (3.6+, better than namedtuple)
from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
    label: str = "origin"
```
