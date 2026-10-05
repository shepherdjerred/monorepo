import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchFiles } from "#daemon/files.ts";
import { DaemonError } from "#daemon/http.ts";
import {
  DataPathSchema,
  FilesGetResponseSchema,
  FilesListResponseSchema,
  normalizeDataPath,
  RwfListResponseSchema,
} from "#protocol/files.ts";
import { Kubectl } from "#providers/kubernetes/kubectl.ts";
import {
  type DataFiles,
  dockerExecArgv,
  ExecDataFiles,
  kubectlExecArgv,
  parseFindOutput,
  type RawEntry,
  type Spawn,
} from "#src/files/data-files.ts";
import { LIVE_CONTAINER, LIVE_POD, liveKubeTarget } from "#src/live/status.ts";

describe("data path allowlist", () => {
  it.each([
    ["plugins/TheStorm", "plugins/TheStorm"],
    ["plugins/TheStorm/storm.db", "plugins/TheStorm/storm.db"],
    ["./plugins//TheStorm/rwf-recordings/", "plugins/TheStorm/rwf-recordings"],
    ["logs/latest.log", "logs/latest.log"],
    ["logs", "logs"],
    ["world/region/r.0.0.mca", "world/region/r.0.0.mca"],
    ["wilds/region", "wilds/region"],
    ["world/DIM-1/region/r.0.0.mca", "world/DIM-1/region/r.0.0.mca"],
    ["world_the_end/DIM1/region", "world_the_end/DIM1/region"],
    [
      "world/dimensions/minecraft/overworld/region/r.0.0.mca",
      "world/dimensions/minecraft/overworld/region/r.0.0.mca",
    ],
    [
      "world/dimensions/minecraft/the_nether/region",
      "world/dimensions/minecraft/the_nether/region",
    ],
  ])("allows %s as %s", (raw, normalized) => {
    expect(normalizeDataPath(raw)).toBe(normalized);
  });

  it.each([
    ["", /outside the readable roots/u],
    ["/data/logs/latest.log", /drop the leading slash/u],
    ["/etc/passwd", /drop the leading slash/u],
    ["logs/../server.properties", /may not contain/u],
    ["plugins/TheStorm/../../ops.json", /may not contain/u],
    ["plugins", /outside the readable roots/u],
    ["plugins/LuckPerms/luckperms-h2.mv.db", /outside the readable roots/u],
    ["server.properties", /outside the readable roots/u],
    ["world/level.dat", /outside the readable roots/u],
    ["world/playerdata/x.dat", /outside the readable roots/u],
    ["world/DIM-1/data", /outside the readable roots/u],
    ["wo rld/region", /outside the readable roots/u],
    ["world/dimensions", /outside the readable roots/u],
    [
      "world/dimensions/minecraft/overworld/data",
      /outside the readable roots/u,
    ],
    ["world/players/data/x.dat", /outside the readable roots/u],
    [String.raw`logs\..\ops.json`, /Invalid path/u],
    ["logs/a\0b", /Invalid path/u],
  ])("rejects %j", (raw, message) => {
    expect(() => normalizeDataPath(raw)).toThrow(message);
    expect(DataPathSchema.safeParse(raw).success).toBe(false);
  });
});

describe("exec access", () => {
  it("parses NUL-separated find rows", () => {
    const rows = [
      "f\t12\t1791072000.5\tstorm.db",
      "d\t4096\t1791072000\trwf-recordings",
      "l\t9\t1791072000\tlink",
      "p\t0\t1791072000\twith\ttab",
      "",
    ].join("\0");
    expect(parseFindOutput(rows)).toEqual([
      {
        rel: "storm.db",
        type: "file",
        size: 12,
        mtime: "2026-10-04T00:00:00.500Z",
      },
      {
        rel: "rwf-recordings",
        type: "dir",
        size: 4096,
        mtime: "2026-10-04T00:00:00.000Z",
      },
      {
        rel: "link",
        type: "link",
        size: 9,
        mtime: "2026-10-04T00:00:00.000Z",
      },
      {
        rel: "with\ttab",
        type: "other",
        size: 0,
        mtime: "2026-10-04T00:00:00.000Z",
      },
    ]);
    expect(() => parseFindOutput("f\tbig\t1\tx\0")).toThrow(/Unexpected find/u);
  });

  it("execs in a Docker container", () => {
    expect(dockerExecArgv("abcdef012345", ["cat", "--", "/data/x"])).toEqual([
      "docker",
      "exec",
      "abcdef012345",
      "cat",
      "--",
      "/data/x",
    ]);
  });

  it("execs in live tsmc as the scoped ServiceAccount", () => {
    expect(
      kubectlExecArgv(
        new Kubectl(liveKubeTarget("admin@torvalds")),
        LIVE_POD,
        LIVE_CONTAINER,
        ["test", "-e", "/data/logs"],
      ),
    ).toEqual([
      "kubectl",
      "--context",
      "admin@torvalds",
      "--as=system:serviceaccount:mc-sandbox:mc-harness",
      "-n",
      "minecraft-tsmc",
      "exec",
      "minecraft-tsmc-0",
      "-c",
      "minecraft-tsmc",
      "--",
      "test",
      "-e",
      "/data/logs",
    ]);
  });

  it("runs only read commands, and reports a missing path as null", async () => {
    const commands: string[][] = [];
    const exitCodes = new Map([["test", 1]]);
    const spawn: Spawn = (argv) => {
      commands.push(argv);
      return {
        stdout: new Response("").body ?? new ReadableStream(),
        stderr: new Response("").body ?? new ReadableStream(),
        exited: Promise.resolve(exitCodes.get(argv[3] ?? "") ?? 0),
      };
    };
    const files = new ExecDataFiles(
      (command) => dockerExecArgv("abcdef012345", command),
      spawn,
    );
    expect(await files.resolve("/data/logs/nope")).toBeNull();
    expect(await files.list("/data/logs", false)).toEqual([]);
    expect(await files.list("/data/logs", true)).toEqual([]);
    await files.read("/data/logs/latest.log").done;
    expect(commands.map((argv) => argv.slice(3))).toEqual([
      ["test", "-e", "/data/logs/nope"],
      [
        "find",
        "/data/logs",
        "-mindepth",
        "1",
        "-maxdepth",
        "1",
        "-printf",
        String.raw`%y\t%s\t%T@\t%P\0`,
      ],
      [
        "find",
        "/data/logs",
        "-mindepth",
        "1",
        "-printf",
        String.raw`%y\t%s\t%T@\t%P\0`,
      ],
      ["cat", "--", "/data/logs/latest.log"],
    ]);
  });

  it("fails a read whose command exits non-zero", async () => {
    const files = new ExecDataFiles(
      (command) => [...command],
      () => ({
        stdout: new Response("").body ?? new ReadableStream(),
        stderr: new Response("No such file").body ?? new ReadableStream(),
        exited: Promise.resolve(1),
      }),
    );
    await expect(files.read("/data/logs/x").done).rejects.toThrow(
      /No such file/u,
    );
  });
});

/** DataFiles over a local directory standing in for the server's /data. */
class LocalDataFiles implements DataFiles {
  constructor(private readonly root: string) {}

  private local(abs: string): string {
    return path.join(this.root, abs.slice("/data".length));
  }

  async resolve(abs: string): Promise<string | null> {
    const real = await realpath(this.local(abs)).catch(() => null);
    if (real === null) {
      return null;
    }
    return real.startsWith(`${this.root}/`)
      ? `/data/${real.slice(this.root.length + 1)}`
      : real;
  }

  async list(abs: string, recursive: boolean): Promise<RawEntry[]> {
    const dir = this.local(abs);
    const names = await readdir(dir, { recursive });
    return Promise.all(
      names.map(async (rel) => {
        const info = await lstat(path.join(dir, rel));
        return {
          rel,
          type: info.isSymbolicLink() ? "link" : info.isFile() ? "file" : "dir",
          size: info.size,
          mtime: info.mtime.toISOString(),
        };
      }),
    );
  }

  read(abs: string) {
    return {
      stream: Bun.file(this.local(abs)).stream(),
      done: Promise.resolve(),
    };
  }
}

const MATCH = "0b5f4c8e-2f9a-4d3b-9c1e-7a6d5e4f3a2b";
const OTHER_MATCH = "1c6e5d9f-3a0b-4e4c-8d2f-8b7e6f5a4b3c";

describe("files routes", () => {
  let root: string;
  let out: string;
  let files: LocalDataFiles;
  const logged: string[] = [];
  const ctx = {
    files: (id: string) =>
      id === "sbx-abc123"
        ? Promise.resolve(files)
        : Promise.reject(new Error(`unexpected target ${id}`)),
    log: (msg: string) => {
      logged.push(msg);
    },
  };

  async function put(rel: string, content: string | Uint8Array) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await Bun.write(path.join(root, rel), content);
  }

  async function call(
    method: string,
    action: string,
    payload?: unknown,
    query = "",
  ) {
    const url = new URL(`http://mc/files/sbx-abc123/${action}${query}`);
    try {
      return await dispatchFiles(
        ctx,
        url,
        new Request(url.toString(), {
          method,
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        }),
        { target: "sbx-abc123", action },
      );
    } catch (error) {
      if (error instanceof DaemonError) {
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  async function listRwfAll() {
    const response = await call("GET", "rwf");
    return RwfListResponseSchema.parse(await response.json());
  }

  beforeEach(async () => {
    const base = await realpath(
      await mkdtemp(path.join(tmpdir(), "mc-files-")),
    );
    root = path.join(base, "data");
    out = path.join(base, "out");
    files = new LocalDataFiles(root);
    await put("logs/latest.log", "[Server thread/INFO]: Done\n");
    await put("plugins/TheStorm/storm.db", "SQLite format 3\0");
    await put("server.properties", "rcon.password=hunter2\n");
    await put(
      `plugins/TheStorm/rwf-recordings/2026/10/04/${MATCH}.rwfrec.gz`,
      gzipSync("row 1\nrow 2\n"),
    );
    await put(
      `plugins/TheStorm/rwfbots-traces/${MATCH}.gz`,
      gzipSync("think\n"),
    );
    await put(
      `plugins/TheStorm/rwfbots-traces/${OTHER_MATCH}.gz`,
      gzipSync("x"),
    );
    await put("plugins/TheStorm/rwfbots-traces/notes.gz", gzipSync("x"));
  });

  it("lists a directory", async () => {
    const response = await call("GET", "ls", undefined, "?path=./logs/");
    expect(response.status).toBe(200);
    const listed = FilesListResponseSchema.parse(await response.json());
    expect(listed.path).toBe("logs");
    expect(listed.entries.map((entry) => [entry.name, entry.type])).toEqual([
      ["latest.log", "file"],
    ]);
  });

  it("pulls a file with its hash", async () => {
    const target = path.join(out, "storm.db");
    const response = await call("POST", "get", {
      path: "plugins/TheStorm/storm.db",
      out: target,
      force: false,
      gunzip: false,
    });
    expect(response.status).toBe(200);
    const got = FilesGetResponseSchema.parse(await response.json());
    expect(got).toMatchObject({ path: "plugins/TheStorm/storm.db", bytes: 16 });
    expect(got.sha256).toBe(
      new Bun.CryptoHasher("sha256").update("SQLite format 3\0").digest("hex"),
    );
    expect(await Bun.file(target).text()).toBe("SQLite format 3\0");
    expect(logged).toContain("files get");

    const again = await call("POST", "get", {
      path: "plugins/TheStorm/storm.db",
      out: target,
      force: false,
      gunzip: false,
    });
    expect(again.status).toBe(409);
  });

  it.each([
    ["server.properties", 400],
    ["/data/server.properties", 400],
    ["logs/../server.properties", 400],
    ["logs/missing.log", 404],
  ])("refuses to pull %s", async (source, status) => {
    const response = await call("POST", "get", {
      path: source,
      out: path.join(out, "x"),
      force: false,
      gunzip: false,
    });
    expect(response.status).toBe(status);
  });

  it("refuses a symlink that resolves outside the allowlist", async () => {
    await symlink(
      path.join(root, "server.properties"),
      path.join(root, "logs/props.log"),
    );
    await symlink(
      path.join(root, ".."),
      path.join(root, "plugins/TheStorm/up"),
    );
    for (const source of ["logs/props.log", "plugins/TheStorm/up"]) {
      const response = await call("POST", "get", {
        path: source,
        out: path.join(out, "x"),
        force: false,
        gunzip: false,
      });
      expect(response.status).toBe(403);
    }
    expect(await Bun.file(path.join(out, "x")).exists()).toBe(false);
  });

  it("lists rwf recordings and traces by match", async () => {
    const response = await call("GET", "rwf", undefined, `?match=${MATCH}`);
    const listed = RwfListResponseSchema.parse(await response.json());
    expect(
      listed.artifacts.map((artifact) => [artifact.kind, artifact.path]),
    ).toEqual(
      expect.arrayContaining([
        [
          "recording",
          `plugins/TheStorm/rwf-recordings/2026/10/04/${MATCH}.rwfrec.gz`,
        ],
        ["trace", `plugins/TheStorm/rwfbots-traces/${MATCH}.gz`],
      ]),
    );
    expect(listed.artifacts).toHaveLength(2);

    const all = await listRwfAll();
    expect(
      all.artifacts.map((artifact) => artifact.matchId).toSorted(),
    ).toEqual([MATCH, MATCH, OTHER_MATCH]);
  });

  it("downloads and gunzips a recording", async () => {
    const response = await call("POST", "rwf-get", {
      matchId: MATCH,
      kind: "recording",
      outDir: out,
      force: false,
      gunzip: true,
    });
    expect(response.status).toBe(200);
    const got = FilesGetResponseSchema.parse(await response.json());
    expect(got.out).toBe(path.join(out, `${MATCH}.rwfrec`));
    expect(got.gunzipped).toBe(true);
    expect(await Bun.file(got.out).text()).toBe("row 1\nrow 2\n");

    const missing = await call("POST", "rwf-get", {
      matchId: OTHER_MATCH,
      kind: "recording",
      outDir: out,
      force: false,
      gunzip: false,
    });
    expect(missing.status).toBe(404);
  });

  it("returns no artifacts when the plugin has not recorded yet", async () => {
    files = new LocalDataFiles(path.join(root, "..", "empty"));
    await mkdir(path.join(root, "..", "empty"), { recursive: true });
    const listed = await listRwfAll();
    expect(listed.artifacts).toEqual([]);
  });
});
