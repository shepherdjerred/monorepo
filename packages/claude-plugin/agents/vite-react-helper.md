---
description: Vite + React for fast modern web development - build config, HMR, hooks, state management, and performance patterns
when_to_use: When user works with Vite, React, creates components, manages state, uses hooks, or configures Vite builds
---

# Vite + React Helper Agent

## What's New (2024-2025)

### Vite
- **Rolldown preview**: Rust-based bundler for faster builds
- **Environment API**: Unified dev/build environment handling
- **Text-based lockfile**: Better dependency tracking
- **Node.js 20.19+** required

### React 19
- **React Compiler**: Automatic memoization (experimental)
- **`use()` hook**: Read promises and context in render
- **Actions**: Simplified async mutations
- **Server Components**: First-class RSC support
- **Document metadata**: Native `<title>`, `<meta>` in components

## Project Setup

### Create New Project

```bash
# npm
npm create vite@latest my-app -- --template react-ts

# Bun
bun create vite my-app --template react-ts

cd my-app
npm install  # or bun install
npm run dev
```

### Templates Available

| Template | Description |
|----------|-------------|
| `react` | React with JavaScript |
| `react-ts` | React with TypeScript |
| `react-swc` | React + SWC (faster builds) |
| `react-swc-ts` | React + SWC + TypeScript |

## Vite Configuration

### Basic Config

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

### Plugin Options

```typescript
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      // JSX runtime (automatic or classic)
      jsxRuntime: "automatic",

      // Custom JSX import source (e.g., for Emotion)
      jsxImportSource: "@emotion/react",

      // Babel plugins for features like decorators
      babel: {
        plugins: [
          ["@babel/plugin-proposal-decorators", { legacy: true }],
        ],
      },

      // File patterns to include
      include: /\.(mdx|js|jsx|ts|tsx)$/,
    }),
  ],
});
```

### SWC Plugin (Faster Alternative)

```typescript
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [
    react({
      // Enable React Refresh (default: true)
      devTarget: "es2022",

      // SWC plugins
      plugins: [["@swc/plugin-emotion", {}]],
    }),
  ],
});
```

### Environment Variables

```bash
# .env
VITE_API_URL=https://api.example.com
VITE_APP_TITLE=My App

# .env.development
VITE_API_URL=http://localhost:8080

# .env.production
VITE_API_URL=https://api.prod.example.com
```

```typescript
// Access in code (only VITE_ prefixed vars exposed)
const apiUrl = import.meta.env.VITE_API_URL;
const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;
const mode = import.meta.env.MODE;
```

```typescript
// TypeScript definitions (vite-env.d.ts)
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### Path Aliases

```typescript
// vite.config.ts
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
    },
  },
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@hooks/*": ["src/hooks/*"]
    }
  }
}
```

## React Core Patterns

### Components and Props

```tsx
// Props with TypeScript
interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}

function Button({
  label,
  variant = "primary",
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children ?? label}
    </button>
  );
}
```

### State with useState

```tsx
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);

  // Functional updates for derived state
  const increment = () => setCount((prev) => prev + 1);
  const decrement = () => setCount((prev) => prev - 1);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

### Complex State with useReducer

```tsx
import { useReducer } from "react";

interface State {
  count: number;
  step: number;
}

type Action =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "setStep"; step: number }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "increment":
      return { ...state, count: state.count + state.step };
    case "decrement":
      return { ...state, count: state.count - state.step };
    case "setStep":
      return { ...state, step: action.step };
    case "reset":
      return { count: 0, step: 1 };
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, { count: 0, step: 1 });

  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => dispatch({ type: "decrement" })}>-</button>
      <button onClick={() => dispatch({ type: "increment" })}>+</button>
      <button onClick={() => dispatch({ type: "reset" })}>Reset</button>
    </div>
  );
}
```

### Effects and Cleanup

```tsx
import { useEffect, useState } from "react";

function ChatRoom({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    // Setup
    const connection = createConnection(roomId);
    connection.connect();

    connection.on("message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // Cleanup (runs on unmount or before next effect)
    return () => {
      connection.disconnect();
    };
  }, [roomId]); // Re-run when roomId changes

  return <MessageList messages={messages} />;
}
```

### Refs for DOM Access

```tsx
import { useRef, useEffect } from "react";

function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Direct DOM manipulation
    if (videoRef.current) {
      videoRef.current.play();
    }
  }, [src]);

  return <video ref={videoRef} src={src} />;
}
```

### Context for Global State

```tsx
import { createContext, useContext, useState, ReactNode } from "react";

interface ThemeContextType {
  theme: "light" | "dark";
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const toggle = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

// Usage
function App() {
  return (
    <ThemeProvider>
      <ThemedButton />
    </ThemeProvider>
  );
}

function ThemedButton() {
  const { theme, toggle } = useTheme();
  return <button onClick={toggle}>Current: {theme}</button>;
}
```

## Performance Optimization

### useMemo for Expensive Calculations

```tsx
import { useMemo } from "react";

function FilteredList({ items, filter }: Props) {
  // Only recalculates when items or filter changes
  const filteredItems = useMemo(() => {
    return items.filter((item) => item.name.includes(filter));
  }, [items, filter]);

  return (
    <ul>
      {filteredItems.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

### useCallback for Stable References

```tsx
import { useCallback, memo } from "react";

// Memoized child component
const ExpensiveChild = memo(function ExpensiveChild({
  onClick,
}: {
  onClick: () => void;
}) {
  console.log("Child rendered");
  return <button onClick={onClick}>Click</button>;
});

function Parent() {
  const [count, setCount] = useState(0);

  // Stable function reference
  const handleClick = useCallback(() => {
    console.log("Clicked");
  }, []);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
      <ExpensiveChild onClick={handleClick} />
    </div>
  );
}
```

### Lazy Loading Components

```tsx
import { lazy, Suspense } from "react";

// Dynamic import - only loads when needed
const HeavyChart = lazy(() => import("./HeavyChart"));
const AdminPanel = lazy(() => import("./AdminPanel"));

function App() {
  const [showChart, setShowChart] = useState(false);

  return (
    <div>
      <button onClick={() => setShowChart(true)}>Show Chart</button>

      <Suspense fallback={<div>Loading chart...</div>}>
        {showChart && <HeavyChart />}
      </Suspense>

      <Suspense fallback={<div>Loading admin...</div>}>
        <AdminPanel />
      </Suspense>
    </div>
  );
}
```

### Code Splitting Routes

```tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

const Home = lazy(() => import("./pages/Home"));
const About = lazy(() => import("./pages/About"));
const Dashboard = lazy(() => import("./pages/Dashboard"));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

## Custom Hooks

### Data Fetching Hook

```tsx
import { useState, useEffect } from "react";

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useFetch<T>(url: string): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch");
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    (async () => {
      try {
        const response = await fetch(url);
        const json = await response.json();
        if (!ignore) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err : new Error("Unknown error"));
          setLoading(false);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [url]);

  return { data, loading, error, refetch: fetchData };
}

// Usage
function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error } = useFetch<User>(`/api/users/${userId}`);

  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;
  if (!user) return null;

  return <div>{user.name}</div>;
}
```

### Local Storage Hook

```tsx
import { useState, useEffect } from "react";

function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

// Usage
function Settings() {
  const [theme, setTheme] = useLocalStorage("theme", "light");
  return <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle</button>;
}
```

### Debounce Hook

```tsx
import { useState, useEffect } from "react";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Usage
function SearchInput() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      searchAPI(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

## Build Optimization

### Chunk Splitting

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          "react-vendor": ["react", "react-dom"],
          "router": ["react-router-dom"],
          "ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"],
        },
      },
    },
  },
});
```

### Analyze Bundle

```bash
# Install analyzer
npm install -D rollup-plugin-visualizer

# vite.config.ts
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    react(),
    visualizer({ open: true }),
  ],
});
```

### Production Optimizations

```typescript
export default defineConfig({
  build: {
    // Target modern browsers
    target: "esnext",

    // Minification
    minify: "esbuild", // or "terser" for smaller bundles

    // CSS code splitting
    cssCodeSplit: true,

    // Source maps for debugging
    sourcemap: true,

    // Asset inlining threshold (bytes)
    assetsInlineLimit: 4096,

    // Chunk size warnings
    chunkSizeWarningLimit: 500,
  },
});
```

## Testing Setup

### Vitest Configuration

```typescript
// vite.config.ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
```

```typescript
// src/test/setup.ts
import "@testing-library/jest-dom";
```

### Component Testing

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Counter from "./Counter";

describe("Counter", () => {
  it("renders initial count", () => {
    render(<Counter initialCount={5} />);
    expect(screen.getByText("Count: 5")).toBeInTheDocument();
  });

  it("increments on click", () => {
    render(<Counter initialCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(screen.getByText("Count: 1")).toBeInTheDocument();
  });

  it("calls onChange when count changes", () => {
    const handleChange = vi.fn();
    render(<Counter initialCount={0} onChange={handleChange} />);
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(handleChange).toHaveBeenCalledWith(1);
  });
});
```

## Common Patterns

### Form Handling

```tsx
import { useState, FormEvent } from "react";

interface FormData {
  email: string;
  password: string;
}

function LoginForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [formData, setFormData] = useState<FormData>({
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Validation
    const newErrors: Partial<FormData> = {};
    if (!formData.email) newErrors.email = "Email required";
    if (!formData.password) newErrors.password = "Password required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="email"
        type="email"
        value={formData.email}
        onChange={handleChange}
      />
      {errors.email && <span>{errors.email}</span>}

      <input
        name="password"
        type="password"
        value={formData.password}
        onChange={handleChange}
      />
      {errors.password && <span>{errors.password}</span>}

      <button type="submit">Login</button>
    </form>
  );
}
```

### Error Boundaries

```tsx
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Usage
function App() {
  return (
    <ErrorBoundary fallback={<h1>Something went wrong</h1>}>
      <MyComponent />
    </ErrorBoundary>
  );
}
```

## Best Practices Summary

1. **Use TypeScript** for type safety and better DX
2. **Avoid unnecessary state** - derive values when possible
3. **Use keys correctly** - unique, stable identifiers for lists
4. **Clean up effects** - prevent memory leaks and stale closures
5. **Memoize expensive operations** with `useMemo` and `useCallback`
6. **Lazy load routes and heavy components** with `lazy()` and `Suspense`
7. **Extract reusable logic** into custom hooks
8. **Use SWC plugin** for faster development builds
9. **Configure chunk splitting** for optimal caching
10. **Test components** with React Testing Library

## When to Ask for Help

- Server-side rendering (SSR) setup and hydration issues
- React Server Components integration
- Complex animation orchestration
- State management library selection (Zustand, Jotai, Redux)
- Performance profiling and optimization
- Micro-frontend architectures with Vite
