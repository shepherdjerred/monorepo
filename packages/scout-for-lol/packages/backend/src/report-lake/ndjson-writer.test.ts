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
    writer.write({ id: 1 });
    writer.write({ id: 2 });
    await writer.close();

    const contents = await readFile(filePath, "utf8");
    expect(contents).toBe('{"id":1}\n{"id":2}\n');
    expect(writer.rows).toBe(2);
  });

  test("a failed open aborts with one contextual error", () => {
    // /dev/full fails the open on this platform; production failed later at
    // flush time. Both funnel into the same contextual error.
    let error: unknown;
    try {
      new NdjsonFileWriter("/dev/full");
    } catch (error_) {
      error = error_;
    }
    expect(quilErrorMessage(error)).toMatch(
      /^Report-lake NDJSON write failed \(.+\)/,
    );
  });

  test("a synchronous flush failure throws the contextual error", () => {
    const writer = new NdjsonFileWriter("test.ndjson", failingSink("sync"));
    expect(() => {
      for (let i = 0; i < 2000; i += 1) {
        writer.write({ id: i });
      }
    }).toThrow(/^Report-lake NDJSON write failed \(ENOSPC\)/);
  });

  test("a backpressure rejection surfaces once, on the next flush or close", async () => {
    const writer = new NdjsonFileWriter("test.ndjson", failingSink("async"));
    for (let i = 0; i < 2000; i += 1) {
      writer.write({ id: i });
    }
    // Let the rejection handler run before close() checks for it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(writer.close()).rejects.toThrow(
      /^Report-lake NDJSON write failed \(ENOSPC\)/,
    );
  });

  test("a failing end() surfaces the contextual error on close", async () => {
    const writer = new NdjsonFileWriter(
      "test.ndjson",
      failingSink("ok", { failEnd: true }),
    );
    writer.write({ id: 1 });
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
  mode: "sync" | "async" | "ok",
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
        case "ok": {
          return 0;
        }
      }
    },
    end: () =>
      options.failEnd === true ? Promise.reject(failure) : Promise.resolve(0),
  };
}
