# Dagger Module for sjer.red

This directory contains the Dagger module for building and deploying the sjer.red website.

## Usage

```bash
# Build the site
dagger call build --source=.

# Run linting
dagger call lint --source=.

# Run tests
dagger call test --source=.

# Deploy to Cloudflare Pages
dagger call deploy --source=. --branch=main --git-sha=<commit-hash>
```

## Development

The Dagger module is written in TypeScript and uses Bun as the runtime.
