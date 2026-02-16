# Build & Configuration Reference

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
