import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  NdjsonFileWriter,
  type NdjsonSink,
} from "#src/report-lake/ndjson-writer.ts";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), "ndjson-writer-"));
  return tempDir;
}

describe("NdjsonFileWriter", () => {
  test("buffers rows and writes newline-delimited JSON on close", async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, "rows.ndjson");
    const writer = new NdjsonFileWriter(filePath);
    await writer.write({ id: 1 });
    await writer.write({ id: 2 });
    await writer.close();

    const contents = await readFile(filePath, "utf8");
    expect(contents).toBe('{"id":1}\n{"id":2}\n');
    expect(writer.rows).toBe(2);
  });

  test("a failed open aborts with one contextual error", async () => {
    // /dev/full fails the sink: eagerly in the constructor on some
    // platforms, lazily at flush or close on others (Bun's file sink opens
    // lazily on Linux). Drive the full lifecycle so every platform funnels
    // into the one contextual error.
    let error: unknown;
    try {
      const writer = new NdjsonFileWriter("/dev/full");
      for (let i = 0; i < 2000; i += 1) {
        await writer.write({ id: i });
      }
      await writer.close();
    } catch (error_) {
      error = error_;
    }
    expect(quilErrorMessage(error)).toMatch(
      /^Report-lake NDJSON write failed \(.+\)/,
    );
  });

  test.each(["sync", "async", "flush"] as const)(
    "a %s failure aborts the awaited write with the contextual error",
    async (mode) => {
      const writer = new NdjsonFileWriter("test.ndjson", failingSink(mode));
      const writeRows = async () => {
        for (let i = 0; i < 2000; i += 1) {
          await writer.write({ id: i });
        }
      };
      await expect(writeRows()).rejects.toThrow(
        /^Report-lake NDJSON write failed \(ENOSPC\)/,
      );
    },
  );

  test("large Unicode documents drain before the row limit, preserving every row", async () => {
    const chunks: string[] = [];
    const writer = new NdjsonFileWriter("test.ndjson", recordingSink(chunks));
    const rows = Array.from({ length: 32 }, (_, id) => ({
      id,
      document_json: "界".repeat(100_000),
    }));
    for (const row of rows) await writer.write(row);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) => Buffer.byteLength(chunk) <= 1024 * 1024),
    ).toBe(true);
    await writer.close();
    expect(chunks.join("")).toBe(
      rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
    );
    expect(writer.rows).toBe(rows.length);
  });

  test("an oversized document waits for disk backpressure before its producer continues", async () => {
    const chunks: string[] = [];
    const draining = Promise.withResolvers<number>();
    const started = Promise.withResolvers<undefined>();
    const sink = recordingSink(chunks);
    sink.flush = () => {
      started.resolve(undefined);
      return draining.promise;
    };
    const writer = new NdjsonFileWriter("test.ndjson", sink);
    await writer.write({ id: "small" });
    const large = { document_json: "x".repeat(2 * 1024 * 1024) };
    let continued = false;
    const writing = (async () => {
      await writer.write(large);
      continued = true;
    })();
    await started.promise;
    expect(continued).toBe(false);
    expect(chunks).toEqual(['{"id":"small"}\n']);
    draining.resolve(0);
    await writing;
    expect(chunks).toEqual(['{"id":"small"}\n', `${JSON.stringify(large)}\n`]);
    expect(continued).toBe(true);
    await writer.close();
  });

  test("a failing end() surfaces the contextual error on close", async () => {
    const writer = new NdjsonFileWriter(
      "test.ndjson",
      failingSink("ok", { failEnd: true }),
    );
    await writer.write({ id: 1 });
    await expect(writer.close()).rejects.toThrow(
      /^Report-lake NDJSON write failed \(ENOSPC\)/,
    );
  });
});

function quilErrorMessage(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) {
    throw new Error("expected the write failure to be an Error");
  }
  return error.message;
}

function failingSink(
  mode: "sync" | "async" | "flush" | "ok",
  options: { failEnd?: boolean } = {},
): NdjsonSink {
  const failure = Object.assign(new Error("ENOSPC: no space left on device"), {
    code: "ENOSPC",
  });
  return {
    write: (..._args: Parameters<NdjsonSink["write"]>) => {
      switch (mode) {
        case "sync": {
          throw failure;
        }
        case "async": {
          return Promise.reject(failure);
        }
        case "flush":
        case "ok": {
          return 0;
        }
      }
    },
    flush: () => (mode === "flush" ? Promise.reject(failure) : 0),
    end: () =>
      options.failEnd === true ? Promise.reject(failure) : Promise.resolve(0),
  };
}

function recordingSink(chunks: string[]): NdjsonSink {
  return {
    write: (data) => {
      if (typeof data !== "string") throw new Error("expected a JSON string");
      chunks.push(data);
      return Buffer.byteLength(data);
    },
    flush: () => 0,
    end: () => 0,
  };
}
