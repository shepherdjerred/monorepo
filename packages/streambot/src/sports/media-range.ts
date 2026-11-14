type ByteRange = { start: number; end: number };

function boundedRange(header: string, length: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null || length === 0 || (match[1] === "" && match[2] === ""))
    return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (match[1] === "")
    return last > 0
      ? { start: Math.max(0, length - last), end: length - 1 }
      : null;
  const end = match[2] === "" ? length - 1 : Math.min(last, length - 1);
  return first < length && first <= end ? { start: first, end } : null;
}

/** Ranges address decoded media bytes, not the provider's PNG carrier representation. */
export function sportsMediaResponse(
  bytes: Uint8Array,
  rangeHeader: string | null,
): Response {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  });
  if (rangeHeader === null) {
    headers.set("Content-Length", String(bytes.length));
    return new Response(bytes, { headers });
  }
  const range = boundedRange(rangeHeader, bytes.length);
  if (range === null) {
    headers.set("Content-Range", `bytes */${String(bytes.length)}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set(
    "Content-Range",
    `bytes ${String(range.start)}-${String(range.end)}/${String(bytes.length)}`,
  );
  headers.set("Content-Length", String(range.end - range.start + 1));
  return new Response(bytes.subarray(range.start, range.end + 1), {
    status: 206,
    headers,
  });
}
