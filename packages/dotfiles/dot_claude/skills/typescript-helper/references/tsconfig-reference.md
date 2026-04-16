# tsconfig.json Configuration Reference

## Recommended Base Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Strict Mode Options

`"strict": true` enables all of the following:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

## Additional Safety Checks

These are not included in `strict` but are strongly recommended:

```json
{
  "compilerOptions": {
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Module Resolution Strategies

| Strategy | Use When |
|----------|----------|
| `"bundler"` | Using Vite, Webpack, esbuild, or similar bundler |
| `"node16"` / `"nodenext"` | Building for Node.js with ESM/CJS interop |
| `"node"` | Legacy Node.js CommonJS projects |

## TypeScript 5.7+ Options

```json
{
  "compilerOptions": {
    "rewriteRelativeImportExtensions": true,
    "target": "ES2024",
    "lib": ["ES2024"]
  }
}
```

## Project References (Monorepo)

```json
// tsconfig.json (root)
{
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/web" }
  ]
}

// packages/core/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

Build with: `tsc --build` (incremental, respects dependency order).
