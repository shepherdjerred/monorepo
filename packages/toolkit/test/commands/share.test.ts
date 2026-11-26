import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  SHARE_EXIT_CODES,
  shareCommand,
  type ShareDeps,
} from "#commands/share/share.ts";
import type { ObjectStore } from "#lib/s3/object-store.ts";
import { CastGifRenderError } from "#lib/s3/cast-gif.ts";
import {
  describeShareError,
  invalidNameReason,
  randomShareId,
  redactSecrets,
  shareKeyPrefix,
} from "#lib/s3/share.ts";
import { UploadSetupError } from "#lib/s3/upload.ts";

type Put = {
  bucket: string;
  key: string;
  contentType: string;
  cacheControl?: string | undefined;
};

/** Store that records puts and otherwise does nothing. */
function recordingStore(puts: Put[]): ObjectStore {
  return {
    ...failingStore(() => new Error("not used")),
    put: (params) => {
      puts.push(params);
      return Promise.resolve();
    },
  };
}

/** Store whose every operation rejects with the produced error. */
function failingStore(makeError: () => Error): ObjectStore {
  const fail = (): Promise<never> => Promise.reject(makeError());
  return {
    put: fail,
    createMultipart: fail,
    uploadPart: fail,
    completeMultipart: fail,
    abortMultipart: fail,
  };
}

const FAKE_ACCESS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const FAKE_SECRET = "fake-secret-value-0123456789abcdef";

let dir: string;
let puts: Put[];
let profiles: string[];
let out: string[];
let err: string[];
let ids: string[];

function deps(overrides: Partial<ShareDeps> = {}): ShareDeps {
  return {
    createClient: (profile) => {
      profiles.push(profile);
      return Promise.resolve(recordingStore(puts));
    },
    now: () => new Date("2026-11-25T23:59:59Z"),
    randomId: () => ids.shift() ?? "zzzzzzzzzzzz",
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "share-test-"));
  puts = [];
  profiles = [];
  out = [];
  err = [];
  ids = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function file(name: string, contents = "hello"): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, contents);
  return target;
}

describe("key builder", () => {
  test("share/{tmp|keep}/<utc date>/<id>", () => {
    const now = new Date("2026-01-02T23:30:00-08:00");
    expect(shareKeyPrefix({ keep: false, now, id: "abc" })).toBe(
      "share/tmp/2026-01-03/abc",
    );
    expect(shareKeyPrefix({ keep: true, now, id: "abc" })).toBe(
      "share/keep/2026-01-03/abc",
    );
  });

  test("ids are 12 lowercase base32 characters and differ", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const id = randomShareId();
      expect(id).toMatch(/^[a-z2-7]{12}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(50);
  });

  test.each(["", ".", "..", "a/b", String.raw`a\b`, "a\nb"])(
    "rejects name %j",
    (name) => {
      expect(invalidNameReason(name)).toBeDefined();
    },
  );

  test("accepts an ordinary name", () => {
    expect(invalidNameReason("report v2.pdf")).toBeUndefined();
  });
});

describe("shareCommand output", () => {
  test("prints one URL per path for public, immutable cache headers", async () => {
    const a = await file("a.txt");
    const b = await file("b.png");
    const code = await shareCommand("public", [a, b], {}, deps());
    expect(code).toBe(SHARE_EXIT_CODES.ok);
    expect(out).toEqual([
      "https://public.sjer.red/share/tmp/2026-11-25/aaaaaaaaaaaa/a.txt",
      "https://public.sjer.red/share/tmp/2026-11-25/bbbbbbbbbbbb/b.png",
    ]);
    expect(puts).toEqual([
      {
        bucket: "public-sjer-red",
        key: "share/tmp/2026-11-25/aaaaaaaaaaaa/a.txt",
        body: expect.anything(),
        contentType: "text/plain; charset=utf-8",
        cacheControl: "public, max-age=31536000, immutable",
      },
      {
        bucket: "public-sjer-red",
        key: "share/tmp/2026-11-25/bbbbbbbbbbbb/b.png",
        body: expect.anything(),
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable",
      },
    ]);
    expect(err.join("\n")).toContain("expires in 30d");
  });

  test("private uses the private bucket and tailnet host; --keep uses share/keep", async () => {
    const a = await file("a.txt");
    const code = await shareCommand("private", [a], { keep: true }, deps());
    expect(code).toBe(0);
    expect(out).toEqual([
      "https://private.tailnet-1a49.ts.net/share/keep/2026-11-25/aaaaaaaaaaaa/a.txt",
    ]);
    expect(puts[0]?.bucket).toBe("private-sjer-red");
    expect(err.join("\n")).toContain("never expires");
  });

  test("--name renames the stored object and URL-encodes it", async () => {
    const a = await file("a.txt");
    await shareCommand("public", [a], { name: "my notes.txt" }, deps());
    expect(out).toEqual([
      "https://public.sjer.red/share/tmp/2026-11-25/aaaaaaaaaaaa/my%20notes.txt",
    ]);
    expect(puts[0]?.key).toBe("share/tmp/2026-11-25/aaaaaaaaaaaa/my notes.txt");
  });

  test("a directory uploads recursively and prints a trailing-slash URL", async () => {
    const site = path.join(dir, "site");
    await mkdir(path.join(site, "css"), { recursive: true });
    await writeFile(path.join(site, "page.html"), "<p>x</p>");
    await writeFile(path.join(site, "css", "s.css"), "p{}");
    await writeFile(path.join(site, ".secret"), "no");
    const code = await shareCommand("public", [site], {}, deps());
    expect(code).toBe(0);
    expect(out).toEqual([
      "https://public.sjer.red/share/tmp/2026-11-25/aaaaaaaaaaaa/site/",
    ]);
    expect(puts.map((put) => put.key)).toEqual([
      "share/tmp/2026-11-25/aaaaaaaaaaaa/site/css/s.css",
      "share/tmp/2026-11-25/aaaaaaaaaaaa/site/page.html",
    ]);
  });

  test("a cast prints the player URL and uploads recording, player, and GIF", async () => {
    const cast = await file("demo.cast", '{"version":2}\n');
    const rendered: string[] = [];
    const code = await shareCommand(
      "public",
      [cast],
      {},
      deps({
        renderCastGif: async (_cast, gif) => {
          rendered.push(gif);
          await writeFile(gif, "GIF89a");
        },
      }),
    );
    expect(code).toBe(0);
    expect(out).toEqual([
      "https://public.sjer.red/share/tmp/2026-11-25/aaaaaaaaaaaa/demo.cast.html",
    ]);
    expect(puts.map((put) => put.key)).toEqual([
      "share/tmp/2026-11-25/aaaaaaaaaaaa/demo.cast",
      "share/tmp/2026-11-25/aaaaaaaaaaaa/demo.cast.html",
      "share/tmp/2026-11-25/aaaaaaaaaaaa/demo.cast.gif",
    ]);
    expect(rendered).toHaveLength(1);
  });

  test("--json prints exactly one object on stdout", async () => {
    const a = await file("a.txt", "12345");
    const site = path.join(dir, "site");
    await mkdir(site);
    await writeFile(path.join(site, "i.html"), "<p>");
    const code = await shareCommand(
      "private",
      [a, site],
      { json: true },
      deps(),
    );
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const result: unknown = JSON.parse(out[0] ?? "");
    expect(result).toEqual({
      visibility: "private",
      expires: "30d",
      items: [
        {
          path: a,
          url: "https://private.tailnet-1a49.ts.net/share/tmp/2026-11-25/aaaaaaaaaaaa/a.txt",
          key: "share/tmp/2026-11-25/aaaaaaaaaaaa/a.txt",
          bytes: 5,
          contentType: "text/plain; charset=utf-8",
        },
        {
          path: site,
          url: "https://private.tailnet-1a49.ts.net/share/tmp/2026-11-25/bbbbbbbbbbbb/site/",
          key: "share/tmp/2026-11-25/bbbbbbbbbbbb/site/",
          bytes: 3,
          contentType: null,
        },
      ],
    });
    expect(err.some((line) => line.startsWith("uploading "))).toBe(true);
  });

  test("--json with --keep reports expires never", async () => {
    const a = await file("a.txt");
    await shareCommand("public", [a], { json: true, keep: true }, deps());
    const result: unknown = JSON.parse(out[0] ?? "");
    expect(result).toMatchObject({ expires: "never" });
  });
});

describe("profile", () => {
  test("defaults to agent-share", async () => {
    await shareCommand("public", [await file("a.txt")], {}, deps());
    expect(profiles).toEqual(["agent-share"]);
  });

  test("an explicit --profile wins", async () => {
    await shareCommand(
      "public",
      [await file("a.txt")],
      { profile: "seaweedfs" },
      deps(),
    );
    expect(profiles).toEqual(["seaweedfs"]);
  });
});

describe("exit codes and errors", () => {
  test.each([
    ["bad visibility", "world", ["x"], {}],
    ["no visibility", undefined, ["x"], {}],
    ["no paths", "public", [], {}],
  ])("%s is a usage error", async (_label, visibility, paths, options) => {
    const code = await shareCommand(visibility, paths, options, deps());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("Usage: toolkit share");
    expect(puts).toEqual([]);
    expect(out).toEqual([]);
  });

  test("--name with several paths exits 2 and uploads nothing", async () => {
    const a = await file("a.txt");
    const b = await file("b.txt");
    const code = await shareCommand("public", [a, b], { name: "x" }, deps());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("--name needs exactly one");
    expect(puts).toEqual([]);
  });

  test("an invalid --name exits 2", async () => {
    const code = await shareCommand(
      "public",
      [await file("a.txt")],
      { name: "a/b" },
      deps(),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("--name must be a single path segment");
  });

  test("a missing path exits 2 before any upload, even after a good path", async () => {
    const a = await file("a.txt");
    const code = await shareCommand(
      "public",
      [a, path.join(dir, "missing.txt")],
      {},
      deps(),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("file or directory not found");
    expect(puts).toEqual([]);
    expect(profiles).toEqual([]);
  });

  test("an empty directory exits 2", async () => {
    const empty = path.join(dir, "empty");
    await mkdir(empty);
    expect(await shareCommand("public", [empty], {}, deps())).toBe(2);
    expect(err.join("\n")).toContain("no files to upload");
  });

  test("a failing GIF render exits 2 before any upload", async () => {
    const cast = await file("demo.cast", "{}\n");
    const code = await shareCommand(
      "public",
      [cast],
      {},
      deps({
        renderCastGif: (castPath) =>
          Promise.reject(new CastGifRenderError(castPath, "agg missing")),
      }),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("brew install agg");
    expect(err.join("\n")).toContain("Nothing was uploaded");
    expect(puts).toEqual([]);
  });

  test("a missing profile names the chezmoi and credential fix", async () => {
    const code = await shareCommand(
      "public",
      [await file("a.txt")],
      {},
      deps({
        createClient: () =>
          Promise.reject(
            new UploadSetupError(
              "AWS profile 'agent-share' is not configured with a SeaweedFS endpoint_url in ~/.aws/config",
            ),
          ),
      }),
    );
    expect(code).toBe(2);
    const text = err.join("\n");
    expect(text).toContain("chezmoi apply ~/.aws/config");
    expect(text).toContain("toolkit aws credential agent-share");
    expect(out).toEqual([]);
  });

  test("an S3 AccessDenied exits 2 and --json prints nothing on stdout", async () => {
    const code = await shareCommand(
      "public",
      [await file("a.txt")],
      { json: true },
      deps({
        createClient: () =>
          Promise.resolve(
            failingStore(() =>
              Object.assign(new Error("Access Denied"), {
                name: "AccessDenied",
              }),
            ),
          ),
      }),
    );
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain(
      "access denied writing to 'public-sjer-red'",
    );
  });

  test("a failure after the first path lists what was already uploaded", async () => {
    const a = await file("a.txt");
    const b = await file("b.txt");
    let sends = 0;
    const code = await shareCommand(
      "public",
      [a, b],
      {},
      deps({
        createClient: () =>
          Promise.resolve({
            ...failingStore(() => new Error("boom")),
            put: () => {
              sends += 1;
              return sends === 1
                ? Promise.resolve()
                : Promise.reject(new Error("boom"));
            },
          }),
      }),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain(
      "Already uploaded before the failure: https://public.sjer.red/share/tmp/2026-11-25/aaaaaaaaaaaa/a.txt",
    );
  });

  test("AccessDenied on the private bucket notes it may not exist yet", () => {
    const error = Object.assign(new Error("Access Denied"), {
      name: "AccessDenied",
    });
    const text = describeShareError(error, {
      profile: "agent-share",
      visibility: "private",
    });
    expect(text).toContain("access denied writing to 'private-sjer-red'");
    expect(text).toContain("has not been created");
  });

  test("a missing private bucket explains it is not created yet", () => {
    const error = Object.assign(new Error("nope"), { name: "NoSuchBucket" });
    expect(
      describeShareError(error, {
        profile: "agent-share",
        visibility: "private",
      }),
    ).toContain("does not exist yet");
  });
});

describe("redaction", () => {
  test("scrubs credential_process JSON, ini lines, and signatures", () => {
    const text = [
      `{"AccessKeyId":"${FAKE_ACCESS_KEY}","SecretAccessKey":"${FAKE_SECRET}"}`,
      `aws_secret_access_key = ${FAKE_SECRET}`,
      "Authorization: AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261125/us-east-1/s3/aws4_request, Signature=0123456789abcdef0123456789abcdef",
      "X-Amz-Security-Token=tokentokentoken&x=1",
    ].join("\n");
    const scrubbed = redactSecrets(text);
    expect(scrubbed).not.toContain(FAKE_SECRET);
    expect(scrubbed).not.toContain(FAKE_ACCESS_KEY);
    expect(scrubbed).not.toContain("AKIDEXAMPLE");
    expect(scrubbed).not.toContain("0123456789abcdef0123456789abcdef");
    expect(scrubbed).not.toContain("tokentokentoken");
  });

  test("an S3 error carrying key material never reaches output", async () => {
    const code = await shareCommand(
      "public",
      [await file("a.txt")],
      {},
      deps({
        createClient: () =>
          Promise.resolve(
            failingStore(
              () =>
                new Error(
                  `request failed: {"SecretAccessKey":"${FAKE_SECRET}"}`,
                ),
            ),
          ),
      }),
    );
    expect(code).toBe(2);
    expect([...out, ...err].join("\n")).not.toContain(FAKE_SECRET);
  });

  test("a credential_process failure is reported without its output", () => {
    const error = new Error(
      `Could not load credentials from any providers: credential_process output ${FAKE_SECRET}`,
    );
    const text = describeShareError(error, {
      profile: "agent-share",
      visibility: "public",
    });
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).toContain("chezmoi apply ~/.aws/config");
  });
});
