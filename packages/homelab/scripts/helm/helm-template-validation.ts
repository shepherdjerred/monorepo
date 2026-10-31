import { mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAXIMUM_STDOUT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_STDERR_BYTES = 64 * 1024;

async function capture(
  stream: ReadableStream<Uint8Array>,
  file: FileHandle,
  maximumBytes: number,
): Promise<number> {
  let totalBytes = 0;
  for await (const bytes of stream) {
    const remaining = Math.max(0, maximumBytes - totalBytes);
    if (remaining > 0) await file.writeFile(bytes.subarray(0, remaining));
    totalBytes += bytes.length;
  }
  return totalBytes;
}

/** Validate a real template without copying its complete manifests into CI/operator output. */
export async function validateHelmTemplate(
  chartDirectory: string,
  validationArguments: readonly string[],
  diagnosticRoot = tmpdir(),
): Promise<void> {
  // Separate ownership keeps failures available when release staging is cleaned.
  const directory = await mkdtemp(
    path.join(diagnosticRoot, "helm-template-validation-"),
  );
  const outputPath = path.join(directory, "stdout.log");
  const stdout = await open(outputPath, "wx", 0o600);
  const diagnosticPath = `${outputPath}.stderr`;
  let stderr: FileHandle | undefined;
  let passed = false;
  let diagnosticBytes = 0;
  try {
    stderr = await open(diagnosticPath, "wx", 0o600);
    const child = Bun.spawn(
      [
        "helm",
        "template",
        "release-validation",
        chartDirectory,
        ...validationArguments,
      ],
      {
        env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    let outputBytes: number;
    let exitCode: number;
    try {
      [outputBytes, diagnosticBytes, exitCode] = await Promise.all([
        capture(child.stdout, stdout, MAXIMUM_STDOUT_BYTES),
        capture(child.stderr, stderr, MAXIMUM_STDERR_BYTES),
        child.exited,
      ]);
    } catch (error) {
      child.kill("SIGTERM");
      await child.exited;
      throw error;
    }
    const oversized =
      outputBytes > MAXIMUM_STDOUT_BYTES ||
      diagnosticBytes > MAXIMUM_STDERR_BYTES;
    if (exitCode !== 0 || oversized) {
      // Rendered values and raw tool diagnostics stay in private, size-bounded files.
      throw new Error(
        `Helm template validation failed (exit ${String(exitCode)}, output limit exceeded: ${String(oversized)}); private output: ${outputPath}; private diagnostics: ${diagnosticPath}`,
        { cause: { outputPath, diagnosticPath } },
      );
    }
    passed = true;
  } finally {
    await Promise.all([stdout.close(), stderr?.close()]);
    if (passed) {
      await rm(outputPath);
      if (diagnosticBytes === 0) await rm(directory, { recursive: true });
      else
        console.warn(
          `Helm template validation emitted diagnostics; retained privately at ${diagnosticPath}`,
        );
    }
  }
}
