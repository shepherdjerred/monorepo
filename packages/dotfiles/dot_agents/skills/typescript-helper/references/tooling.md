# TypeScript tooling

Read this when configuring typescript-eslint, selecting a direct TypeScript executor, or separating runtime execution from type-checking.

## typescript-eslint

Current configuration uses flat config:

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
```

Adapt this to the repository's shared ESLint package. Do not introduce a parallel standalone configuration when one already exists.

Typed linting asks TypeScript for semantic information and costs more than syntax-only rules. Run the repository's intended lint task so caching, ignores, generated files, and project service settings remain consistent.

## Execution is not checking

Node, Bun, `tsx`, and `ts-node` can execute TypeScript using different transformation rules. A successful run does not prove the project passes its compiler configuration.

- Use the repository's `typecheck` task or `tsc -p` / `tsc -b` for checking.
- Use the selected deployment runtime for execution.
- Use the build tool for output when the application bundles or publishes artifacts.

## Tool ownership

Load the matching framework or build-tool skill for Vite, React, Bun, test runners, or bundlers. This TypeScript skill should define their type-system boundary without copying volatile tool setup.
