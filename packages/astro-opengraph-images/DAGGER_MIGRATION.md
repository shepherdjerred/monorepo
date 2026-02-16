# Dagger Migration

This project now uses a Bun-powered Dagger module that runs the full CI
pipeline inside reproducible Node containers. GitHub Actions only needs
to check out the repository, install Bun, and invoke the module.

## What Changed

### Before (Earthly/Jenkins)

- `Earthfile` defined build steps
- `Jenkinsfile` defined CI pipeline
- CI ran on Jenkins with Kubernetes agents

### After (GitHub Actions + Dagger)

- `dagger.json` configures the Dagger module that lives in `.dagger/`
- `.dagger/src/index.ts` defines the build, lint, test, and example
  pipelines
- `.github/workflows/ci.yml` installs Bun, prepares the module
  dependencies with `bun install`, and executes `dagger call ci`
- CI runs on GitHub Actions while all Node work happens inside Dagger
  containers

## Available Dagger Functions

You can run these functions locally or in CI:

```bash
# list all available functions
bunx dagger functions

# run linting
bunx dagger call lint --source=.

# build the project
bunx dagger call build --source=.

# run unit tests
bunx dagger call test --source=.

# build a specific example
bunx dagger call test-example --source=. --example=custom
bunx dagger call test-example --source=. --example=preset

# run the complete CI pipeline
bunx dagger call ci --source=.
```

## Local Development

1. Install [Bun](https://bun.sh) and the [Dagger CLI](https://docs.dagger.io/cli/install)
2. Inside `.dagger/`, run `bun install --frozen-lockfile`
3. Execute any of the commands above

## CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically:

- Installs Bun and the Dagger CLI
- Installs the Dagger module dependencies with `bun install`
- Runs the complete CI pipeline using `dagger call ci --source=.`

## Implementation Notes

- Root dependencies are installed once inside a cached Node container and
  reused across lint, build, and test steps
- Example projects share the compiled package output and keep their own
  cached `node_modules` directories
- Host runners no longer need to install Node.js or project dependencies

## Troubleshooting

If you encounter issues:

1. Make sure you have the latest Bun and Dagger CLI installed
2. Check that your Docker (or compatible) container runtime is running
3. Verify that the `dagger.json` configuration is valid
4. Inspect the Dagger module code in `.dagger/src/index.ts`

For more information, see the [Dagger documentation](https://docs.dagger.io/).
