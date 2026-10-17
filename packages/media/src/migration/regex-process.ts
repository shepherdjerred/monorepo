import { z } from "zod";
import { spawn } from "node:child_process";
import protocol from "./regex-protocol.schema.json" with { type: "json" };
import { RegexObservationsSchema } from "./regex-evidence.ts";
import { readRegexSchema } from "./regex-schema.ts";

const requestValidator = z.fromJSONSchema(
  readRegexSchema(protocol.$defs.request),
);

/** Production passes a published executable; operator tooling may supply dotnet run. */
export async function runRegexMatcher(
  command: readonly string[],
  requests: unknown,
) {
  const input = JSON.stringify(
    requestValidator.parse({ protocolVersion: 1, requests }),
  );
  if (input.length > protocol["x-execution"].maxInputCharacters)
    throw new Error("Regex input exceeds protocol limit");
  if (command.length === 0) throw new Error("Regex executable is required");
  const executable = command[0];
  if (executable === undefined) throw new Error("Regex executable is required");
  const output = await execute(executable, command.slice(1), input);
  const result = RegexObservationsSchema.parse(JSON.parse(output));
  if (result.culture !== "en-US") throw new Error("Regex culture mismatch");
  return result;
}

function execute(
  executable: string,
  args: readonly string[],
  input: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env["PATH"],
        DOTNET_NOLOGO: "1",
        LANG: "en_US.UTF-8",
      },
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: Error | null = null;
    const stop = (message: string) => {
      failure ??= new Error(message);
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => {
      stop("Regex matcher timed out");
    }, protocol["x-execution"].processTimeoutMilliseconds);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > protocol["x-execution"].maxInputCharacters * 6 + 1_000_000)
        stop("Regex output exceeds protocol limit");
      else chunks.push(chunk);
    });
    // Never log raw subprocess errors: they may contain a private release or regex input.
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 16_384) stop("Regex diagnostic output exceeds limit");
    });
    child.on("error", () => {
      failure ??= new Error("Regex executable could not start");
    });
    child.stdin.on("error", () => {
      failure ??= new Error("Regex input pipe failed");
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (failure !== null) reject(failure);
      else if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } else {
        reject(
          new Error(`Regex matcher failed with exit code ${String(code)}`),
        );
      }
    });
    child.stdin.end(input);
  });
}
