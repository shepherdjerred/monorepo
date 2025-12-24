---
description: Dagger pipeline development and CI/CD workflow assistance
when_to_use: When user works with Dagger, mentions CI/CD pipelines, or dagger commands
---

# Dagger Helper Agent

## Overview

This agent helps you develop and manage Dagger CI/CD pipelines using the Dagger SDK. Dagger provides portable, programmable CI/CD pipelines that run anywhere.

## CLI Commands

### Common Operations

**List available functions**:
```bash
dagger functions
```

**Run a pipeline function**:
```bash
dagger call build
dagger call test
dagger call deploy --env=production
```

**Develop interactively**:
```bash
dagger develop
```

**Check Dagger version**:
```bash
dagger version
```

## Dagger Module Structure

A typical Dagger module in Go:

```go
package main

import (
	"context"
	"dagger/mymodule/internal/dagger"
)

type Mymodule struct{}

// Build the application
func (m *Mymodule) Build(
	ctx context.Context,
	// Source directory
	source *dagger.Directory,
) *dagger.Container {
	return dag.Container().
		From("golang:1.21").
		WithDirectory("/src", source).
		WithWorkdir("/src").
		WithExec([]string{"go", "build", "-o", "app"})
}

// Run tests
func (m *Mymodule) Test(
	ctx context.Context,
	source *dagger.Directory,
) (string, error) {
	return dag.Container().
		From("golang:1.21").
		WithDirectory("/src", source).
		WithWorkdir("/src").
		WithExec([]string{"go", "test", "./..."}).
		Stdout(ctx)
}
```

## Common Workflows

### Building Containers

```go
func (m *Mymodule) BuildImage(
	ctx context.Context,
	source *dagger.Directory,
) *dagger.Container {
	return dag.Container().
		From("node:18-alpine").
		WithDirectory("/app", source).
		WithWorkdir("/app").
		WithExec([]string{"npm", "install"}).
		WithExec([]string{"npm", "run", "build"}).
		WithEntrypoint([]string{"npm", "start"})
}
```

### Multi-Stage Builds

```go
func (m *Mymodule) BuildOptimized(
	ctx context.Context,
	source *dagger.Directory,
) *dagger.Container {
	// Build stage
	builder := dag.Container().
		From("golang:1.21").
		WithDirectory("/src", source).
		WithWorkdir("/src").
		WithExec([]string{"go", "build", "-o", "app"})

	// Runtime stage
	return dag.Container().
		From("alpine:latest").
		WithFile("/usr/local/bin/app", builder.File("/src/app")).
		WithEntrypoint([]string{"/usr/local/bin/app"})
}
```

### Secret Management

```go
func (m *Mymodule) Deploy(
	ctx context.Context,
	source *dagger.Directory,
	// API token for deployment
	token *dagger.Secret,
) (string, error) {
	return dag.Container().
		From("alpine:latest").
		WithSecretVariable("API_TOKEN", token).
		WithDirectory("/app", source).
		WithExec([]string{"sh", "-c", "deploy.sh"}).
		Stdout(ctx)
}

// Call with:
// dagger call deploy --source=. --token=env:API_TOKEN
```

### Caching Strategies

```go
func (m *Mymodule) BuildWithCache(
	ctx context.Context,
	source *dagger.Directory,
) *dagger.Container {
	return dag.Container().
		From("node:18").
		WithDirectory("/app", source).
		WithWorkdir("/app").
		// Cache node_modules
		WithMountedCache("/app/node_modules", dag.CacheVolume("node-modules")).
		WithExec([]string{"npm", "install"}).
		WithExec([]string{"npm", "run", "build"})
}
```

## Best Practices

1. **Use Caching**: Cache dependencies with `WithMountedCache`
2. **Parameterize**: Make pipelines configurable with function parameters
3. **Compose**: Break complex pipelines into smaller, reusable functions
4. **Type Safety**: Leverage strong typing for pipeline inputs/outputs
5. **Test Locally**: Run pipelines locally before CI integration
6. **Version Control**: Keep dagger.json and modules in git

## CI/CD Integration

### GitHub Actions

```yaml
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Dagger pipeline
        uses: dagger/dagger-for-github@v5
        with:
          version: "latest"
          verb: call
          args: build --source=.
```

### GitLab CI

```yaml
dagger:
  image: alpine:latest
  before_script:
    - apk add --no-cache curl
    - curl -L https://dl.dagger.io/dagger/install.sh | sh
  script:
    - dagger call build --source=.
```

## Examples

### Example 1: Full Application Pipeline

```go
type Mymodule struct{}

func (m *Mymodule) All(
	ctx context.Context,
	source *dagger.Directory,
) (string, error) {
	// Lint
	if _, err := m.Lint(ctx, source); err != nil {
		return "", err
	}

	// Test
	if _, err := m.Test(ctx, source); err != nil {
		return "", err
	}

	// Build
	container := m.Build(ctx, source)

	// Publish
	return container.Publish(ctx, "registry.example.com/app:latest")
}
```

### Example 2: Multi-Platform Builds

```go
func (m *Mymodule) BuildMultiPlatform(
	ctx context.Context,
	source *dagger.Directory,
) *dagger.Container {
	variants := make([]*dagger.Container, 0)

	for _, platform := range []dagger.Platform{"linux/amd64", "linux/arm64"} {
		variants = append(variants, dag.Container(dagger.ContainerOpts{
			Platform: platform,
		}).
			From("golang:1.21").
			WithDirectory("/src", source).
			WithWorkdir("/src").
			WithExec([]string{"go", "build", "-o", "app"}))
	}

	return dag.Container().WithRootfs(
		dag.Directory().WithFiles(".", variants[0].Rootfs()),
	)
}
```

### Example 3: Testing with Services

```go
func (m *Mymodule) IntegrationTest(
	ctx context.Context,
	source *dagger.Directory,
) (string, error) {
	// Start database service
	db := dag.Container().
		From("postgres:15").
		WithEnvVariable("POSTGRES_PASSWORD", "test").
		WithExposedPort(5432).
		AsService()

	// Run tests against database
	return dag.Container().
		From("golang:1.21").
		WithDirectory("/src", source).
		WithServiceBinding("db", db).
		WithEnvVariable("DB_HOST", "db").
		WithWorkdir("/src").
		WithExec([]string{"go", "test", "./..."}).
		Stdout(ctx)
}
```

## When to Ask for Help

Ask the user for clarification when:
- The language/SDK for the Dagger module is unclear
- Secret sources or authentication methods are ambiguous
- The target container registry or deployment environment isn't specified
- Multiple pipeline stages could be organized differently
