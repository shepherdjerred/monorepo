import dns from "node:dns/promises";
import net from "node:net";

export type ValidatedSafeUrl = {
  url: URL;
  pinnedIp: string;
};

export type HostResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<{ address: string; family: number }[]>;

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(
    typeof reason === "string" ? reason : "The operation was aborted",
  );
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    throw toAbortError(signal.reason);
  }

  return await new Promise<never>((_, reject) => {
    const onAbort = () => {
      reject(toAbortError(signal.reason));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function resolveHostAddresses(
  hostname: string,
  signal?: AbortSignal,
): Promise<{ address: string; family: number }[]> {
  signal?.throwIfAborted();
  const lookupPromise = dns.lookup(hostname, { all: true });
  if (signal == null) {
    return await lookupPromise;
  }
  return await Promise.race([lookupPromise, waitForAbort(signal)]);
}

export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

function ipv4ToUint32(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

const IPV4_PRIVATE_RANGES: readonly (readonly [number, number])[] = [
  [0x00_00_00_00, 0x00_ff_ff_ff], // 0.0.0.0/8 (Current network)
  [0x0a_00_00_00, 0x0a_ff_ff_ff], // 10.0.0.0/8 (Private)
  [0x64_40_00_00, 0x64_7f_ff_ff], // 100.64.0.0/10 (CGNAT)
  [0x7f_00_00_00, 0x7f_ff_ff_ff], // 127.0.0.0/8 (Loopback)
  [0xa9_fe_00_00, 0xa9_fe_ff_ff], // 169.254.0.0/16 (Link-local)
  [0xac_10_00_00, 0xac_1f_ff_ff], // 172.16.0.0/12 (Private)
  [0xc0_00_00_00, 0xc0_00_00_ff], // 192.0.0.0/24 (IETF protocol assignments)
  [0xc0_00_02_00, 0xc0_00_02_ff], // 192.0.2.0/24 (TEST-NET-1)
  [0xc0_58_63_00, 0xc0_58_63_ff], // 192.88.99.0/24 (6to4 relay)
  [0xc0_a8_00_00, 0xc0_a8_ff_ff], // 192.168.0.0/16 (Private)
  [0xc6_12_00_00, 0xc6_13_ff_ff], // 198.18.0.0/15 (Benchmark testing)
  [0xc6_33_64_00, 0xc6_33_64_ff], // 198.51.100.0/24 (TEST-NET-2)
  [0xcb_00_71_00, 0xcb_00_71_ff], // 203.0.113.0/24 (TEST-NET-3)
  [0xe0_00_00_00, 0xff_ff_ff_ff], // 224.0.0.0/4 to 255.255.255.255 (Multicast & reserved / broadcast)
];

function isPrivateOrReservedIpv4Uint(uint: number): boolean {
  return IPV4_PRIVATE_RANGES.some(([min, max]) => uint >= min && uint <= max);
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return true;
  }
  const [b0, b1, b2, b3] = parts;
  if (b0 == null || b1 == null || b2 == null || b3 == null) {
    return true;
  }

  const uint = ipv4ToUint32(b0, b1, b2, b3);
  return isPrivateOrReservedIpv4Uint(uint);
}

function parseIpv4SuffixToWords(suffix: string): [number, number] | null {
  const parts = suffix.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return null;
  }
  const [b0, b1, b2, b3] = parts;
  if (b0 == null || b1 == null || b2 == null || b3 == null) {
    return null;
  }
  const w6 = (b0 << 8) | b1;
  const w7 = (b2 << 8) | b3;
  return [w6, w7];
}

function expandIpv4Suffix(lower: string): string | null {
  const lastColonIndex = lower.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return lower;
  }
  const lastPart = lower.slice(lastColonIndex + 1);
  if (!lastPart.includes(".")) {
    return lower;
  }
  const suffixWords = parseIpv4SuffixToWords(lastPart);
  if (suffixWords == null) {
    return null;
  }
  const [w6, w7] = suffixWords;
  return `${lower.slice(0, lastColonIndex)}:${w6.toString(16)}:${w7.toString(16)}`;
}

function expandDoubleColon(
  leftStr: string | undefined,
  rightStr: string | undefined,
): string[] | null {
  const leftWords = leftStr == null || leftStr === "" ? [] : leftStr.split(":");
  const rightWords =
    rightStr == null || rightStr === "" ? [] : rightStr.split(":");
  const missingCount = 8 - (leftWords.length + rightWords.length);
  if (missingCount < 0) {
    return null;
  }
  const middleZeros = Array.from<string>({ length: missingCount }).fill("0");
  return [...leftWords, ...middleZeros, ...rightWords];
}

function parseHexWords(hexParts: string[]): number[] | null {
  if (hexParts.length !== 8) {
    return null;
  }
  const words: number[] = [];
  for (const h of hexParts) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) {
      return null;
    }
    words.push(Number.parseInt(h, 16));
  }
  return words;
}

function parseIpv6Words(ip: string): number[] | null {
  const normalized = expandIpv4Suffix(ip.toLowerCase());
  if (normalized == null) {
    return null;
  }

  const doubleColonParts = normalized.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  if (doubleColonParts.length === 2) {
    const hexParts = expandDoubleColon(
      doubleColonParts[0],
      doubleColonParts[1],
    );
    return hexParts == null ? null : parseHexWords(hexParts);
  }

  return parseHexWords(normalized.split(":"));
}

function isIpv6LoopbackOrUnspecified(words: readonly number[]): boolean {
  return (
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0 &&
    words[6] === 0 &&
    (words[7] === 1 || words[7] === 0)
  );
}

function isIpv6MappedV4(words: readonly number[]): boolean {
  const isMapped =
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0xff_ff;
  const isCompatible =
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0;
  return isMapped || isCompatible;
}

const IPV6_MASK_RULES: readonly (readonly [number, number])[] = [
  [0xfe_00, 0xfc_00], // fc00::/7 (Unique local)
  [0xff_c0, 0xfe_80], // fe80::/10 (Link-local)
  [0xff_00, 0xff_00], // ff00::/8 (Multicast)
];

function matchesIpv6MaskRules(w0: number): boolean {
  return IPV6_MASK_RULES.some(([mask, expected]) => (w0 & mask) === expected);
}

function isIpv6SpecialPrefix(words: readonly number[]): boolean {
  const w0 = words[0];
  const w1 = words[1];
  const w2 = words[2];
  const w3 = words[3];
  if (w0 === 0x20_01 && w1 === 0x0d_b8) {
    return true; // 2001:db8::/32
  }
  return w0 === 0x01_00 && w1 === 0 && w2 === 0 && w3 === 0; // 100::/64
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const words = parseIpv6Words(ip);
  if (words?.length !== 8) {
    return true;
  }
  if (isIpv6LoopbackOrUnspecified(words)) {
    return true;
  }
  if (isIpv6MappedV4(words)) {
    const w6 = words[6] ?? 0;
    const w7 = words[7] ?? 0;
    const ipv4Uint = ((w6 << 16) | w7) >>> 0;
    return isPrivateOrReservedIpv4Uint(ipv4Uint);
  }
  const w0 = words[0] ?? 0;
  if (matchesIpv6MaskRules(w0)) {
    return true;
  }
  return isIpv6SpecialPrefix(words);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    return isPrivateOrReservedIpv4(ip);
  }
  if (family === 6) {
    return isPrivateOrReservedIpv6(ip);
  }
  return true;
}

const FORBIDDEN_HOST_PATTERNS = [
  "localhost",
  ".local",
  ".internal",
  ".cluster.local",
  ".arpa",
];

function validateUrlProtocolAndHost(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error("Invalid image URL: unable to parse", { cause: error });
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Invalid image URL protocol: only HTTPS is allowed (received ${parsed.protocol})`,
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("Invalid image URL: credentials are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.length === 0) {
    throw new Error("Invalid image URL: empty hostname");
  }

  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    const isForbidden = pattern.startsWith(".")
      ? hostname.endsWith(pattern)
      : hostname === pattern;
    if (isForbidden) {
      throw new Error(`Forbidden image URL: '${pattern}' is not allowed`);
    }
  }

  return parsed;
}

async function validateHostDns(
  hostname: string,
  resolver: HostResolver,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  let addresses: { address: string; family: number }[];
  try {
    addresses = await resolver(hostname, signal);
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    throw new Error(`Invalid image URL: host lookup failed for ${hostname}`, {
      cause: error,
    });
  }

  if (addresses.length === 0) {
    throw new Error(`Invalid image URL: no DNS records found for ${hostname}`);
  }

  for (const record of addresses) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `Forbidden image URL: host ${hostname} resolves to private or reserved IP ${record.address}`,
      );
    }
  }

  const ipv4 = addresses.find(
    (record) => record.family === 4 || net.isIP(record.address) === 4,
  );
  if (ipv4 !== undefined) {
    return ipv4.address;
  }

  const first = addresses[0];
  if (first === undefined) {
    throw new Error(`Invalid image URL: no DNS records found for ${hostname}`);
  }
  return first.address;
}

export async function validateSafePublicImageUrl(
  url: string,
  resolver: HostResolver = resolveHostAddresses,
  signal?: AbortSignal,
): Promise<ValidatedSafeUrl> {
  signal?.throwIfAborted();
  const parsed = validateUrlProtocolAndHost(url);
  const hostname = parsed.hostname.toLowerCase();

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(
        "Forbidden image URL: private or reserved IP address is not allowed",
      );
    }
    return { url: parsed, pinnedIp: hostname };
  }

  const pinnedIp = await validateHostDns(hostname, resolver, signal);
  return { url: parsed, pinnedIp };
}
