import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UserSchema } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { MigrationSnapshotSchema } from "#shared/migration.ts";
import { type ManualSubtitle, type SubtitleTarget } from "#shared/admin.ts";
import { submitSubtitleUpload } from "./admin.tsx";
import { uploadMigrationCapture } from "./migration.tsx";
import {
  commandKey,
  queryClient,
  readSession,
  sessionBoundary,
  writeApi,
} from "./api.ts";
import { SessionChangedError } from "./session.ts";

const owner = UserSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  plexAccountId: "upload-owner",
  displayName: "Upload Owner",
  role: "owner",
  restricted: false,
  version: 1,
});
const snapshot = MigrationSnapshotSchema.parse({
  schemaVersion: 1,
  sourceKind: "radarr",
  sourceInstanceId: "a".repeat(64),
  sourceVersion: "1.0.0",
  startedAt: "2026-10-17T01:00:00Z",
  completedAt: "2026-10-17T01:01:00Z",
  records: [],
  endpoints: [
    {
      name: "media",
      pages: 1,
      records: 0,
      digest: "b".repeat(64),
      complete: true,
      stable: true,
      reason: "complete",
    },
  ],
});
const target: SubtitleTarget = {
  assetId: "00000000-0000-4000-8000-000000000002",
  version: 3,
  checksum: "c".repeat(64),
  filename: "film.mkv",
  titles: ["Film"],
  installedLanguages: [],
  subtitles: [],
};
const subtitleContent = "1\n00:00:00,000 --> 00:00:01,000\nHello\n";

function fixture() {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  let currentUser = owner;
  const posts: { url: string; input: RequestInit }[] = [];
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("document", { cookie: "media-csrf=synthetic-only" });
  vi.stubGlobal("fetch", (url: string, input?: RequestInit) => {
    if (url === "/api/v1/me")
      return Promise.resolve(Response.json(currentUser));
    if (input?.method !== "POST")
      throw new Error(`Unexpected upload request: ${url}`);
    posts.push({ url, input });
    return Promise.resolve(
      Response.json(
        url === "/api/v1/admin/subtitles"
          ? { status: "queued" }
          : {
              source: {
                kind: snapshot.sourceKind,
                instanceId: snapshot.sourceInstanceId,
                version: snapshot.sourceVersion,
              },
              id: "00000000-0000-4000-8000-000000000003",
              captureId: "00000000-0000-4000-8000-000000000004",
              reportHash: "d".repeat(64),
              captureHash: "e".repeat(64),
              recoveryEpoch: 1,
              runtimeVersion: 1,
              version: 1,
              status: "awaiting_review",
              createdAt: "2026-10-17T01:02:00Z",
              report: {
                schemaVersion: 1,
                captureHash: "e".repeat(64),
                reportHash: "d".repeat(64),
                complete: true,
                stable: true,
                entries: [],
                mayTransferOwnership: false,
              },
            },
      ),
    );
  });
  return {
    posts,
    storage,
    refresh: (user = owner) => {
      currentUser = user;
      return readSession();
    },
  };
}

function deferredMigration(envelope = false) {
  const read = Promise.withResolvers<string>();
  const file = new File(["synthetic capture"], "capture.json");
  const text = vi.spyOn(file, "text").mockReturnValue(read.promise);
  return {
    start: () => uploadMigrationCapture(owner.id, file),
    assertReading: () => expect(text).toHaveBeenCalledExactlyOnceWith(),
    complete: () =>
      read.resolve(JSON.stringify(envelope ? { snapshot } : snapshot)),
  };
}

function deferredSubtitle() {
  const readers: DeferredFileReader[] = [];
  const read = vi.fn<(file: Blob) => void>();
  class DeferredFileReader extends EventTarget {
    result: string | null = null;
    constructor() {
      super();
      readers.push(this);
    }
    readAsDataURL(file: Blob) {
      read(file);
    }
  }
  vi.stubGlobal("FileReader", DeferredFileReader);
  const file = new File([subtitleContent], "film.en.srt");
  const form = new FormData();
  form.set("subtitle", file);
  form.set("encoding", "bom");
  form.set("replacementFor", "");
  form.set("language", "en");
  form.set("description", "Translator and exact release confirmed");
  form.set("confirmed", "on");
  form.set("hearingImpaired", "unknown");
  const dispatch = vi.fn((subtitle: ManualSubtitle) =>
    writeApi({
      actorId: owner.id,
      path: "/admin/subtitles",
      body: subtitle,
      schema: CommandResultSchema,
    }),
  );
  return {
    start: () =>
      submitSubtitleUpload({ actorId: owner.id, form, target }, dispatch),
    assertReading: () => expect(read).toHaveBeenCalledExactlyOnceWith(file),
    complete: () => {
      const [reader] = readers;
      if (reader === undefined) throw new Error("Subtitle read never started");
      reader.result = `data:text/plain;base64,${btoa(subtitleContent)}`;
      reader.dispatchEvent(new Event("load"));
    },
    dispatch,
  };
}

beforeEach(() => {
  sessionBoundary.publish(
    owner,
    sessionBoundary.getSnapshot().generation,
    "login",
  );
  queryClient.clear();
});
afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ["capture File.text", deferredMigration],
  ["subtitle FileReader", deferredSubtitle],
] as const)("%s session isolation", (_label, deferredUpload) => {
  test.each([
    ["principal", { ...owner, id: "00000000-0000-4000-8000-000000000005" }],
    ["permission version", { ...owner, version: 2 }],
    ["role", { ...owner, role: "member" as const }],
    ["restriction", { ...owner, restricted: true }],
    ["Plex identity", { ...owner, plexAccountId: "another-account" }],
  ])(
    "%s change during preprocessing prevents every POST",
    async (_change, user) => {
      const f = fixture();
      const upload = deferredUpload();
      const pending = upload.start();
      const rejected =
        expect(pending).rejects.toBeInstanceOf(SessionChangedError);
      upload.assertReading();
      await f.refresh(user);
      upload.complete();
      await rejected;
      expect(f.posts).toEqual([]);
    },
  );

  test("logout during preprocessing prevents every POST", async () => {
    const f = fixture();
    const upload = deferredUpload();
    const pending = upload.start();
    const rejected =
      expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    upload.assertReading();
    sessionBoundary.publish(
      null,
      sessionBoundary.getSnapshot().generation,
      "logout",
    );
    upload.complete();
    await rejected;
    expect(f.posts).toEqual([]);
  });
});

test.each([false, true])(
  "an unchanged session permits capture upload (envelope=%s)",
  async (envelope) => {
    const f = fixture();
    const upload = deferredMigration(envelope);
    const pending = upload.start();
    upload.assertReading();
    await f.refresh();
    upload.complete();
    await expect(pending).resolves.toMatchObject({ status: "awaiting_review" });
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]).toMatchObject({
      url: "/api/v1/admin/migration",
      input: { body: JSON.stringify({ snapshot }) },
    });
  },
);

test("an unchanged session permits subtitle upload with its actor-bound command identity", async () => {
  const f = fixture();
  const upload = deferredSubtitle();
  const pending = upload.start();
  upload.assertReading();
  await f.refresh();
  upload.complete();
  await pending;
  expect(upload.dispatch).toHaveBeenCalledOnce();
  expect(f.posts).toHaveLength(1);
  const body = {
    assetId: target.assetId,
    expectedAssetVersion: target.version,
    expectedChecksum: target.checksum,
    language: "en",
    forced: false,
    filename: "film.en.srt",
    description: "Translator and exact release confirmed",
    contentBase64: btoa(subtitleContent),
    confirmedMatchingVideo: true,
  };
  expect(f.posts[0]).toMatchObject({
    url: "/api/v1/admin/subtitles",
    input: { body: JSON.stringify(body) },
  });
  const command = await commandKey(
    f.storage,
    owner.id,
    "/admin/subtitles",
    body,
  );
  const otherActor = await commandKey(
    f.storage,
    "another-owner",
    "/admin/subtitles",
    body,
  );
  expect(otherActor.storageKey).not.toBe(command.storageKey);
});
