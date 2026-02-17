---
name: bun-test-patterns
description: |
  Bun test runner - Jest-compatible testing with mocks, snapshots, coverage, and DOM testing patterns
  When user writes tests with Bun, uses bun:test, creates mocks, runs test coverage, or mentions describe/it/expect patterns
---

# Bun Test Patterns Agent

## What's New in Bun Test (2024-2025)

- **Vitest compatibility**: `vi` alias for easier migration
- **Module mocking**: `mock.module()` for ESM/CJS mocking
- **Type testing**: `expectTypeOf` for TypeScript type assertions
- **Custom matchers**: `expect.extend()` for custom assertions
- **Improved coverage**: Built-in code coverage reporting
- **Watch mode**: Automatic test re-runs on file changes

## Running Tests

### Basic Commands

```bash
# Run all tests
bun test

# Run specific file
bun test math.test.ts

# Run tests matching pattern
bun test --test-name-pattern "add"
bun test -t "add"

# Run with watch mode
bun test --watch

# Run with coverage
bun test --coverage

# Run with timeout
bun test --timeout 10000

# Run specific files by path pattern
bun test src/utils
```

### File Discovery

Bun automatically finds test files matching:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

### Configuration (bunfig.toml)

```toml
[test]
# Enable coverage by default
coverage = true

# Set coverage threshold
coverageThreshold = { line = 80, function = 80 }

# Preload scripts
preload = ["./test/setup.ts"]

# Test timeout in ms
timeout = 5000

# Smol mode for reduced memory
smol = true
```

## Writing Tests

### Basic Structure

```typescript
import { describe, test, it, expect, beforeAll, afterEach } from "bun:test";

describe("Calculator", () => {
  describe("add()", () => {
    it("adds two positive numbers", () => {
      expect(add(2, 3)).toBe(5);
    });

    it("handles negative numbers", () => {
      expect(add(-1, 1)).toBe(0);
    });
  });
});
```

### Test Modifiers

```typescript
// Skip a test
test.skip("not ready yet", () => {
  // ...
});

// Run only this test
test.only("focus on this", () => {
  // ...
});

// Mark as todo
test.todo("implement later");

// Conditional skip
test.if(process.env.CI)("only in CI", () => {
  // ...
});

// Skip if condition
test.skipIf(!process.env.DB_URL)("needs database", () => {
  // ...
});
```

### Async Tests

```typescript
// Async/await
test("fetches user", async () => {
  const user = await fetchUser(1);
  expect(user.name).toBe("Alice");
});

// Promise
test("resolves correctly", () => {
  return fetchUser(1).then((user) => {
    expect(user.name).toBe("Alice");
  });
});

// Callback (done)
test("callback style", (done) => {
  setTimeout(() => {
    expect(true).toBe(true);
    done();
  }, 100);
});
```

### Timeout

```typescript
// Per-test timeout
test("slow operation", async () => {
  const result = await slowOperation();
  expect(result).toBeDefined();
}, 10000); // 10 second timeout
```

## Expect Matchers

### Equality

```typescript
expect(value).toBe(expected); // === comparison
expect(value).toEqual(expected); // deep equality
expect(value).toStrictEqual(expected); // strict deep equality
expect(value).not.toBe(other); // negation
```

### Truthiness

```typescript
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();
expect(value).toBeNaN();
```

### Numbers

```typescript
expect(num).toBeGreaterThan(5);
expect(num).toBeGreaterThanOrEqual(5);
expect(num).toBeLessThan(10);
expect(num).toBeLessThanOrEqual(10);
expect(num).toBeCloseTo(0.3, 5); // floating point
expect(num).toBePositive();
expect(num).toBeNegative();
expect(num).toBeInteger();
expect(num).toBeFinite();
```

### Strings

```typescript
expect(str).toMatch(/pattern/);
expect(str).toContain("substring");
expect(str).toStartWith("prefix");
expect(str).toEndWith("suffix");
expect(str).toHaveLength(10);
```

### Arrays and Iterables

```typescript
expect(arr).toContain(item);
expect(arr).toContainEqual({ id: 1 });
expect(arr).toHaveLength(3);
expect(arr).toBeArray();
expect(arr).toBeArrayOfSize(3);
expect(arr).toInclude(item);
expect(arr).toIncludeAllMembers([1, 2]);
expect(arr).toIncludeAnyMembers([1, 5]);
expect(arr).toSatisfyAll((x) => x > 0);
```

### Objects

```typescript
expect(obj).toHaveProperty("key");
expect(obj).toHaveProperty("nested.key", value);
expect(obj).toMatchObject({ subset: true });
expect(obj).toContainKey("key");
expect(obj).toContainKeys(["a", "b"]);
expect(obj).toContainAllKeys(["a", "b"]);
expect(obj).toContainValue(42);
```

### Functions and Errors

```typescript
expect(() => fn()).toThrow();
expect(() => fn()).toThrow("message");
expect(() => fn()).toThrow(Error);
expect(() => fn()).toThrowError(/pattern/);

// Async errors
await expect(asyncFn()).rejects.toThrow();
await expect(asyncFn()).resolves.toBe(value);
```

### Assertions Count

```typescript
test("multiple assertions", () => {
  expect.assertions(3); // Must have exactly 3 assertions

  expect(a).toBe(1);
  expect(b).toBe(2);
  expect(c).toBe(3);
});

test("at least one", async () => {
  expect.hasAssertions(); // Must have at least one assertion

  const data = await fetchData();
  expect(data).toBeDefined();
});
```

## Lifecycle Hooks

### Basic Hooks

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

// Run once before all tests in file/describe block
beforeAll(() => {
  console.log("Setting up");
});

// Run once after all tests
afterAll(() => {
  console.log("Tearing down");
});

// Run before each test
beforeEach(() => {
  console.log("Before each test");
});

// Run after each test
afterEach(() => {
  console.log("After each test");
});
```

### Async Hooks

```typescript
beforeAll(async () => {
  await database.connect();
});

afterAll(async () => {
  await database.disconnect();
});
```

### Scoped Hooks

```typescript
describe("outer", () => {
  beforeAll(() => console.log("outer beforeAll"));
  beforeEach(() => console.log("outer beforeEach"));

  describe("inner", () => {
    beforeAll(() => console.log("inner beforeAll"));
    beforeEach(() => console.log("inner beforeEach"));

    test("example", () => {
      // Runs: outer beforeAll, inner beforeAll,
      //       outer beforeEach, inner beforeEach, test
    });
  });
});
```

### Preload Scripts

```typescript
// test/setup.ts - loaded before all tests
import { beforeEach, afterEach, mock } from "bun:test";

// Global setup
beforeEach(() => {
  // Reset mocks before each test
  mock.restore();
});

afterEach(() => {
  // Cleanup after each test
});
```

```toml
# bunfig.toml
[test]
preload = ["./test/setup.ts"]
```

## Mocking

### Mock Functions

```typescript
import { mock, expect, test } from "bun:test";

test("mock function", () => {
  // Create mock
  const mockFn = mock(() => 42);

  // Call it
  const result = mockFn("arg1", "arg2");

  // Assert
  expect(mockFn).toHaveBeenCalled();
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");
  expect(result).toBe(42);

  // Access call history
  expect(mockFn.mock.calls).toEqual([["arg1", "arg2"]]);
  expect(mockFn.mock.results).toEqual([{ type: "return", value: 42 }]);
});
```

### Mock Implementations

```typescript
const mockFn = mock();

// Set return value
mockFn.mockReturnValue(42);
expect(mockFn()).toBe(42);

// Return once then default
mockFn.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValue(0);
expect(mockFn()).toBe(1);
expect(mockFn()).toBe(2);
expect(mockFn()).toBe(0);

// Custom implementation
mockFn.mockImplementation((x) => x * 2);
expect(mockFn(5)).toBe(10);

// Async mocks
mockFn.mockResolvedValue({ data: "test" });
await expect(mockFn()).resolves.toEqual({ data: "test" });

mockFn.mockRejectedValue(new Error("fail"));
await expect(mockFn()).rejects.toThrow("fail");
```

### Spies

```typescript
import { spyOn, expect, test } from "bun:test";

const calculator = {
  add(a: number, b: number) {
    return a + b;
  },
};

test("spy on method", () => {
  const spy = spyOn(calculator, "add");

  const result = calculator.add(2, 3);

  expect(spy).toHaveBeenCalledWith(2, 3);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(result).toBe(5); // Original still works
  expect(spy.mock.calls).toEqual([[2, 3]]);
});

test("spy with mock implementation", () => {
  const spy = spyOn(calculator, "add").mockImplementation(() => 100);

  expect(calculator.add(1, 2)).toBe(100);

  // Restore original
  spy.mockRestore();
  expect(calculator.add(1, 2)).toBe(3);
});
```

### Module Mocking

```typescript
import { mock, test, expect } from "bun:test";

// Mock a module
mock.module("./database", () => ({
  query: mock(() => [{ id: 1, name: "Test" }]),
  connect: mock(() => Promise.resolve()),
}));

test("uses mocked module", async () => {
  const db = await import("./database");

  const result = db.query("SELECT * FROM users");
  expect(result).toEqual([{ id: 1, name: "Test" }]);
  expect(db.query).toHaveBeenCalled();
});

// Mock with factory for dynamic values
mock.module("./config", () => {
  return {
    get apiUrl() {
      return process.env.API_URL || "http://localhost:3000";
    },
  };
});
```

### Restoring Mocks

```typescript
import { mock, afterEach } from "bun:test";

afterEach(() => {
  // Restore all mocks and spies
  mock.restore();
});

// Or restore individually
const mockFn = mock(() => 42);
mockFn.mockClear(); // Clear call history
mockFn.mockReset(); // Clear history + implementation
mockFn.mockRestore(); // Restore original (for spies)
```

### Vitest Compatibility

```typescript
import { vi, test, expect } from "bun:test";

test("vitest-style mocking", () => {
  const mockFn = vi.fn(() => 42);

  mockFn();

  expect(mockFn).toHaveBeenCalled();

  // Available: vi.fn, vi.spyOn, vi.mock, vi.restoreAllMocks, vi.clearAllMocks
});
```

## Snapshots

### Basic Snapshots

```typescript
import { test, expect } from "bun:test";

test("snapshot object", () => {
  const user = {
    id: 1,
    name: "Alice",
    createdAt: new Date("2024-01-01"),
  };

  expect(user).toMatchSnapshot();
});
```

Snapshots are stored in `__snapshots__/` directory.

### Inline Snapshots

```typescript
test("inline snapshot", () => {
  const result = formatUser({ name: "Bob", age: 30 });

  // Bun automatically updates this string on first run
  expect(result).toMatchInlineSnapshot(`
    {
      "displayName": "Bob",
      "isAdult": true,
    }
  `);
});
```

### Error Snapshots

```typescript
test("error snapshot", () => {
  expect(() => {
    throw new Error("Something went wrong");
  }).toThrowErrorMatchingSnapshot();
});

test("inline error snapshot", () => {
  expect(() => {
    throw new Error("Invalid input");
  }).toThrowErrorMatchingInlineSnapshot(`"Invalid input"`);
});
```

### Updating Snapshots

```bash
# Update all snapshots
bun test --update-snapshots

# Short flag
bun test -u
```

## Coverage

### Enabling Coverage

```bash
bun test --coverage
```

### Coverage Output

```
File         | % Funcs | % Lines | Uncovered Line #s
All files    |   66.67 |   77.78 |
 math.ts     |   50.00 |   66.67 | 15-20
 utils.ts    |  100.00 |  100.00 |
```

### Configuration

```toml
# bunfig.toml
[test]
coverage = true
coverageDir = "coverage"
coverageThreshold = { line = 80, function = 80, branch = 80 }
```

## DOM Testing

### Setup with Happy-DOM

```typescript
// test/setup.ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

```toml
# bunfig.toml
[test]
preload = ["./test/setup.ts"]
```

### Testing Components

```typescript
import { test, expect } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import Button from "./Button";

test("button click handler", async () => {
  const handleClick = mock();

  render(<Button onClick={handleClick}>Click me</Button>);

  const button = screen.getByRole("button");
  await fireEvent.click(button);

  expect(handleClick).toHaveBeenCalledTimes(1);
});

test("renders with label", () => {
  render(<Button>Submit</Button>);

  expect(screen.getByText("Submit")).toBeInTheDocument();
});
```

### Testing Library Setup

```typescript
// test/setup.ts
import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

afterEach(() => {
  cleanup();
});
```

## Custom Matchers

```typescript
import { expect } from "bun:test";

expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor} - ${ceiling}`
          : `expected ${received} to be within range ${floor} - ${ceiling}`,
    };
  },
});

// TypeScript declaration
declare module "bun:test" {
  interface Matchers<T> {
    toBeWithinRange(floor: number, ceiling: number): void;
  }
}

// Usage
test("custom matcher", () => {
  expect(5).toBeWithinRange(1, 10);
  expect(20).not.toBeWithinRange(1, 10);
});
```

## Type Testing

```typescript
import { test, expectTypeOf } from "bun:test";

test("type inference", () => {
  const result = add(1, 2);

  expectTypeOf(result).toBeNumber();
  expectTypeOf(result).not.toBeString();

  expectTypeOf(add).toBeFunction();
  expectTypeOf(add).parameters.toEqualTypeOf<[number, number]>();
  expectTypeOf(add).returns.toEqualTypeOf<number>();
});
```

## Integration Testing Patterns

### Database Testing

```typescript
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  test,
  expect,
} from "bun:test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clean up test data
  await prisma.user.deleteMany();
});

describe("User repository", () => {
  test("creates user", async () => {
    const user = await prisma.user.create({
      data: { email: "test@example.com", name: "Test" },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe("test@example.com");
  });
});
```

### API Testing

```typescript
import { test, expect, beforeAll, afterAll } from "bun:test";
import app from "./app";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    fetch: app.fetch,
    port: 0, // Random available port
  });
});

afterAll(() => {
  server.stop();
});

test("GET /users returns list", async () => {
  const response = await fetch(`http://localhost:${server.port}/users`);

  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data).toBeArray();
});

test("POST /users creates user", async () => {
  const response = await fetch(`http://localhost:${server.port}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test", email: "test@example.com" }),
  });

  expect(response.status).toBe(201);
});
```

## Best Practices Summary

1. **Use `describe` blocks** - organize related tests
2. **One assertion focus** - each test verifies one behavior
3. **Clean up in afterEach** - prevent test pollution
4. **Use `mock.restore()`** - reset mocks between tests
5. **Prefer spies over mocks** - when original behavior is needed
6. **Use inline snapshots** - for small, readable values
7. **Enable coverage** - maintain test quality
8. **Preload common setup** - DRY principle
9. **Use `.skip` and `.todo`** - track incomplete tests
10. **Test edge cases** - null, empty, boundary values

## When to Ask for Help

- Complex module mocking scenarios
- Performance optimization for large test suites
- Integration with specific testing libraries
- Parallel test execution configuration
- Custom reporter development
- CI/CD pipeline setup for Bun tests
