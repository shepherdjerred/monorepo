import { XMLParser } from "fast-xml-parser";
import Builder from "fast-xml-builder";
import { z } from "zod";
import { SportsPlaybackError } from "./failures.ts";

const NodeSchema = z.record(z.string(), z.unknown());
const ATTRIBUTES = new Set(["@_media", "@_initialization", "@_sourceURL"]);
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
});
const builder = new Builder({
  ignoreAttributes: false,
  processEntities: true,
  format: true,
});
const PLACEHOLDER =
  /\$(?:RepresentationID|Number|Bandwidth|Time)(?:%0\d+d)?\$/g;
type Resource = { template: string; placeholders: string[] };

/** Closed template registry: request paths can substitute DASH variables, never choose a host. */
export function createDashResourceRegistry(
  prefix: string,
  approve: (value: string) => URL,
) {
  const entries = new Map<string, Resource>();
  const identifiers = new Map<string, string>();
  const register = (value: string, base: string): string => {
    const template = approve(new URL(value, base).href).href;
    let id = identifiers.get(template);
    if (id === undefined) {
      if (entries.size >= 2048)
        throw new SportsPlaybackError("unsupported-format");
      id = crypto.randomUUID();
      const placeholders = [...template.matchAll(PLACEHOLDER)].map(
        (match) => match[0],
      );
      entries.set(id, { template, placeholders });
      identifiers.set(template, id);
    }
    const resource = entries.get(id);
    if (resource === undefined)
      throw new Error("DASH resource registration failed");
    return prefix + id + "/" + resource.placeholders.join("/") + ".m4s";
  };
  const rewriteNode = (value: unknown, base: string): unknown => {
    if (Array.isArray(value))
      return value.map((child) => rewriteNode(child, base));
    if (value === null || typeof value !== "object") return value;
    const node = NodeSchema.parse(value);
    const rawBase = node["BaseURL"];
    const baseValue: unknown = Array.isArray(rawBase) ? rawBase[0] : rawBase;
    const nextBase =
      typeof baseValue === "string"
        ? approve(new URL(baseValue, base).href).href
        : base;
    return Object.fromEntries(
      Object.entries(node).flatMap(([name, child]) => {
        if (["Location", "PatchLocation", "UTCTiming"].includes(name))
          throw new SportsPlaybackError("unsupported-format");
        if (name === "BaseURL") {
          // Directory bases have already been applied to every descendant resource.
          return nextBase.endsWith("/")
            ? []
            : [[name, register(nextBase, base)]];
        }
        if (name === "@_xlink:href" || name === "@_href")
          throw new SportsPlaybackError("unsupported-format");
        return [
          [
            name,
            ATTRIBUTES.has(name)
              ? register(z.string().parse(child), nextBase)
              : rewriteNode(child, nextBase),
          ],
        ];
      }),
    );
  };
  return {
    rewrite: (xml: string, base: string) => {
      if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new SportsPlaybackError("unsupported-format");
      const parsed: unknown = parser.parse(xml);
      return builder.build(rewriteNode(parsed, base));
    },
    resolve(pathname: string): URL | null {
      if (!pathname.startsWith(prefix)) return null;
      const suffix = pathname.slice(prefix.length);
      const slash = suffix.indexOf("/");
      if (slash === -1) return null;
      const resource = entries.get(suffix.slice(0, slash));
      if (resource === undefined || !suffix.endsWith(".m4s")) return null;
      const rawValues = suffix.slice(slash + 1, -4);
      const values = rawValues === "" ? [] : rawValues.split("/");
      if (values.length !== resource.placeholders.length) return null;
      let url = resource.template;
      for (const [index, placeholder] of resource.placeholders.entries()) {
        const value = values[index];
        if (value === undefined || !/^[\w-]+$/.test(value)) return null;
        url = url.replace(placeholder, value);
      }
      return approve(url);
    },
    clear: () => {
      entries.clear();
      identifiers.clear();
    },
  };
}

/** Bound HTTP responses before buffering manifests or individual media fragments. */
export async function readSportsResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new SportsPlaybackError("unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk: unknown = result.value;
      if (!(chunk instanceof Uint8Array))
        throw new SportsPlaybackError("unavailable");
      size += chunk.length;
      if (size > maximumBytes)
        throw new SportsPlaybackError("unsupported-format");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
