import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isServedPath,
  readServerFile,
  serverFileUrl,
  serverLogs,
  type ServerFiles,
} from "#e2e/harness/external/files.ts";
import {
  startServerFilesService,
  type ServerFilesService,
} from "#e2e/harness/external/files-service.ts";
import { stormDataFile } from "./e2e/harness/storm-data.ts";
import type { ServerInfo } from "./e2e/harness/server.ts";

const token = "server-files-test-token";
let scratch: string;
let service: ServerFilesService;
let files: ServerFiles & { kind: "http" };

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "storm-server-files-"));
  const data = path.join(scratch, "data");
  await mkdir(path.join(data, "logs"), { recursive: true });
  await mkdir(path.join(data, "plugins", "TheStorm", "rwf-recordings"), {
    recursive: true,
  });
  await Bun.write(path.join(data, "logs", "latest.log"), "Done (1.0s)!\n");
  await Bun.write(path.join(data, "server.properties"), "rcon.password=x\n");
  await Bun.write(
    path.join(data, "plugins", "TheStorm", "the-storm.db"),
    new Uint8Array([0, 1, 2, 255]),
  );
  await Bun.write(
    path.join(data, "plugins", "TheStorm", "rwf-recordings", "m 1.gz"),
    "recording",
  );
  await Bun.write(path.join(scratch, "outside.txt"), "secret");
  await symlink(
    path.join(scratch, "outside.txt"),
    path.join(data, "plugins", "TheStorm", "escape.txt"),
  );
  service = await startServerFilesService({ dataDir: data, token, port: 0 });
  files = {
    kind: "http",
    url: `http://127.0.0.1:${service.port.toString()}`,
    token,
  };
});

afterAll(async () => {
  await service.stop();
  await rm(scratch, { recursive: true, force: true });
});

async function status(
  relativeUrl: string,
  { bearer = token, method = "GET" } = {},
): Promise<number> {
  const response = await fetch(new URL(relativeUrl, files.url), {
    method,
    headers: { authorization: `Bearer ${bearer}` },
  });
  return response.status;
}

describe("server files", () => {
  it("serves only the Paper log and TheStorm's data folder", () => {
    expect(isServedPath("logs/latest.log")).toBe(true);
    expect(isServedPath("plugins/TheStorm/the-storm.db")).toBe(true);
    expect(isServedPath("plugins/TheStorm/rwf-recordings/a/b.gz")).toBe(true);
    for (const refused of [
      "logs/debug.log",
      "server.properties",
      "plugins/TheStorm",
      "plugins/Other/config.yml",
      "plugins/TheStorm/../../server.properties",
      "plugins/TheStorm//the-storm.db",
      "/plugins/TheStorm/the-storm.db",
    ])
      expect(isServedPath(refused), refused).toBe(false);
    expect(() => serverFileUrl(files.url, "server.properties")).toThrow(
      "not a served server file",
    );
  });

  it("reads the log and data files over HTTP with the token", async () => {
    expect(
      await readServerFile(files, "plugins/TheStorm/the-storm.db"),
    ).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(
      new TextDecoder().decode(
        await readServerFile(files, "plugins/TheStorm/rwf-recordings/m 1.gz"),
      ),
    ).toBe("recording");
    expect(
      await readServerFile(files, "plugins/TheStorm/missing.db"),
    ).toBeUndefined();
    const info: ServerInfo = {
      kind: "external",
      host: "127.0.0.1",
      gamePort: 25_565,
      rconPort: 25_575,
      rconPassword: "qualification-rcon-password",
      queryPort: null,
      files,
    };
    expect(await serverLogs(info)).toBe("Done (1.0s)!\n");
    const copied = await stormDataFile(
      info,
      "the-storm.db",
      path.join(scratch, "copies"),
    );
    expect(copied).toBe(path.join(scratch, "copies", "the-storm.db"));
    expect(
      await stormDataFile(info, "absent.db", path.join(scratch, "copies")),
    ).toBeUndefined();
  });

  it("refuses wrong tokens, other files, escapes and writes", async () => {
    expect(
      await status("/v1/server-files/logs/latest.log", { bearer: "wrong" }),
    ).toBe(401);
    expect(await status("/v1/server-files/server.properties")).toBe(403);
    expect(
      await status(
        "/v1/server-files/plugins/TheStorm/..%2F..%2Fserver.properties",
      ),
    ).toBe(403);
    expect(await status("/v1/server-files/plugins/TheStorm/escape.txt")).toBe(
      404,
    );
    expect(
      await status("/v1/server-files/logs/latest.log", { method: "POST" }),
    ).toBe(405);
    await expect(
      readServerFile(
        { ...files, token: "wrong-token-of-16+" },
        "logs/latest.log",
      ),
    ).rejects.toThrow("HTTP 401");
  });

  it("reads the CI sidecar's shared folders", async () => {
    const shared: ServerFiles = {
      kind: "shared",
      logFile: path.join(scratch, "data", "logs", "latest.log"),
      stormDataDir: path.join(scratch, "data", "plugins", "TheStorm"),
    };
    expect(
      new TextDecoder().decode(await readServerFile(shared, "logs/latest.log")),
    ).toBe("Done (1.0s)!\n");
    expect(
      await readServerFile(shared, "plugins/TheStorm/the-storm.db"),
    ).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(
      await readServerFile(shared, "plugins/TheStorm/missing.db"),
    ).toBeUndefined();
  });
});
