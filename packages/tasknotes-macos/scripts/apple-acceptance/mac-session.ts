import assert from "node:assert/strict";

export class MacSessionPreflightError extends Error {
  constructor(cause: unknown) {
    super(
      "Mac native preflight did not establish an unlocked on-console session",
      { cause },
    );
    this.name = "MacSessionPreflightError";
  }
}

export function isMacSessionPreflightFailure(error: unknown): boolean {
  return (
    error instanceof MacSessionPreflightError ||
    (error instanceof AggregateError &&
      error.errors.some(isMacSessionPreflightFailure))
  );
}

export function validateMacSession(value: unknown): void {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  assert.deepEqual(Object.keys(value).sort(), ["locked", "onConsole"]);
  assert.equal(
    Reflect.get(value, "onConsole"),
    true,
    "macOS must be on console before native testing",
  );
  assert.equal(
    Reflect.get(value, "locked"),
    false,
    "macOS must be unlocked before native testing",
  );
}

/** One retained readiness observation immediately before each native invocation. */
export async function requireUnlockedMac(
  destination: string,
  command: (argv: string[], capture?: boolean) => Promise<string>,
): Promise<void> {
  const source = `import ApplicationServices
import Foundation
guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { exit(3) }
let flags = ["onConsole": session["kCGSSessionOnConsoleKey"] as? Bool == true,
             "locked": session["CGSSessionScreenIsLocked"] as? Bool == true]
let data = try JSONSerialization.data(withJSONObject: flags, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))`;
  try {
    const value: unknown = JSON.parse(
      await command(["xcrun", "swift", "-e", source], true),
    );
    await Bun.write(destination, JSON.stringify(value, null, 2));
    validateMacSession(value);
  } catch (error) {
    throw new MacSessionPreflightError(error);
  }
}
