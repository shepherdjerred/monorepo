#!/usr/bin/env bun
/**
 * Compiles the 5 authoritative Regional Internet Registry (ARIN, RIPE NCC,
 * APNIC, LACNIC, AFRINIC) public-domain `delegated-*-extended-latest` country
 * allocation tables into a deterministic gzipped binary interval table bundled
 * with TheStorm's stats module (`src/main/resources/geoip-rir.bin.gz`).
 *
 * Binary layout (all integers big-endian):
 *   0..3   : ASCII magic "SGEO" (0x5347454F)
 *   4..7   : uint32 format version (1)
 *   8..11  : uint32 ipv4Count
 *   12..15 : uint32 ipv6Count
 *   ipv4   : ipv4Count * (uint32 start, uint32 end, uint16 ccAscii)   [10 B]
 *   ipv6   : ipv6Count * (uint64 startHigh, uint64 endHigh, uint16 ccAscii) [18 B]
 */
import path from "node:path";

const RIR_FEEDS: readonly string[] = [
  "https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
  "https://ftp.ripe.net/ripe/stats/delegated-ripencc-extended-latest",
  "https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest",
  "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
  "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
];

const EXCLUDED_COUNTRY_CODES = new Set<string>(["ZZ", "EU", "AP"]);
const VALID_STATUSES = new Set<string>(["allocated", "assigned"]);
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;
const DECIMAL_PATTERN = /^\d+$/u;
const HEXTET_PATTERN = /^[\da-f]{1,4}$/iu;

const MAGIC_SGEO = 0x53_47_45_4f;
const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;
const IPV4_RECORD_BYTES = 10;
const IPV6_RECORD_BYTES = 18;
const MAX_COMPRESSED_BYTES = 1_500_000;
const MAX_IPV4 = 0xff_ff_ff_ffn;
const MAX_IPV6_HIGH64 = 0xff_ff_ff_ff_ff_ff_ff_ffn;

type BigIntRange = {
  start: bigint;
  end: bigint;
  cc: number;
};

type ParsedFeeds = {
  readonly ipv4: BigIntRange[];
  readonly ipv6: BigIntRange[];
};

type SweepEvent = {
  readonly pos: bigint;
  readonly add: boolean;
  readonly index: number;
};

type SweepState = {
  readonly heap: number[];
  readonly removed: Uint8Array;
  readonly ranges: readonly BigIntRange[];
};

function encodeCountryCode(cc: string): number {
  const c0 = cc.codePointAt(0) ?? 0;
  const c1 = cc.codePointAt(1) ?? 0;
  return (c0 << 8) | c1;
}

function parseDecimalInt(raw: string): number | null {
  if (!DECIMAL_PATTERN.test(raw)) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function parseIpv4(raw: string): bigint | null {
  const parts = raw.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let acc = 0n;
  for (const part of parts) {
    const octet = parseDecimalInt(part);
    if (octet === null || octet < 0 || octet > 255) {
      return null;
    }
    acc = (acc << 8n) | BigInt(octet);
  }
  return acc;
}

function parseHextets(segment: string): number[] | null {
  if (segment === "") {
    return [];
  }
  const tokens = segment.split(":");
  const values: number[] = [];
  for (const token of tokens) {
    if (!HEXTET_PATTERN.test(token)) {
      return null;
    }
    values.push(Number.parseInt(token, 16));
  }
  return values;
}

function parseIpv6High64(raw: string): bigint | null {
  const halves = raw.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = parseHextets(halves[0] ?? "");
  if (left === null) {
    return null;
  }
  let groups: number[];
  if (halves.length === 1) {
    if (left.length !== 8) {
      return null;
    }
    groups = left;
  } else {
    const right = parseHextets(halves[1] ?? "");
    if (right === null || left.length + right.length > 7) {
      return null;
    }
    const zeroFill = Array.from<number>({
      length: 8 - left.length - right.length,
    }).fill(0);
    groups = [...left, ...zeroFill, ...right];
  }
  const g0 = BigInt(groups[0] ?? 0);
  const g1 = BigInt(groups[1] ?? 0);
  const g2 = BigInt(groups[2] ?? 0);
  const g3 = BigInt(groups[3] ?? 0);
  return (g0 << 48n) | (g1 << 32n) | (g2 << 16n) | g3;
}

function parseIpv4Record(
  startField: string,
  valueField: string,
  cc: number,
): BigIntRange | null {
  const start = parseIpv4(startField);
  const count = parseDecimalInt(valueField);
  if (start === null || count === null || count < 1) {
    return null;
  }
  const endCandidate = start + BigInt(count) - 1n;
  const end = endCandidate > MAX_IPV4 ? MAX_IPV4 : endCandidate;
  return { start, end, cc };
}

function parseIpv6Record(
  startField: string,
  valueField: string,
  cc: number,
): BigIntRange | null {
  const high64 = parseIpv6High64(startField);
  const prefix = parseDecimalInt(valueField);
  if (high64 === null || prefix === null || prefix < 1 || prefix > 128) {
    return null;
  }
  if (prefix >= 64) {
    return { start: high64, end: high64, cc };
  }
  const hostBits = BigInt(64 - prefix);
  const hostMask = (1n << hostBits) - 1n;
  const netMask = ~hostMask & MAX_IPV6_HIGH64;
  const start = high64 & netMask;
  const end = start | hostMask;
  return { start, end, cc };
}

function parseFeedLine(line: string, target: ParsedFeeds): void {
  if (line === "" || line.startsWith("#")) {
    return;
  }
  const fields = line.split("|");
  if (fields.length < 7) {
    return;
  }
  const ccRaw = fields[1] ?? "";
  const recordType = fields[2] ?? "";
  const startField = fields[3] ?? "";
  const valueField = fields[4] ?? "";
  const status = fields[6] ?? "";
  if (
    !VALID_STATUSES.has(status) ||
    !COUNTRY_CODE_PATTERN.test(ccRaw) ||
    EXCLUDED_COUNTRY_CODES.has(ccRaw)
  ) {
    return;
  }
  const cc = encodeCountryCode(ccRaw);
  if (recordType === "ipv4") {
    const parsed = parseIpv4Record(startField, valueField, cc);
    if (parsed !== null) {
      target.ipv4.push(parsed);
    }
  } else if (recordType === "ipv6") {
    const parsed = parseIpv6Record(startField, valueField, cc);
    if (parsed !== null) {
      target.ipv6.push(parsed);
    }
  }
}

function parseFeedInto(body: string, target: ParsedFeeds): void {
  for (const line of body.split(/\r?\n/u)) {
    parseFeedLine(line, target);
  }
}

function preferRange(
  aIdx: number,
  bIdx: number,
  ranges: readonly BigIntRange[],
): boolean {
  const a = ranges[aIdx];
  const b = ranges[bIdx];
  if (a === undefined || b === undefined) {
    return a !== undefined;
  }
  const spanA = a.end - a.start;
  const spanB = b.end - b.start;
  if (spanA !== spanB) {
    return spanA < spanB;
  }
  return a.cc === b.cc ? aIdx < bIdx : a.cc < b.cc;
}

function swapHeapItems(heap: number[], i: number, j: number): void {
  const valI = heap[i];
  const valJ = heap[j];
  if (valI !== undefined && valJ !== undefined) {
    heap[i] = valJ;
    heap[j] = valI;
  }
}

function heapPush(
  heap: number[],
  item: number,
  ranges: readonly BigIntRange[],
): void {
  heap.push(item);
  let idx = heap.length - 1;
  while (idx > 0) {
    const parent = (idx - 1) >> 1;
    const parentVal = heap[parent];
    const currentVal = heap[idx];
    if (parentVal === undefined || currentVal === undefined) {
      break;
    }
    if (preferRange(parentVal, currentVal, ranges)) {
      break;
    }
    swapHeapItems(heap, parent, idx);
    idx = parent;
  }
}

function pickBetterHeapSlot(
  heap: readonly number[],
  candidateIdx: number,
  bestIdx: number,
  ranges: readonly BigIntRange[],
): number {
  const candidateVal = heap[candidateIdx];
  const bestVal = heap[bestIdx];
  if (candidateVal === undefined || bestVal === undefined) {
    return bestIdx;
  }
  return preferRange(candidateVal, bestVal, ranges) ? candidateIdx : bestIdx;
}

function heapPop(heap: number[], ranges: readonly BigIntRange[]): void {
  const last = heap.pop();
  if (last === undefined || heap.length === 0) {
    return;
  }
  heap[0] = last;
  let idx = 0;
  while (idx < heap.length) {
    const left = idx * 2 + 1;
    const right = left + 1;
    let best = pickBetterHeapSlot(heap, left, idx, ranges);
    best = pickBetterHeapSlot(heap, right, best, ranges);
    if (best === idx) {
      break;
    }
    swapHeapItems(heap, idx, best);
    idx = best;
  }
}

function activeTop(state: SweepState): number | null {
  while (state.heap.length > 0) {
    const top = state.heap[0];
    if (top === undefined) {
      return null;
    }
    if (state.removed[top] === 1) {
      heapPop(state.heap, state.ranges);
      continue;
    }
    return top;
  }
  return null;
}

function appendSegment(
  merged: BigIntRange[],
  start: bigint,
  end: bigint,
  cc: number,
): void {
  const previous = merged.at(-1);
  if (previous?.cc === cc && previous.end + 1n === start) {
    previous.end = end;
    return;
  }
  merged.push({ start, end, cc });
}

function buildSweepEvents(ranges: readonly BigIntRange[]): SweepEvent[] {
  const events: SweepEvent[] = [];
  for (const [index, r] of ranges.entries()) {
    events.push({ pos: r.start, add: true, index });
    events.push({ pos: r.end + 1n, add: false, index });
  }
  events.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
  return events;
}

function applyEventsAtPos(
  events: readonly SweepEvent[],
  startIndex: number,
  pos: bigint,
  state: SweepState,
): number {
  let idx = startIndex;
  while (idx < events.length) {
    const ev = events[idx];
    if (ev?.pos !== pos) {
      break;
    }
    if (ev.add) {
      heapPush(state.heap, ev.index, state.ranges);
    } else {
      state.removed[ev.index] = 1;
    }
    idx++;
  }
  return idx;
}

/**
 * Resolves overlapping RIR allocations via longest-prefix-match (narrower span
 * wins, ties broken deterministically by country code) and coalesces adjacent
 * same-country intervals into strictly disjoint sorted ranges.
 */
function flattenRanges(ranges: readonly BigIntRange[]): BigIntRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const events = buildSweepEvents(ranges);
  const state: SweepState = {
    heap: [],
    removed: new Uint8Array(ranges.length),
    ranges,
  };
  const merged: BigIntRange[] = [];
  let cursor: bigint | null = null;
  let idx = 0;

  while (idx < events.length) {
    const current = events[idx];
    if (current === undefined) {
      break;
    }
    const pos = current.pos;
    const topIdx = activeTop(state);
    if (cursor !== null && topIdx !== null && pos > cursor) {
      const topRange = ranges[topIdx];
      if (topRange !== undefined) {
        appendSegment(merged, cursor, pos - 1n, topRange.cc);
      }
    }
    idx = applyEventsAtPos(events, idx, pos, state);
    cursor = pos;
  }
  return merged;
}

function encodeBinaryDatabase(
  ipv4: readonly BigIntRange[],
  ipv6: readonly BigIntRange[],
): Uint8Array<ArrayBuffer> {
  const totalBytes =
    HEADER_BYTES +
    ipv4.length * IPV4_RECORD_BYTES +
    ipv6.length * IPV6_RECORD_BYTES;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  view.setUint32(0, MAGIC_SGEO, false);
  view.setUint32(4, FORMAT_VERSION, false);
  view.setUint32(8, ipv4.length, false);
  view.setUint32(12, ipv6.length, false);

  let offset = HEADER_BYTES;
  for (const r of ipv4) {
    view.setUint32(offset, Number(r.start), false);
    view.setUint32(offset + 4, Number(r.end), false);
    view.setUint16(offset + 8, r.cc, false);
    offset += IPV4_RECORD_BYTES;
  }
  for (const r of ipv6) {
    view.setBigUint64(offset, r.start, false);
    view.setBigUint64(offset + 8, r.end, false);
    view.setUint16(offset + 16, r.cc, false);
    offset += IPV6_RECORD_BYTES;
  }

  return new Uint8Array(buffer);
}

async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status.toString()}`,
    );
  }
  return await response.text();
}

async function main(): Promise<void> {
  const bodies = await Promise.all(RIR_FEEDS.map((url) => fetchFeed(url)));
  const parsed: ParsedFeeds = { ipv4: [], ipv6: [] };
  for (const body of bodies) {
    parseFeedInto(body, parsed);
  }

  const ipv4Ranges = flattenRanges(parsed.ipv4);
  const ipv6Ranges = flattenRanges(parsed.ipv6);
  if (ipv4Ranges.length === 0 || ipv6Ranges.length === 0) {
    throw new Error("RIR feeds produced empty IPv4 or IPv6 interval tables");
  }

  const rawBinary = encodeBinaryDatabase(ipv4Ranges, ipv6Ranges);
  const compressed = Bun.gzipSync(rawBinary, { level: 9 });
  // Normalize gzip header mtime (bytes 4..7) and OS flag (byte 9) for reproducibility
  if (compressed.length >= 10 && ((compressed[3] ?? 0) & 0x02) === 0) {
    compressed[4] = 0;
    compressed[5] = 0;
    compressed[6] = 0;
    compressed[7] = 0;
    compressed[9] = 0xff;
  }

  if (compressed.byteLength >= MAX_COMPRESSED_BYTES) {
    throw new Error(
      `Compressed GeoIP database (${compressed.byteLength.toString()} bytes) exceeds ${MAX_COMPRESSED_BYTES.toString()} byte budget`,
    );
  }

  const outputPath = path.resolve(
    import.meta.dir,
    "../src/main/resources/geoip-rir.bin.gz",
  );
  await Bun.write(outputPath, compressed);
  await Bun.stdout.write(
    `Wrote ${outputPath}: ipv4=${ipv4Ranges.length.toString()} ranges, ipv6=${ipv6Ranges.length.toString()} ranges, raw=${rawBinary.byteLength.toString()} B, gz=${compressed.byteLength.toString()} B\n`,
  );
}

if (import.meta.main) {
  await main();
}
