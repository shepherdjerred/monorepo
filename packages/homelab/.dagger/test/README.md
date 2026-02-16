# Dagger Test Scripts

This directory contains test scripts for validating Dagger builds.

## test-helm-chart.ts

This script tests the Helm chart build process by:

1. Building the Helm chart with CDK8s templates using Dagger
2. Exporting it to a local directory
3. Extracting and validating the chart contents
4. Verifying CDK8s templates are included
5. Checking that templates contain valid Kubernetes resources
6. Optional: Running Helm lint validation if available

### Usage

```bash
# Make sure you're in the project root directory
cd /path/to/homelab-docker

# Run the test script (using mise for tool management)
mise exec -- ./.dagger/test/test-helm-chart.ts

# Alternative: if bun is in PATH
bun run .dagger/test/test-helm-chart.ts
```

### Prerequisites

- Bun runtime installed
- Dagger CLI available in PATH
- The CDK8s source code in `src/cdk8s/` directory
- Optional: Helm CLI for chart linting

### What it tests

- **Build Process**: Verifies that the Helm chart build pipeline works correctly
- **CDK8s Integration**: Confirms that CDK8s-generated manifests are included as templates
- **Chart Structure**: Validates that the chart has correct structure (Chart.yaml, values.yaml, templates/)
- **Template Contents**: Checks that templates contain valid Kubernetes resources
- **Version Management**: Verifies that chart version and appVersion are set correctly
- **ArgoCD Resources**: Confirms that ArgoCD applications are present in templates
- **Homelab Resources**: Validates homelab-specific resources (PVCs, storage classes, etc.)

## test-ha-image.ts

This script tests the Home Assistant (HA) image build process by:

1. Building the HA image using Dagger
2. Exporting it to a tar file on the host
3. Loading it into Docker
4. Running the image to verify it starts correctly
5. Testing basic connectivity (if applicable)
6. Cleaning up all test artifacts

### Usage

```bash
# Make sure you're in the project root directory
cd /path/to/homelab-docker

# Run the test script (using mise for tool management)
mise exec -- ./.dagger/test/test-ha-image.ts

# Alternative: if bun is in PATH
bun run .dagger/test/test-ha-image.ts
```

### Prerequisites

- Bun runtime installed
- Docker installed and running
- Dagger CLI available in PATH
- The HA source code in `src/ha/` directory

### What it tests

- **Build Process**: Verifies that the Dagger build pipeline works correctly
- **Image Export**: Tests that the image can be exported to a tar file
- **Docker Load**: Confirms the exported image can be loaded into Docker
- **Container Startup**: Validates that the container starts without crashing
- **Basic Connectivity**: Attempts to test if the application responds (optional)

### Cleanup

The script automatically cleans up all test artifacts:

- Stops and removes test containers
- Removes test images from Docker
- Deletes temporary tar files

### Troubleshooting

If the test fails:

1. Check that all prerequisites are installed
2. Verify that the HA source code builds correctly: `cd src/ha && bun run build`
3. Ensure Docker is running and accessible
4. Check Dagger logs for build errors
5. Review container logs if the container stops unexpectedly

The script provides detailed output showing which step failed, making it easier to debug issues.
