# bun-decompile

Extract and de-minify source code from Bun-compiled executables.

Originally developed to inspect [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), which ships as a Bun-compiled binary.

## Features

- **Binary Extraction**: Parse Bun's embedded module graph to extract all bundled sources
- **Sourcemap Recovery**: Automatically recover original TypeScript/JSX sources from embedded sourcemaps
- **AI De-minification**: Use OpenAI or Anthropic to rename minified identifiers back to meaningful names
- **Functional Equivalence**: Babel-based renaming guarantees the de-minified code works identically

## Installation

```bash
# Install locally
bun add @shepherdjerred/bun-decompile

# Or install globally
bun add -g @shepherdjerred/bun-decompile
```

> **Note:** This package requires [Bun](https://bun.sh) runtime and will not work with Node.js.
> It uses Bun-specific APIs (`Bun.file()`, `Bun.write()`) for file operations.

## Quick Start

```bash
# Extract sources from a compiled binary
bun-decompile ./my-app -o ./extracted

# De-minify with OpenAI (default)
export OPENAI_API_KEY=sk-...
bun-decompile ./my-app --deminify

# De-minify with Anthropic Claude
export ANTHROPIC_API_KEY=sk-ant-...
bun-decompile ./my-app --deminify --provider anthropic

# Batch mode (Anthropic only, 50% cheaper)
bun-decompile ./my-app --deminify --provider anthropic --batch

# De-minify a standalone JS file
bun-decompile -f ./minified.js --deminify --yes
```

## How It Works

### Binary Parsing

Bun embeds a module graph at the end of compiled executables. The parser:

1. Searches backwards from file end for the Bun trailer signature (`packages by bun`)
2. Reads the offsets structure (32 bytes before trailer) containing:
   - Total embedded data size
   - Pointer to module array
   - Entry point index
   - Compile-time arguments
3. Iterates the module entries (40 bytes each) extracting:
   - Module path and contents
   - Sourcemap and bytecode (if present)
   - Loader type (js/ts/jsx/tsx/css/json/etc)
   - Module format (ESM/CJS)

### Sourcemap Recovery

When sourcemaps are embedded (compiled with `--sourcemap`), the tool extracts original source files including:

- TypeScript with full type annotations
- JSX/TSX templates
- Original comments and formatting

### AI De-minification Pipeline

The de-minification process uses a novel approach that guarantees functional equivalence:

1. **Call Graph Analysis**: Build a dependency graph of all functions in the source
2. **Bottom-Up Processing**: Process leaf functions first, so parent functions see renamed callees
3. **LLM Rename Suggestions**: The LLM analyzes function behavior and outputs JSON rename mappings:
   ```json
   {
     "processItems_40_120": {
       "functionName": "filterValidItems",
       "description": "Filters array to valid items",
       "renames": { "t": "items", "r": "predicate", "n": "result" }
     }
   }
   ```
4. **Babel Transformation**: Babel's `scope.rename()` applies mappings, handling all scope complexity

This approach (inspired by [humanify](https://github.com/jehna/humanify)) means the LLM never outputs code directly—only suggestions—eliminating LLM-introduced bugs.

## CLI Reference

```
bun-decompile <binary> [options]
bun-decompile --file <js-file> --deminify [options]
```

### Options

| Option               | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `-o, --output <dir>` | Output directory (default: `./decompiled`)            |
| `-f, --file <path>`  | De-minify a JS file directly (skip binary extraction) |
| `-v, --verbose`      | Show detailed information                             |
| `-q, --quiet`        | Suppress progress display                             |
| `-h, --help`         | Show help message                                     |

### De-minification Options

| Option                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `--deminify`          | Enable AI de-minification                               |
| `--provider <name>`   | LLM provider: `openai` or `anthropic` (default: openai) |
| `--api-key <key>`     | API key (or set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `--model <model>`     | Model to use (default: gpt-5-nano)                      |
| `--batch`             | Use Anthropic batch API (50% cheaper, async)            |
| `--resume <batch-id>` | Resume a pending batch job                              |
| `--no-cache`          | Disable result caching                                  |
| `--concurrency <n>`   | Parallel API requests (default: 3, max: 20)             |
| `--yes`               | Skip cost confirmation prompt                           |

## Programmatic API

### Extraction

```typescript
import {
  decompileFile,
  extractToDirectory,
  getExtractionSummary,
} from "@shepherdjerred/bun-decompile";

// Parse binary and extract module graph
const result = await decompileFile("./my-app");

console.log(getExtractionSummary(result));
// Bun Version: 1.2.0
// Bundled Modules: 42
// Entry Point: /src/index.ts
// Original Sources: 38 (recovered from sourcemap)

// Write to disk
await extractToDirectory(result, "./extracted");
```

### De-minification

```typescript
import { createConfig, Deminifier } from "@shepherdjerred/bun-decompile";

const config = createConfig(process.env.OPENAI_API_KEY!, "./output", {
  provider: "openai",
  model: "gpt-5-nano",
  verbose: true,
});

const deminifier = new Deminifier(config);

// Estimate cost before processing
const estimate = deminifier.estimateCost(minifiedSource);
console.log(`Estimated cost: $${estimate.estimatedCost.toFixed(4)}`);

// De-minify with progress tracking
const result = await deminifier.deminifyFile(minifiedSource, {
  fileName: "bundle.js",
  onExtendedProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.current}/${progress.total}`);
  },
});

console.log(deminifier.getStats());
```

### Key Exports

- **Extraction**: `decompileFile`, `decompile`, `extractToDirectory`, `parseSourceMap`
- **De-minification**: `Deminifier`, `createConfig`, `ClaudeClient`, `OpenAIClient`
- **Types**: `DecompileResult`, `ModuleEntry`, `DeminifyConfig`, `CostEstimate`

## Output Structure

```
output/
├── metadata.json        # Bun version, entry point, module counts
├── bundled/             # Transpiled/bundled JS sources + sourcemaps
├── original/            # Original TS/TSX sources (from sourcemaps)
├── deminified/          # AI de-minified output
├── bytecode/            # Pre-compiled bytecode (if present)
└── cache/               # LLM response cache
```

## Development

```bash
bun test          # Run tests
bun run typecheck # Type check
```

### Project Structure

- `src/index.ts` - CLI entry point
- `src/lib/parser.ts` - Binary parsing
- `src/lib/extractor.ts` - File extraction
- `src/lib/deminify/` - AI de-minification (deminifier, babel-renamer, call-graph, LLM clients)

## License

GPL-3.0
