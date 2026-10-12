import { describe, expect, test, vi } from "vitest";
import {
  decodeMarkers,
  encodeMarker,
  objectKey,
  type ArchiveMarker,
  type RecordingRef,
} from "#shared/rwf-recording-archive.ts";
import type {
  Command,
  CommandResult,
} from "#activities/homelab/mining-reset-kubectl.ts";
import {
  archiveRwfRecordingsWithDependencies,
  kubectlRecordingSource,
  parseListing,
  RECORDINGS_ROOT,
  sha256,
  withoutMatchingMarker,
  type ArchiveStore,
  type RecordingSource,
  type StoredObject,
} from "./recording-archive.ts";

const MATCH_A = "11111111-1111-4111-8111-111111111111";
const MATCH_B = "22222222-2222-4222-8222-222222222222";
const A: RecordingRef = { path: `2026/10/03/${MATCH_A}.rwfrec.gz`, bytes: 3 };
const B: RecordingRef = { path: `2026/10/04/${MATCH_B}.rwfrec.gz`, bytes: 2 };
const bodies = new Map([
  [A.path, new Uint8Array([1, 2, 3])],
  [B.path, new Uint8Array([4, 5])],
]);

function source(pending: RecordingRef[], awake = true) {
  const marked: { recording: RecordingRef; marker: ArchiveMarker }[] = [];
  const fake: RecordingSource = {
    awake: () => Promise.resolve(awake),
    unarchived: () => Promise.resolve(pending),
    read: (recording) => {
      const body = bodies.get(recording.path);
      if (body === undefined) throw new Error("no such recording");
      return Promise.resolve(body);
    },
    markArchived: (recording, marker) => {
      marked.push({ recording, marker });
      return Promise.resolve();
    },
  };
  return { fake, marked };
}

function store(initial = new Map<string, Uint8Array>(), corrupt = false) {
  const objects = new Map(initial);
  const puts: string[] = [];
  const fake: ArchiveStore = {
    stat: (key) => {
      const body = objects.get(key);
      return Promise.resolve<StoredObject | undefined>(
        body === undefined
          ? undefined
          : { sha256: sha256(body), bytes: body.byteLength },
      );
    },
    put: (key, body) => {
      puts.push(key);
      objects.set(key, corrupt ? new Uint8Array([9]) : body);
      return Promise.resolve();
    },
    confirm: (key) => {
      const body = objects.get(key);
      if (body === undefined) throw new Error("missing");
      return Promise.resolve({ sha256: sha256(body), bytes: body.byteLength });
    },
  };
  return { fake, puts, objects };
}

function dependencies(
  recordings: ReturnType<typeof source>,
  archive: ReturnType<typeof store>,
  enabled = true,
) {
  return {
    enabled: () => Promise.resolve(enabled),
    source: recordings.fake,
    store: vi.fn(() => archive.fake),
    heartbeat: vi.fn(),
  };
}

describe("Red Warfare recording archive", () => {
  test("a disabled archive touches neither the server nor the store", async () => {
    const recordings = source([A]);
    const archive = store();
    const deps = dependencies(recordings, archive, false);
    expect(await archiveRwfRecordingsWithDependencies(10, deps)).toEqual({
      status: "disabled",
      archived: 0,
      remaining: 0,
    });
    expect(deps.store).not.toHaveBeenCalled();
    expect(recordings.marked).toEqual([]);
  });

  test("a hibernated server is skipped without waking it", async () => {
    const recordings = source([A], false);
    const deps = dependencies(recordings, store());
    const result = await archiveRwfRecordingsWithDependencies(10, deps);
    expect(result.status).toBe("sleeping");
    expect(deps.store).not.toHaveBeenCalled();
  });

  test("each recording is stored, confirmed, then marked, up to the batch", async () => {
    const recordings = source([A, B]);
    const archive = store();
    const result = await archiveRwfRecordingsWithDependencies(
      1,
      dependencies(recordings, archive),
    );
    expect(result).toEqual({ status: "archived", archived: 1, remaining: 1 });
    expect(archive.puts).toEqual([objectKey(A.path)]);
    expect(recordings.marked).toEqual([
      {
        recording: A,
        marker: {
          key: `the-storm/rwf-recordings/${A.path}`,
          sha256: sha256(new Uint8Array([1, 2, 3])),
          bytes: 3,
        },
      },
    ]);
  });

  test("an identical object already stored is confirmed and marked without a second upload", async () => {
    const recordings = source([A]);
    const archive = store(
      new Map([[objectKey(A.path), new Uint8Array([1, 2, 3])]]),
    );
    await archiveRwfRecordingsWithDependencies(
      10,
      dependencies(recordings, archive),
    );
    expect(archive.puts).toEqual([]);
    expect(recordings.marked).toHaveLength(1);
  });

  test("a different object under the key is never overwritten and nothing is marked", async () => {
    const recordings = source([A]);
    const archive = store(new Map([[objectKey(A.path), new Uint8Array([7])]]));
    await expect(
      archiveRwfRecordingsWithDependencies(
        10,
        dependencies(recordings, archive),
      ),
    ).rejects.toThrow("refusing to overwrite");
    expect(archive.puts).toEqual([]);
    expect(recordings.marked).toEqual([]);
  });

  test("an upload that reads back differently is not marked", async () => {
    const recordings = source([A]);
    const archive = store(new Map(), true);
    await expect(
      archiveRwfRecordingsWithDependencies(
        10,
        dependencies(recordings, archive),
      ),
    ).rejects.toThrow("did not read back");
    expect(recordings.marked).toEqual([]);
  });

  test("a recording that changed size is a contract failure", async () => {
    const recordings = source([{ ...A, bytes: 4 }]);
    await expect(
      archiveRwfRecordingsWithDependencies(
        10,
        dependencies(recordings, store()),
      ),
    ).rejects.toThrow("changed size");
    expect(recordings.marked).toEqual([]);
  });
});

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

describe("the archive marker and listing", () => {
  test("markers round-trip in the plugin's format and nonsense is ignored", () => {
    const marker = {
      key: objectKey(A.path),
      sha256: "a".repeat(64),
      bytes: 3,
    };
    expect(encodeMarker(marker)).toBe(
      `rwf-archive-v1\tthe-storm/rwf-recordings/${A.path}\t${"a".repeat(64)}\t3\n`,
    );
    expect(
      decodeMarkers(
        `${encodeMarker(marker)}garbage\nrwf-archive-v2\tk\t${"a".repeat(64)}\t1\n`,
      ),
    ).toEqual([marker]);
  });

  test("only finished recordings are listed, and a stale marker does not count", () => {
    const listing = parseListing(
      [
        `2\t${B.path}`,
        `3\t${A.path}`,
        `9\t2026/10/05/${MATCH_A}.rwfrec.gz.part`,
        `1\t../escape.rwfrec.gz`,
        `5\tnotes.txt`,
      ].join("\n"),
    );
    expect(listing).toEqual([A, B]);
    expect(
      withoutMatchingMarker(listing, [
        { key: objectKey(A.path), sha256: "a".repeat(64), bytes: 3 },
        { key: objectKey(B.path), sha256: "b".repeat(64), bytes: 99 },
      ]),
    ).toEqual([B]);
  });

  test("the kubectl source reads and marks through exec without a shell-built path", async () => {
    const calls: { args: string[]; input: string | undefined }[] = [];
    const command: Command = (args, input) => {
      calls.push({ args: [...args], input });
      if (args.includes("statefulset"))
        return Promise.resolve(
          ok(
            JSON.stringify({
              spec: { replicas: 1 },
              status: { readyReplicas: 1 },
            }),
          ),
        );
      if (args.includes("-printf"))
        return Promise.resolve(ok(`3\t${A.path}\n`));
      if (args.includes("cat")) return Promise.resolve(ok(""));
      return args.includes("base64")
        ? Promise.resolve(ok(Buffer.from([1, 2, 3]).toString("base64")))
        : Promise.resolve(ok(""));
    };
    const kube = kubectlRecordingSource(command);
    expect(await kube.awake()).toBe(true);
    expect(await kube.unarchived()).toEqual([A]);
    expect([...(await kube.read(A))]).toEqual([1, 2, 3]);
    const marker = { key: objectKey(A.path), sha256: "c".repeat(64), bytes: 3 };
    await kube.markArchived(A, marker);
    const mark = calls.at(-1);
    expect(mark?.input).toBe(encodeMarker(marker));
    expect(mark?.args).toContain("-i");
    expect(mark?.args.at(-1)).toBe(`${RECORDINGS_ROOT}/${A.path}.archived`);
    await expect(
      kube.read({ path: "../../etc/passwd", bytes: 1 }),
    ).rejects.toThrow();
  });
});
