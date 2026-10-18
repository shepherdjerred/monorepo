import { zipSync, Unzip, UnzipInflate } from "fflate";
import { z } from "zod";
import {
  TRMNL_PLUGIN_POLICY,
  type TrmnlPluginBundle,
} from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";
import { UpstreamError, type Fetch } from "./http.ts";

const MAX_ARCHIVE = 2 * 1024 * 1024;
type Plugin = TrmnlPluginBundle["plugins"][number];
const settings = z.string().transform((value, context): unknown => {
  try {
    return Bun.YAML.parse(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "TRMNL settings YAML is invalid; content withheld",
    });
    return z.NEVER;
  }
});
export function parseTrmnlSettings(value: string) {
  return settings.parse(value);
}

export function trmnlPluginMatches(
  expected: Plugin,
  observed: Record<string, string>,
): boolean {
  if (
    Object.keys(observed).sort().join("\n") !==
    [...TRMNL_PLUGIN_POLICY.files].sort().join("\n")
  )
    return false;
  const wanted = z
    .record(z.string(), z.unknown())
    .parse(
      parseTrmnlSettings(z.string().parse(expected.files["settings.yml"])),
    );
  const actual = z
    .record(z.string(), z.unknown())
    .parse(parseTrmnlSettings(z.string().parse(observed["settings.yml"])));
  if (wanted["id"] !== expected.id || actual["id"] !== expected.id)
    throw new Error(
      "TRMNL plugin settings have a foreign fixed target identity",
    );
  for (const name of TRMNL_PLUGIN_POLICY.files) {
    if (name !== "settings.yml") {
      if (expected.files[name] !== observed[name]) return false;
    } else if (
      Object.entries(wanted).some(
        ([key, value]) => !Bun.deepEquals(value, actual[key]),
      )
    )
      return false;
  }
  return true;
}
function requireTarget(plugin: Plugin) {
  if (
    !TRMNL_PLUGIN_POLICY.plugins.some(
      (target) => target.id === plugin.id && target.slug === plugin.slug,
    )
  )
    throw new Error(
      "TRMNL target is outside the fixed dependency configuration policy",
    );
  const parsed = z
    .record(z.string(), z.unknown())
    .parse(parseTrmnlSettings(z.string().parse(plugin.files["settings.yml"])));
  if (
    parsed["id"] !== plugin.id ||
    Object.keys(plugin.files).sort().join("\n") !==
      [...TRMNL_PLUGIN_POLICY.files].sort().join("\n")
  )
    throw new Error(
      "TRMNL archive settings or filenames do not match the fixed target",
    );
}
async function boundedBytes(response: Response) {
  if (response.body === null)
    throw new UpstreamError("trmnl", "Archive response body is missing");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = z.instanceof(Uint8Array).parse(chunk);
    size += bytes.byteLength;
    if (size > MAX_ARCHIVE)
      throw new UpstreamError("trmnl", "Archive exceeded its byte bound");
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
function archiveFiles(bytes: Uint8Array) {
  let total = 0;
  const seen = new Set<string>();
  const files: Record<string, string> = {};
  // Upstream Ruby ZIPs use ZIP64 size sentinels even for tiny files. Bound
  // actual incremental output instead of trusting advertised sizes/allocations.
  const unzip = new Unzip((entry) => {
    if (
      seen.has(entry.name) ||
      !TRMNL_PLUGIN_POLICY.files.includes(entry.name) ||
      ![0, 8].includes(entry.compression)
    )
      throw new UpstreamError(
        "trmnl",
        "Archive contains an unknown/duplicate entry or compression",
      );
    seen.add(entry.name);
    const chunks: Uint8Array[] = [];
    entry.ondata = (error, chunk, final) => {
      if (error !== null)
        throw new UpstreamError("trmnl", "Archive decompression failed");
      total += chunk.byteLength;
      if (total > MAX_ARCHIVE)
        throw new UpstreamError(
          "trmnl",
          "Archive exceeded its expanded byte bound",
        );
      chunks.push(chunk);
      if (final)
        files[entry.name] = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
        );
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks bound one inflater callback even for a ZIP bomb.
  for (let offset = 0; offset < bytes.length; offset += 128)
    unzip.push(
      bytes.subarray(offset, offset + 128),
      offset + 128 >= bytes.length,
    );
  if (
    seen.size !== TRMNL_PLUGIN_POLICY.files.length ||
    Object.keys(files).length !== seen.size
  )
    throw new UpstreamError(
      "trmnl",
      "Archive lacks complete fixed source files",
    );
  return files;
}

/** Fixed IDs and endpoints only; GET observation is also used by independent API recovery. */
export function createTrmnlPluginClient(input: {
  token: string;
  fetch?: Fetch;
  signal?: AbortSignal;
}) {
  const request = async (plugin: Plugin, body?: FormData) => {
    requireTarget(plugin);
    const response = await (input.fetch ?? fetch)(
      `https://trmnl.com/api/plugin_settings/${String(plugin.id)}/archive`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${z.string().min(1).parse(input.token)}`,
        },
        ...(body === undefined ? {} : { body }),
        redirect: "error",
        signal:
          input.signal === undefined
            ? AbortSignal.timeout(30_000)
            : AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
      },
    );
    if (response.status !== 200)
      throw new UpstreamError(
        "trmnl",
        "Fixed plugin archive operation failed; response content withheld",
        response.status,
      );
    return response;
  };
  return {
    async matches(plugin: Plugin) {
      return trmnlPluginMatches(
        plugin,
        archiveFiles(await boundedBytes(await request(plugin))),
      );
    },
    async publish(plugin: Plugin) {
      requireTarget(plugin);
      const files = Object.fromEntries(
        Object.entries(plugin.files).map(([name, value]) => [
          name,
          new TextEncoder().encode(value),
        ]),
      );
      const bytes = zipSync(files);
      if (bytes.byteLength > MAX_ARCHIVE)
        throw new Error("TRMNL publication exceeds its byte bound");
      const body = new FormData();
      body.set(
        "file",
        new Blob([bytes], { type: "application/zip" }),
        "plugin.zip",
      );
      await boundedBytes(await request(plugin, body));
    },
  };
}
