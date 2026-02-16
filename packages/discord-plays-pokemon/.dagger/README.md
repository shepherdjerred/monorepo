# Discord Plays Pokemon - Dagger CI/CD

This directory contains the Dagger configuration for the Discord Plays Pokemon project, which has been migrated from Earthly/Jenkins to GitHub Actions with Dagger.

## Setup

1. Install Dagger CLI:
```bash
curl -L https://dl.dagger.io/dagger/install.sh | sh
```

2. Initialize the Dagger module:
```bash
dagger init --name=discord-plays-pokemon --sdk=typescript
```

## Available Commands

### Check (Lint + Test)
Run all linting and testing for all packages:
```bash
dagger call check --source=.
```

### Build
Build all packages:
```bash
dagger call build --source=. --version=1.0.0 --git-sha=abc123
```

### Prettier
Run prettier formatting check:
```bash
dagger call prettier --source=.
```

### Markdownlint
Run markdownlint check:
```bash
dagger call markdownlint --source=.
```

### Build Docker Image
Build the Docker image:
```bash
dagger call build-image --source=. --version=1.0.0 --git-sha=abc123
```

### Publish Docker Image
Publish the Docker image to GHCR:
```bash
dagger call publish-image --source=. --version=1.0.0 --git-sha=abc123 --ghcr-username=your-username --ghcr-password=env://GHCR_PASSWORD
```

### Complete CI Pipeline
Run the complete CI/CD pipeline:
```bash
# Development environment
dagger call ci --source=. --version=dev-1 --git-sha=abc123 --env=dev

# Production environment (publishes Docker image)
dagger call ci --source=. --version=1.0.0 --git-sha=abc123 --env=prod --ghcr-username=your-username --ghcr-password=env://GHCR_PASSWORD
```

## Module Structure

- `src/index.ts` - Main Dagger module with CI/CD pipeline
- `src/base.ts` - Base container helpers
- `src/common.ts` - Common package build functions
- `src/backend.ts` - Backend package build functions
- `src/frontend.ts` - Frontend package build functions
- `src/docker.ts` - Docker image building and publishing functions

## GitHub Actions Integration

The project is configured to use GitHub Actions with Dagger. See `.github/workflows/ci.yml` for the complete workflow that:

- Runs on push to main branch and pull requests
- Installs Dagger CLI
- Runs the complete CI pipeline
- Publishes Docker images to GHCR on main branch pushes

## Migration Notes

This setup replaces the previous Earthly configuration with equivalent Dagger functions:

- `earthly +ci` → `dagger call ci`
- `earthly +build` → `dagger call build`
- `earthly +lint` → `dagger call check` (includes linting)
- `earthly +test` → `dagger call check` (includes testing)
- `earthly +image` → `dagger call build-image`

## Environment Variables

For production deployments, set these GitHub secrets:
- `GHCR_PASSWORD` - GitHub Container Registry token (automatically set to `github.token`)
- `DAGGER_CLOUD_TOKEN` - Optional Dagger Cloud token for enhanced features
