import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import type { PromotionEmailCodeReader } from "#activities/promotion/access/credential-input.ts";

const Result = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({
    status: z.literal("found"),
    code: z.string().regex(/^\d{6,8}$/),
  }),
]);

/** Explicit local capability; neither mail contents nor codes enter the agent. */
export function mailmateEmailCodeReader(): PromotionEmailCodeReader {
  const root = path.join(
    homedir(),
    "Library/Application Support/MailMate/Messages",
  );
  return async ({ account, recipient, after, signal }) => {
    if (account !== "builtbybit")
      throw new Error("MailMate code access is assigned only to BuiltByBit");
    if (after > Date.now() || after < Date.now() - 10 * 60_000)
      throw new Error("Verification challenge context is expired or invalid");
    const python = Bun.which("python3");
    const searchPath = Bun.env["PATH"];
    if (python === null || searchPath === undefined)
      throw new Error("MailMate verification requires python3 and rg on PATH");
    const deadline = Date.now() + 45_000;
    for (;;) {
      const child = Bun.spawn(
        [python, path.join(import.meta.dir, "mailmate-code.py")],
        {
          env: { PATH: searchPath },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        },
      );
      await child.stdin.write(JSON.stringify({ root, recipient, after }));
      await child.stdin.end();
      const [output, , code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0)
        throw new Error(
          "MailMate verification lookup failed; no mail contents were logged",
        );
      const parsed = Result.safeParse(JSON.parse(output));
      if (!parsed.success)
        throw new Error(
          "MailMate verification returned an invalid private response",
        );
      if (parsed.data.status === "found") return parsed.data.code;
      if (Date.now() >= deadline)
        throw new Error(
          "Fresh BuiltByBit verification email has not synced to MailMate",
        );
      signal.throwIfAborted();
      await Bun.sleep(1000);
    }
  };
}
