import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

it("terminates a disconnected writer before its delayed operation can run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "discord-lifetime-"));
  const marker = path.join(directory, "sent");
  const module = path.resolve(
    import.meta.dir,
    "../../src/lib/discord/caller-lifetime.ts",
  );
  const source = `import {withinDiscordCaller} from ${JSON.stringify(module)};
const server=Bun.serve({port:0,fetch:r=>withinDiscordCaller(r,async()=>{await Bun.sleep(1000);await Bun.write(${JSON.stringify(marker)},"unexpected send");return new Response("sent");})});
console.log(server.port);`;
  const child = Bun.spawn([process.execPath, "-e", source], {
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = child.stdout.getReader();
    const first = await reader.read();
    const port = Number(new TextDecoder().decode(first.value).trim());
    const controller = new AbortController();
    const pending = (async () => {
      try {
        return await fetch(`http://127.0.0.1:${String(port)}`, {
          signal: controller.signal,
        });
      } catch {
        return null;
      }
    })();
    await Bun.sleep(100);
    controller.abort();
    await pending;
    const code = await Promise.race([
      child.exited,
      Bun.sleep(2500).then(() => {
        throw new Error("Daemon did not exit after disconnect");
      }),
    ]);
    expect(code).toBe(1);
    expect(await Bun.file(marker).exists()).toBe(false);
  } finally {
    child.kill();
    await child.exited;
    await rm(directory, { recursive: true });
  }
});
