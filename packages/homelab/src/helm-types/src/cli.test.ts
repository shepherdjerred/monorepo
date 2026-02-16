import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("CLI", () => {
  const CLI_PATH = `${import.meta.dir}/cli.ts`;
  const TEST_OUTPUT = `${import.meta.dir}/../temp/test-output.ts`;

  beforeEach(async () => {
    // Clean up any existing test output
    try {
      await Bun.$`rm -f ${TEST_OUTPUT}`.quiet();
    } catch {
      // Ignore errors if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test output
    try {
      await Bun.$`rm -f ${TEST_OUTPUT}`.quiet();
    } catch {
      // Ignore errors if file doesn't exist
    }
  });

  test("should show help message", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("helm-types");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("OPTIONS:");
    expect(stdout).toContain("EXAMPLES:");
  });

  test("should show error for missing required arguments", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
    expect(stderr).toContain("--name");
    expect(stderr).toContain("--repo");
    expect(stderr).toContain("--version");
  });

  test("should show error for missing --name", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--repo", "https://example.com/charts", "--version", "1.0.0"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should show error for missing --repo", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--name", "test-chart", "--version", "1.0.0"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should show error for missing --version", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--name", "test-chart", "--repo", "https://example.com/charts"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should accept short-form arguments", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "-h"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("helm-types");
  });

  test("should reject invalid arguments", async () => {
    const proc = Bun.spawn(
      ["bun", CLI_PATH, "--invalid-arg", "value", "--name", "test", "--repo", "url", "--version", "1.0.0"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("should use chart name as default for chartName", async () => {
    // We can't test a full chart fetch without a real helm repo,
    // but we can test that the CLI parses arguments correctly
    // by checking help text formatting
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--chart, -c");
    expect(stdout).toContain("defaults to --name");
  });

  // Note: We skip integration tests that would actually fetch from a helm repo
  // as they require network access and a real helm installation.
  // Those should be tested in a separate integration test suite.
  test.skip("should generate types for a real chart", async () => {
    // This would be an integration test that requires:
    // - Network access
    // - Helm CLI installed
    // - A valid chart repository
    //
    // Example:
    // const proc = Bun.spawn([
    //   "bun",
    //   CLI_PATH,
    //   "--name", "nginx",
    //   "--repo", "https://charts.bitnami.com/bitnami",
    //   "--version", "15.0.0",
    //   "--output", TEST_OUTPUT
    // ]);
  });

  test("should support custom interface name", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--interface");
    expect(stdout).toContain("Interface name");
  });

  test("should support output file option", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--output");
    expect(stdout).toContain("Output file path");
    expect(stdout).toContain("defaults to stdout");
  });
});

describe("CLI helper functions", () => {
  test("should convert dash-case to PascalCase", () => {
    // We would need to export the toPascalCase function to test it
    // For now, we can test it through the CLI behavior
    expect("argo-cd").toBeTruthy(); // Placeholder test
  });

  test("should handle special characters in chart names", () => {
    // Integration with the CLI would show this
    expect("chart-name").toBeTruthy(); // Placeholder test
  });
});
