# Python Testing Patterns

Guide to testing Python code with pytest, unittest, mocking, coverage, hypothesis (property-based testing), and debugging with pdb/debugpy.

## pytest

### Basic Test Structure

```python
# tests/test_math.py
def test_addition():
    assert 1 + 1 == 2

def test_string_contains():
    result = "hello world"
    assert "world" in result

def test_exception_raised():
    with pytest.raises(ValueError, match="invalid"):
        int("not_a_number")

def test_approximate():
    assert 0.1 + 0.2 == pytest.approx(0.3)

class TestCalculator:
    def test_add(self):
        calc = Calculator()
        assert calc.add(2, 3) == 5

    def test_divide_by_zero(self):
        calc = Calculator()
        with pytest.raises(ZeroDivisionError):
            calc.divide(1, 0)
```

### Fixtures

Fixtures provide test dependencies. They are functions decorated with `@pytest.fixture` and injected by name.

```python
import pytest

@pytest.fixture
def sample_user():
    return User(name="Alice", email="alice@example.com")

@pytest.fixture
def db_connection():
    conn = create_connection()
    yield conn          # Setup above, teardown below
    conn.close()

def test_user_name(sample_user):
    assert sample_user.name == "Alice"

def test_query(db_connection):
    result = db_connection.execute("SELECT 1")
    assert result == 1
```

### Fixture Scopes

```python
@pytest.fixture(scope="function")   # Default: new per test
def per_test(): ...

@pytest.fixture(scope="class")      # Shared within test class
def per_class(): ...

@pytest.fixture(scope="module")     # Shared within test file
def per_module(): ...

@pytest.fixture(scope="session")    # Shared across entire run
def per_session(): ...
```

### Fixture Factories

Return a callable for flexible test data creation:

```python
@pytest.fixture
def make_user():
    created = []

    def _make_user(name: str = "Test", **kwargs) -> User:
        user = User(name=name, **kwargs)
        created.append(user)
        return user

    yield _make_user

    # Cleanup all created users
    for user in created:
        user.delete()

def test_multiple_users(make_user):
    alice = make_user("Alice", role="admin")
    bob = make_user("Bob", role="viewer")
    assert alice.role != bob.role
```

### Autouse Fixtures

```python
@pytest.fixture(autouse=True)
def reset_environment():
    """Automatically runs for every test in this module."""
    os.environ["MODE"] = "test"
    yield
    os.environ.pop("MODE", None)
```

### Parametrized Fixtures

```python
@pytest.fixture(params=["sqlite", "postgres", "mysql"])
def db_backend(request):
    backend = create_backend(request.param)
    yield backend
    backend.teardown()

def test_insert(db_backend):
    # Runs 3 times, once per backend
    db_backend.insert({"key": "value"})
    assert db_backend.count() == 1
```

### conftest.py

Shared fixtures go in `conftest.py`. Pytest discovers them automatically.

```python
# tests/conftest.py
import pytest

@pytest.fixture(scope="session")
def app():
    """Create application instance for entire test session."""
    app = create_app(testing=True)
    yield app

@pytest.fixture
def client(app):
    """Create test client for each test."""
    return app.test_client()

@pytest.fixture(autouse=True)
def clean_db(app):
    """Reset database before each test."""
    with app.app_context():
        db.create_all()
        yield
        db.session.rollback()
        db.drop_all()
```

Multiple `conftest.py` files can exist at different directory levels. Inner ones override outer ones.

### Parametrize

```python
@pytest.mark.parametrize("input,expected", [
    ("hello", 5),
    ("", 0),
    ("world!", 6),
])
def test_string_length(input, expected):
    assert len(input) == expected

# Multiple parametrize decorators create cartesian product
@pytest.mark.parametrize("x", [1, 2])
@pytest.mark.parametrize("y", [10, 20])
def test_multiply(x, y):
    # Runs 4 times: (1,10), (1,20), (2,10), (2,20)
    assert x * y > 0

# With IDs for readable output
@pytest.mark.parametrize("path,status", [
    pytest.param("/", 200, id="homepage"),
    pytest.param("/missing", 404, id="not-found"),
    pytest.param("/admin", 403, id="forbidden"),
])
def test_routes(client, path, status):
    response = client.get(path)
    assert response.status_code == status

# Skip/xfail specific parameters
@pytest.mark.parametrize("n", [
    1,
    2,
    pytest.param(3, marks=pytest.mark.skip(reason="not implemented")),
    pytest.param(4, marks=pytest.mark.xfail(reason="known bug")),
])
def test_process(n):
    assert process(n) is not None
```

### Markers

```python
# Define custom markers in pyproject.toml:
# [tool.pytest.ini_options]
# markers = [
#     "slow: marks tests as slow",
#     "integration: marks integration tests",
# ]

@pytest.mark.slow
def test_large_dataset():
    process_million_records()

@pytest.mark.integration
def test_api_call():
    response = call_external_api()
    assert response.ok

# Built-in markers
@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature(): ...

@pytest.mark.skipif(sys.platform == "win32", reason="Unix only")
def test_unix_paths(): ...

@pytest.mark.xfail(reason="Known bug #123", strict=True)
def test_known_bug(): ...

@pytest.mark.timeout(5)  # Requires pytest-timeout
def test_performance(): ...
```

```bash
# Run by marker
pytest -m slow
pytest -m "not slow"
pytest -m "integration and not slow"
```

### Async Testing (pytest-asyncio)

```python
import pytest

# With asyncio_mode = "auto" in pyproject.toml:
async def test_async_fetch():
    result = await fetch_data("https://example.com")
    assert result is not None

# Or explicit marker:
@pytest.mark.asyncio
async def test_async_operation():
    result = await async_process(data)
    assert result.success

# Async fixtures
@pytest.fixture
async def async_client():
    async with httpx.AsyncClient() as client:
        yield client

async def test_with_client(async_client):
    response = await async_client.get("https://example.com")
    assert response.status_code == 200
```

### Temporary Files and Directories

```python
def test_file_processing(tmp_path):
    """tmp_path is a pathlib.Path to a temp directory."""
    input_file = tmp_path / "input.txt"
    input_file.write_text("hello world")

    output_file = tmp_path / "output.txt"
    process_file(input_file, output_file)

    assert output_file.read_text() == "HELLO WORLD"

def test_config(tmp_path, monkeypatch):
    """monkeypatch modifies environment/attributes safely."""
    config = tmp_path / "config.json"
    config.write_text('{"debug": true}')
    monkeypatch.setenv("CONFIG_PATH", str(config))

    app = App()
    assert app.debug is True
```

### Common pytest Plugins

| Plugin | Purpose |
|--------|---------|
| `pytest-cov` | Coverage reporting |
| `pytest-asyncio` | Async test support |
| `pytest-xdist` | Parallel test execution |
| `pytest-mock` | Simplified mocking |
| `pytest-timeout` | Test timeout enforcement |
| `pytest-randomly` | Randomize test order |
| `pytest-benchmark` | Performance benchmarks |
| `pytest-httpx` | Mock httpx requests |
| `pytest-freezegun` | Freeze time in tests |

## unittest (Standard Library)

```python
import unittest

class TestStringMethods(unittest.TestCase):
    def setUp(self):
        self.data = "hello"

    def tearDown(self):
        pass

    def test_upper(self):
        self.assertEqual(self.data.upper(), "HELLO")

    def test_isupper(self):
        self.assertTrue("HELLO".isupper())
        self.assertFalse("Hello".isupper())

    def test_split(self):
        self.assertEqual("a-b-c".split("-"), ["a", "b", "c"])
        with self.assertRaises(TypeError):
            "hello".split(2)

if __name__ == "__main__":
    unittest.main()
```

pytest can run unittest-style tests without changes.

## Mocking

### unittest.mock

```python
from unittest.mock import Mock, MagicMock, patch, AsyncMock

# Basic mock
mock = Mock()
mock.method.return_value = 42
assert mock.method() == 42
mock.method.assert_called_once()

# Patch a module attribute
@patch("myapp.services.requests.get")
def test_fetch(mock_get):
    mock_get.return_value.json.return_value = {"key": "value"}
    mock_get.return_value.status_code = 200

    result = fetch_data("https://api.example.com")
    assert result == {"key": "value"}
    mock_get.assert_called_once_with("https://api.example.com")

# Patch as context manager
def test_time():
    with patch("myapp.utils.time") as mock_time:
        mock_time.time.return_value = 1000.0
        assert get_timestamp() == 1000.0

# Async mock (3.8+)
@patch("myapp.client.fetch", new_callable=AsyncMock)
async def test_async_fetch(mock_fetch):
    mock_fetch.return_value = {"data": "result"}
    result = await process()
    assert result == {"data": "result"}
```

### pytest-mock (Simplified Interface)

```python
def test_with_mocker(mocker):
    # mocker is a fixture from pytest-mock
    mock_send = mocker.patch("myapp.email.send_email")
    mock_send.return_value = True

    result = register_user("alice@example.com")

    assert result.success
    mock_send.assert_called_once_with(
        to="alice@example.com",
        subject="Welcome!",
    )

def test_spy(mocker):
    # Spy: call the real function but track calls
    spy = mocker.spy(mymodule, "expensive_function")
    result = mymodule.process()
    assert spy.call_count == 1
```

### Patching Best Practices

```python
# Patch where it's USED, not where it's DEFINED
# If myapp.views imports requests:
@patch("myapp.views.requests.get")  # Correct
@patch("requests.get")              # Wrong - patches the original, not the import

# Use spec to catch attribute errors
mock = Mock(spec=MyClass)
mock.nonexistent_method()  # Raises AttributeError

# Use autospec for even stricter checking
@patch("myapp.services.MyService", autospec=True)
def test_service(MockService):
    instance = MockService.return_value
    instance.process.return_value = "result"
```

## Coverage

```bash
# Run with coverage
pytest --cov=src --cov-report=term-missing

# HTML report
pytest --cov=src --cov-report=html
open htmlcov/index.html

# Fail if coverage below threshold
pytest --cov=src --cov-fail-under=80

# Multiple report formats
pytest --cov=src --cov-report=term --cov-report=xml --cov-report=html
```

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
branch = true
omit = ["*/tests/*", "*/__main__.py"]

[tool.coverage.report]
show_missing = true
skip_empty = true
fail_under = 80
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.",
    "@overload",
]
```

### Coverage Pragmas

```python
if TYPE_CHECKING:  # pragma: no cover
    from expensive_module import Type

def debug_only():  # pragma: no cover
    """Only runs in debug mode."""
    ...
```

## Hypothesis (Property-Based Testing)

Hypothesis generates random test inputs to find edge cases you wouldn't think of.

### Basic Usage

```python
from hypothesis import given, assume, settings
from hypothesis import strategies as st

@given(st.integers(), st.integers())
def test_addition_commutative(a, b):
    assert a + b == b + a

@given(st.lists(st.integers()))
def test_sort_idempotent(lst):
    assert sorted(sorted(lst)) == sorted(lst)

@given(st.text())
def test_roundtrip_encode_decode(s):
    assert s.encode("utf-8").decode("utf-8") == s
```

### Strategies

```python
# Primitive types
st.integers()                          # Any integer
st.integers(min_value=0, max_value=100)  # Bounded
st.floats(allow_nan=False)             # Floats without NaN
st.text(min_size=1, max_size=100)      # Non-empty strings
st.booleans()                          # True/False
st.none()                              # None
st.binary()                            # bytes

# Collections
st.lists(st.integers(), min_size=1)    # Non-empty list of ints
st.tuples(st.integers(), st.text())    # (int, str)
st.dictionaries(st.text(), st.integers())  # {str: int}
st.frozensets(st.integers())           # frozenset[int]

# Combining strategies
st.one_of(st.integers(), st.text())    # int | str
st.integers() | st.text()             # Same as one_of

# Filtered
st.integers().filter(lambda x: x % 2 == 0)  # Even numbers

# Mapped
st.integers(1, 100).map(str)          # "1" through "100"

# From regex
st.from_regex(r"[a-z]+@[a-z]+\.[a-z]{2,4}")
```

### Composite Strategies

```python
from hypothesis import strategies as st
from hypothesis.strategies import composite

@composite
def ordered_pair(draw):
    a = draw(st.integers())
    b = draw(st.integers(min_value=a))
    return (a, b)

@given(ordered_pair())
def test_ordered(pair):
    a, b = pair
    assert a <= b

# Build dataclass instances
@st.composite
def users(draw):
    return User(
        name=draw(st.text(min_size=1, max_size=50)),
        age=draw(st.integers(min_value=0, max_value=150)),
        email=draw(st.emails()),
    )

@given(users())
def test_user_valid(user):
    assert user.name
    assert 0 <= user.age <= 150
```

### Settings and Assume

```python
from hypothesis import given, assume, settings, HealthCheck

@given(st.integers(), st.integers())
def test_division(a, b):
    assume(b != 0)  # Skip inputs where b is 0
    result = a / b
    assert result * b == pytest.approx(a)

@settings(
    max_examples=500,          # More test cases (default 100)
    deadline=None,             # No time limit per example
    suppress_health_check=[HealthCheck.too_slow],
)
@given(st.lists(st.integers(), min_size=1000))
def test_large_sort(data):
    assert sorted(data) == sorted(data)
```

### Stateful Testing

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, initialize

class DatabaseStateMachine(RuleBasedStateMachine):
    @initialize()
    def setup(self):
        self.db = Database()
        self.model = {}

    @rule(key=st.text(), value=st.integers())
    def insert(self, key, value):
        self.db.insert(key, value)
        self.model[key] = value

    @rule(key=st.text())
    def query(self, key):
        db_result = self.db.get(key)
        model_result = self.model.get(key)
        assert db_result == model_result

TestDatabase = DatabaseStateMachine.TestCase
```

## Debugging

### pdb (Built-in Debugger)

```python
# Set breakpoint in code
breakpoint()  # Drops into pdb (3.7+)

# Or explicitly
import pdb; pdb.set_trace()

# Common pdb commands:
# n (next)      - Execute next line
# s (step)      - Step into function
# c (continue)  - Continue to next breakpoint
# p expr        - Print expression
# pp expr       - Pretty print
# l (list)      - Show source code
# w (where)     - Show stack trace
# u (up)        - Go up in stack
# d (down)      - Go down in stack
# b N           - Set breakpoint at line N
# cl N          - Clear breakpoint at line N
# q (quit)      - Quit debugger
```

```bash
# Run script under debugger
python -m pdb script.py

# Pytest drops into pdb on failure
pytest --pdb

# Break on first failure
pytest -x --pdb

# Remote debugging (3.14+)
python -m pdb -p <PID>  # Attach to running process
```

### Async Debugging (3.14+)

```python
# Set async-aware breakpoint
import pdb; pdb.set_trace_async()

# In pdb, access current async task
# (Pdb) $_asynctask
```

### debugpy (VS Code Debugger)

```python
# Attach VS Code debugger to running process
import debugpy
debugpy.listen(5678)
debugpy.wait_for_client()  # Pause until VS Code connects

# In VS Code launch.json:
# {
#     "type": "debugpy",
#     "request": "attach",
#     "connect": {"host": "localhost", "port": 5678}
# }
```

### Pytest Debug Helpers

```bash
# Show local variables on failure
pytest -l

# Verbose traceback
pytest --tb=long
pytest --tb=short
pytest --tb=no

# Drop into pdb on first failure
pytest --pdb -x

# Drop into debugger at start of each test
pytest --trace

# Show print output even for passing tests
pytest -s
pytest --capture=no
```

## Test Organization Best Practices

```
project/
  src/
    mypackage/
      __init__.py
      core.py
      utils.py
  tests/
    conftest.py              # Shared fixtures
    test_core.py             # Unit tests for core.py
    test_utils.py            # Unit tests for utils.py
    integration/
      conftest.py            # Integration-specific fixtures
      test_api.py
      test_database.py
    e2e/
      test_workflow.py
```

### Naming Conventions

- Test files: `test_<module>.py` or `<module>_test.py`
- Test functions: `test_<description>`
- Test classes: `Test<ClassName>`
- Fixtures: descriptive nouns (`sample_user`, `db_connection`)

### Test Isolation

```python
# Use monkeypatch for environment changes
def test_config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///test.db")
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.delenv("SECRET_KEY", raising=False)

# Use tmp_path for file operations
def test_export(tmp_path):
    output = tmp_path / "export.csv"
    export_data(output)
    assert output.exists()
```
