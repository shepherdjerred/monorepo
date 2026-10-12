import { expect, test } from "vitest";

test.runIf(process.platform === "win32")(
  "Windows passthrough preserves arguments, environment, streams, and exit status",
  async () => {
    const modulePath = new URL("../../src/lib/passthrough.ts", import.meta.url)
      .href;
    const program = `
      import { runPassthrough } from ${JSON.stringify(modulePath)};
      process.exit(await runPassthrough({
        executable: process.execPath,
        args: ["-e", "console.log(process.argv[1]); console.log(process.env.PASSTHROUGH_TEST); console.error('child stderr'); process.exit(23)", "a b --literal"],
        env: { ...process.env, PASSTHROUGH_TEST: "inherited value" },
      }));
    `;
    const child = Bun.spawn([process.execPath, "-e", program], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status).toBe(23);
    expect(stdout).toBe("a b --literal\ninherited value\n");
    expect(stderr).toBe("child stderr\n");
  },
);
