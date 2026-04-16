# Build Tool & Testing Integration for TypeScript

## Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
```

## Webpack

```javascript
// webpack.config.js
const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
};
```

## ESLint

```javascript
// eslint.config.js (flat config, ESLint 9+)
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
```

Legacy format (ESLint 8):

```javascript
// .eslintrc.js
module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  parserOptions: {
    project: "./tsconfig.json",
  },
};
```

## Jest

```javascript
// jest.config.js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
};
```

```typescript
// __tests__/user.test.ts
import { createUser } from "../src/user";

describe("User", () => {
  it("creates user with valid data", () => {
    const user = createUser({ name: "Alice", age: 30 });
    expect(user.name).toBe("Alice");
  });
});
```

## Vitest

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

```typescript
// src/user.test.ts
import { describe, it, expect } from "vitest";
import { createUser } from "./user";

describe("createUser", () => {
  it("creates user", () => {
    const user = createUser({ name: "Alice" });
    expect(user.name).toBe("Alice");
  });
});
```
