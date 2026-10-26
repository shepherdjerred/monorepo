import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each([undefined, ""])(
  "fails closed without a service account (%s) instead of opening desktop 1Password",
  async (token) => {
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "enroll-logins.ts"),
        "--bindings",
        "unused-bindings.json",
      ],
      {
        env: {
          PATH: "",
          ...(token === undefined ? {} : { OP_SERVICE_ACCOUNT_TOKEN: token }),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [error, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).not.toBe(0);
    expect(error).toContain("with-service-account.sh");
    expect(error).not.toContain("Executable not found");
  },
);

it("rejects desktop bindings before invoking 1Password", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "promotion-enrollment-"));
  try {
    const bindings = path.join(directory, "bindings.json");
    await Bun.write(
      bindings,
      JSON.stringify([
        {
          account: "fixture",
          reference: "op://fixturevault/fixtureitem",
          backend: "desktop",
          hosts: ["example.invalid"],
        },
      ]),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "enroll-logins.ts"),
        "--bindings",
        bindings,
      ],
      {
        env: { PATH: directory, OP_SERVICE_ACCOUNT_TOKEN: "fixture-only" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [error, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).not.toBe(0);
    expect(error).toContain("service-account");
    expect(error).not.toContain("Executable not found");
  } finally {
    await rm(directory, { recursive: true });
  }
});
