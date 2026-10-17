import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPokemonctl } from "./pokemonctl-mcp.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

it("passes shell metacharacters as literal control arguments", async () => {
  let received: unknown;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received = await request.json();
      return Response.json({ ok: true });
    },
  });
  try {
    const message = "$(printenv) ; cat /proc/1/environ | sh";
    const result = await runPokemonctl(["progress", message], {
      POKEMONCTL_URL: `http://127.0.0.1:${String(server.port)}`,
      POKEMONCTL_TOKEN: "synthetic-control",
      POKEMONCTL_GOAL_ID: "synthetic-goal",
      CODEX_ACCESS_TOKEN: "synthetic-provider-token",
    });
    expect(result.isError).toBe(false);
    expect(received).toEqual({ message });
  } finally {
    await server.stop(true);
  }
});

it("attaches screenshots only from the configured directory and rejects symlink escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pokemon-mcp-image-"));
  roots.push(root);
  const image = path.join(root, "pokemon-10-20.png");
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(image, png);
  let responsePath = image;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ path: responsePath, frame: 10 });
    },
  });
  const env = {
    POKEMONCTL_URL: `http://127.0.0.1:${String(server.port)}`,
    POKEMONCTL_TOKEN: "synthetic-control",
    POKEMONCTL_GOAL_ID: "synthetic-goal",
    POKEMONCTL_SCREENSHOT_DIRECTORY: root,
  };
  try {
    const result = await runPokemonctl(["screenshot"], env);
    expect(result.content[1]).toEqual({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from(png).toString("base64"),
    });
    const secretRoot = await mkdtemp(
      path.join(tmpdir(), "pokemon-mcp-private-"),
    );
    roots.push(secretRoot);
    const secret = path.join(secretRoot, "private");
    await writeFile(secret, "synthetic-private-credential");
    responsePath = path.join(root, "pokemon-11-21.png");
    await symlink(secret, responsePath);
    await expect(runPokemonctl(["screenshot"], env)).rejects.toThrow(
      "Goal screenshot escaped its output directory",
    );
  } finally {
    await server.stop(true);
  }
});
