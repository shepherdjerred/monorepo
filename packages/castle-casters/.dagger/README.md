# Castle Casters Dagger Module

This directory contains the Dagger module for the Castle Casters project CI/CD pipeline.

## Overview

The Dagger module provides a programmatic CI/CD pipeline that replaces the previous Earthly/Jenkins setup. It's written in TypeScript and uses Dagger to define build, test, and deployment workflows.

## Setup

### Prerequisites

- [Bun](https://bun.sh/) runtime (for TypeScript execution)
- [Dagger CLI](https://dagger.io/install) (installed automatically in CI)

### Local Development

1. Install dependencies:
   ```bash
   cd .dagger
   bun install
   ```

2. Run type checking:
   ```bash
   bun run typecheck
   ```

3. Run linting:
   ```bash
   bun run lint
   ```

## Available Functions

### Core Functions

- `dagger call ci` - Run the complete CI pipeline
- `dagger call build` - Build the project
- `dagger call test` - Run tests
- `dagger call check` - Run all checks (build, test, quality)
- `dagger call artifact` - Get the built JAR artifact
- `dagger call deps` - Resolve Maven dependencies
- `dagger call coverage` - Generate coverage report

### Examples

```bash
# Run the CI pipeline
dagger call ci --source=. --version="1.0.0" --git-sha="abc123" --env="dev"

# Just build the project
dagger call build --source=.

# Run tests only
dagger call test --source=.

# Get the JAR artifact
dagger call artifact --source=. export --path=./build-output
```

## CI/CD Integration

The module integrates with GitHub Actions through the `.github/workflows/ci.yaml` file:

- **Pull Requests**: Runs development pipeline (build, test, quality checks)
- **Main Branch**: Runs production pipeline with additional steps (coverage, artifact upload)

## Migration from Earthly/Jenkins

This module replaces the previous:
- `Jenkinsfile` - Now handled by GitHub Actions
- `Earthfile` - Build logic moved to Dagger TypeScript functions

The functionality remains the same but with improved:
- Type safety (TypeScript vs shell scripts)
- Better error handling and logging
- Parallel execution where possible
- Integration with GitHub Actions ecosystem
