import path from "node:path";
import { mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { z } from "zod";

// Public archive discovery only. No login, admin, private-report or credential URLs.
const archive = Bun.argv[2];
const output = Bun.argv[3];
if (archive === undefined || output === undefined)
  throw new Error(
    "Usage: archive-sweep.ts <read-only archive> <repo-local output directory>",
  );
const destination = path.resolve(output);
if (!destination.startsWith(`${process.cwd()}/`))
  throw new Error("Recovery output must be inside the repository");
await mkdir(destination, { recursive: true });
const publicUrl = (value: string) => {
  const url = new URL(value);
  return (
    /^(?:www\.|forums?\.)?ts-mc\.net$/.test(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    /^(?:\/(?:xf\/)?(?:threads|forums|members|articles)(?:\/|$)|\/$)/.test(
      url.pathname,
    ) &&
    [...url.searchParams.keys()].every((key) => ["page", "type"].includes(key))
  );
};
type Capture = {
  timestamp: string;
  url: string;
  provider: "wayback" | "commoncrawl";
  filename?: string | undefined;
  offset?: string | undefined;
  length?: string | undefined;
};
const captures = new Map<string, Capture>();
function indexCommonCrawl(row: Record<string, string>): boolean {
  if (
    row["url"] === undefined ||
    row["timestamp"] === undefined ||
    row["timestamp"] > "20260923999999" ||
    !publicUrl(row["url"])
  )
    return false;
  captures.set(`${row["timestamp"]}:${row["url"]}`, {
    provider: "commoncrawl",
    timestamp: row["timestamp"],
    url: row["url"],
    filename: row["filename"],
    offset: row["offset"],
    length: row["length"],
  });
  return true;
}
const results: { target: string; outcome: string; captures?: number }[] = [];
async function request(
  url: string,
  headers?: Record<string, string>,
): Promise<Uint8Array> {
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes[0] === 31 && bytes[1] === 139
        ? new Uint8Array(gunzipSync(bytes))
        : bytes;
    } catch (error) {
      failure = error;
    }
    await Bun.sleep(1000);
  }
  throw failure;
}
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
// Cached index evidence remains useful when an archive's live CDX service is unavailable.
const cachedIndex = Bun.file(
  path.join(archive, "Research/other-archives/wayback/ts-mc_2020_on.txt"),
);
if (await cachedIndex.exists()) {
  const contents = await cachedIndex.text();
  for (const line of contents.split("\n")) {
    const [, timestamp, url, mime, status] = line.trim().split(/\s+/);
    if (
      timestamp === undefined ||
      url === undefined ||
      mime !== "text/html" ||
      status !== "200" ||
      timestamp > "20260923999999" ||
      !publicUrl(url)
    )
      continue;
    captures.set(`${timestamp}:${url}`, {
      timestamp,
      url,
      provider: "wayback",
    });
  }
  results.push({
    target: "cached 2020 onward Wayback index",
    outcome: "indexed",
    captures: captures.size,
  });
}
for (const prefix of [
  "ts-mc.net/threads/*",
  "www.ts-mc.net/threads/*",
  "forum.ts-mc.net/threads/*",
  "forums.ts-mc.net/threads/*",
  "ts-mc.net/xf/threads/*",
  "ts-mc.net/articles/*",
]) {
  const params = new URLSearchParams({
    url: prefix,
    output: "json",
    from: "2014",
    to: "20260923",
    filter: "statuscode:200",
    collapse: "digest",
    fl: "timestamp,original",
  });
  try {
    const rows = z
      .array(z.array(z.string()))
      .parse(
        JSON.parse(
          decode(
            await request(
              `https://web.archive.org/cdx/search/cdx?${params.toString()}`,
            ),
          ),
        ),
      );
    let count = 0;
    for (const row of rows.slice(1)) {
      const [timestamp, url] = row;
      if (timestamp === undefined || url === undefined || !publicUrl(url))
        continue;
      captures.set(`${timestamp}:${url}`, {
        timestamp,
        url,
        provider: "wayback",
      });
      count++;
    }
    results.push({ target: prefix, outcome: "indexed", captures: count });
  } catch (error) {
    results.push({ target: prefix, outcome: String(error) });
  }
  process.stdout.write(`${prefix}: ${String(results.at(-1)?.outcome)}\n`);
  await Bun.sleep(1000);
}
// The pre-existing research exhaustively queried Common Crawl through 2021.
try {
  const indexes = z
    .array(z.object({ id: z.string(), "cdx-api": z.url() }))
    .parse(
      JSON.parse(
        decode(await request("https://index.commoncrawl.org/collinfo.json")),
      ),
    );
  let failures = 0;
  for (const index of indexes
    .filter((item) => /^CC-MAIN-202[2-6]-/.test(item.id))
    .reverse()) {
    const params = new URLSearchParams({
      url: "*.ts-mc.net/*",
      output: "json",
      filter: "status:200",
    });
    params.append("filter", "mime:text/html");
    try {
      const rows = decode(
        await request(`${index["cdx-api"]}?${params.toString()}`),
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) =>
          z.record(z.string(), z.string()).parse(JSON.parse(line)),
        );
      const count = rows.filter((row) => indexCommonCrawl(row)).length;
      results.push({ target: index.id, outcome: "indexed", captures: count });
      failures = 0;
    } catch (error) {
      if (String(error) === "Error: HTTP 404") {
        results.push({ target: index.id, outcome: "no captures", captures: 0 });
        failures = 0;
        continue;
      }
      results.push({ target: index.id, outcome: String(error) });
      failures++;
    }
    if (failures === 2) {
      results.push({
        target: "remaining Common Crawl indexes",
        outcome: "deferred: consecutive provider failures",
      });
      break;
    }
    process.stdout.write(`${index.id}: ${String(results.at(-1)?.outcome)}\n`);
    await Bun.sleep(1000);
  }
} catch (error) {
  results.push({
    target: "Common Crawl index catalog",
    outcome: String(error),
  });
}
const known = new Set<string>();
for (const name of ["manifest.tsv", "manifest.run2.tsv"]) {
  const file = Bun.file(path.join(archive, "Research", name));
  if (!(await file.exists())) continue;
  const manifest = await file.text();
  for (const line of manifest.split("\n")) {
    const fields = line.split("\t");
    if (["ok", "cached"].includes(fields.at(-1) ?? ""))
      known.add(`${fields[0] ?? ""}:${fields[1] ?? ""}`);
  }
}
const downloads: (Capture & {
  outcome: string;
  file?: string;
  sha256?: string;
})[] = [];
for (const capture of captures.values()) {
  if (known.has(`${capture.timestamp}:${capture.url}`)) continue;
  const filename =
    new URL(capture.url).hostname === "forum.ts-mc.net" &&
    new URL(capture.url).pathname === "/threads/my-first-thread.1/"
      ? `forum-2022-${capture.timestamp}.html`
      : `${capture.provider}-${capture.timestamp}-${createHash("sha256").update(capture.url).digest("hex").slice(0, 12)}.html`;
  try {
    const cached = Bun.file(path.join(destination, filename));
    if (await cached.exists()) {
      downloads.push({
        ...capture,
        outcome: "cached",
        file: filename,
        sha256: createHash("sha256")
          .update(new Uint8Array(await cached.arrayBuffer()))
          .digest("hex"),
      });
      continue;
    }
    let bytes: Uint8Array;
    if (capture.provider === "wayback")
      bytes = await request(
        `https://web.archive.org/web/${capture.timestamp}id_/${capture.url}`,
      );
    else {
      if (
        capture.filename === undefined ||
        capture.offset === undefined ||
        capture.length === undefined
      )
        throw new Error("Common Crawl record has no payload location");
      const start = Number(capture.offset),
        end = start + Number(capture.length) - 1;
      const record = decode(
        await request(`https://data.commoncrawl.org/${capture.filename}`, {
          Range: `bytes=${String(start)}-${String(end)}`,
        }),
      );
      const boundary = record.indexOf("\r\n\r\n", record.indexOf("HTTP/"));
      if (boundary === -1) throw new Error("Missing archived HTTP payload");
      bytes = new TextEncoder().encode(record.slice(boundary + 4));
    }
    await Bun.write(path.join(destination, filename), bytes);
    downloads.push({
      ...capture,
      outcome: "downloaded",
      file: filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch (error) {
    downloads.push({ ...capture, outcome: String(error) });
  }
  await Bun.sleep(1000);
}
await Bun.write(
  path.join(destination, "coverage.json"),
  JSON.stringify({ results, indexed: captures.size, downloads }, null, 2),
);
process.stdout.write(
  `Indexed ${String(captures.size)} public captures; downloaded ${String(downloads.filter((item) => item.outcome === "downloaded").length)} additional payloads.\n`,
);
