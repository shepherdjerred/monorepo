import { describe, expect, it } from "vitest";
import { stopPrism } from "#daemon/prism-process.ts";

describe("Prism process shutdown", () => {
  it("terminates only a process with the exact session argument", async () => {
    const bootstrap = `/tmp/storm-stop-test-${crypto.randomUUID()}`;
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        'exec -a "$1" /bin/sleep 60',
        "test",
        `java -Dstorm.client.session=${bootstrap}`,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      await stopPrism(bootstrap, 500);
      expect(await child.exited).not.toBe(0);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
});
