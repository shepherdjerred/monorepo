import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { readOpLog } from "@shepherdjerred/mc-harness/protocol/build.ts";
import { withPublicationLock } from "@shepherdjerred/mc-harness/protocol/publication-lock.ts";
import {
  mcCmdCommand,
  mcPasteCommand,
  mcWeCommand,
} from "#commands/mc/world.ts";

const state = vi.hoisted(() => ({
  send: vi.fn<(route: string, body: unknown) => Promise<unknown>>(),
}));
vi.mock("#lib/mc/client.ts", () => ({
  daemonSend: (
    _schema: unknown,
    _method: unknown,
    route: string,
    init: { body?: unknown },
  ) => state.send(route, init.body),
}));
const root = await mkdtemp(path.join(os.tmpdir(), "toolkit-recording-"));
afterAll(async () => rm(root, { recursive: true }));
afterEach(() => {
  vi.restoreAllMocks();
  state.send.mockReset();
});
const position = { x: 0, y: 0, z: 0 };

it.each(["command", "we", "paste"] as const)(
  "excludes snapshots through the %s write and records the exact successful payload",
  async (kind) => {
    const dir = path.join(root, kind);
    await Bun.write(path.join(dir, "build.json"), "{}");
    const file = path.join(dir, "input.schem");
    const bytes = new Uint8Array([1, 2, 3]);
    await Bun.write(file, bytes);
    const options = {
      target: "sbx-abc123",
      json: true,
      record: dir,
      session: "test",
      world: "world",
    };
    const execute = () =>
      kind === "command"
        ? mcCmdCommand(options, "say test")
        : kind === "we"
          ? mcWeCommand(options, {
              command: "//set air",
              pos1: position,
              pos2: position,
            })
          : mcPasteCommand(options, {
              file,
              at: position,
              rotate: 0,
              ignoreAir: true,
            });
    state.send.mockImplementation(async (route, body) => {
      expect(route).toBe(`/targets/sbx-abc123/${kind}`);
      await expect(
        withPublicationLock(dir, () => Promise.resolve()),
      ).rejects.toThrow(/already running/u);
      expect(await readOpLog(dir)).toEqual({ version: 1, ops: [] });
      if (kind === "paste") {
        expect(body).toMatchObject({
          schematic: Buffer.from(bytes).toString("base64"),
        });
        // A file edited during the server call must not change the recorded paste.
        await Bun.write(file, new Uint8Array([9, 9, 9]));
      }
      return kind === "command"
        ? { success: true, output: [] }
        : kind === "we"
          ? {
              results: [{ ok: true, changed: 1, messages: [], errors: [] }],
              historySize: 1,
            }
          : { changed: 1, min: position, max: position, historySize: 1 };
    });
    await withPublicationLock(dir, async () => {
      await expect(execute()).rejects.toThrow(/already running/u);
      expect(state.send).not.toHaveBeenCalled();
    });
    state.send.mockRejectedValueOnce(new Error("simulated server failure"));
    await expect(execute()).rejects.toThrow(/server failure/u);
    expect(await readOpLog(dir)).toEqual({ version: 1, ops: [] });
    await execute();
    const log = await readOpLog(dir);
    expect(log.ops).toHaveLength(1);
    expect(log.ops[0]).toMatchObject({ kind, source: "manual" });
    const op = log.ops[0];
    if (op?.kind === "paste")
      expect(await Bun.file(path.join(dir, op.schematic)).bytes()).toEqual(
        bytes,
      );
    await withPublicationLock(dir, () => Promise.resolve());
  },
);
