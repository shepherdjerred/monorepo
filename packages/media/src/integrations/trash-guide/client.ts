import { z } from "zod";
import {
  GUIDE_PRESETS,
  GuideBundleSchema,
  type GuideBundle,
} from "#domain/quality-guide/contract.ts";
import type { QualityGuideKind } from "#shared/quality-guide/contract.ts";
import {
  endpoint,
  IntegrationError,
  request,
  type FetchTransport,
} from "#integrations/http.ts";

const Revision = z.string().regex(/^[a-f0-9]{40}$/u);
const MAX_JSON_BYTES = 512 * 1024;

async function boundedJson(
  transport: FetchTransport,
  url: URL,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await request(transport, "trash-guide", url, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.body === null)
    throw new IntegrationError("trash-guide", "invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (
      let read = await reader.read();
      !read.done;
      read = await reader.read()
    ) {
      size += read.value.byteLength;
      if (size > MAX_JSON_BYTES)
        throw new IntegrationError("trash-guide", "invalid-response");
      chunks.push(read.value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new IntegrationError("trash-guide", "invalid-response");
  }
}

/** Fetch only a fixed allowlist, pinned to one observed immutable Git revision. */
export class TrashGuideClient {
  constructor(private readonly transport: FetchTransport = fetch) {}

  async load(
    kind: QualityGuideKind,
    signal?: AbortSignal,
  ): Promise<GuideBundle> {
    const reference = z
      .object({
        object: z.object({ sha: Revision, type: z.literal("commit") }),
      })
      .parse(
        await boundedJson(
          this.transport,
          endpoint(
            "https://api.github.com",
            "repos/TRaSH-Guides/Guides/git/ref/heads/master",
          ),
          signal,
        ),
      );
    const revision = reference.object.sha;
    const commit = z
      .object({
        sha: Revision,
        committer: z.object({ date: z.iso.datetime() }),
      })
      .parse(
        await boundedJson(
          this.transport,
          endpoint(
            "https://api.github.com",
            `repos/TRaSH-Guides/Guides/git/commits/${revision}`,
          ),
          signal,
        ),
      );
    if (commit.sha !== revision)
      throw new IntegrationError("trash-guide", "invalid-response");
    const preset = GUIDE_PRESETS[kind];
    const paths = [
      ...preset.formats.map((entry) => entry.path),
      preset.qualitySizePath,
      ...(preset.profilePath === undefined ? [] : [preset.profilePath]),
    ];
    const documents = new Map<string, unknown>();
    let next = 0;
    const cancellation = new AbortController();
    const sourceSignal =
      signal === undefined
        ? cancellation.signal
        : AbortSignal.any([signal, cancellation.signal]);
    const reads = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        try {
          while (next < paths.length) {
            sourceSignal.throwIfAborted();
            const path = paths[next++];
            if (
              path === undefined ||
              !/^docs\/json\/(?:radarr|sonarr)\/(?:cf|quality-size|quality-profiles)\/[a-z0-9._-]+\.json$/u.test(
                path,
              )
            )
              throw new Error(
                "Selected guide path is outside the fixed repository allowlist",
              );
            documents.set(
              path,
              await boundedJson(
                this.transport,
                endpoint(
                  "https://raw.githubusercontent.com",
                  `TRaSH-Guides/Guides/${revision}/${path}`,
                ),
                sourceSignal,
              ),
            );
          }
        } catch (error) {
          cancellation.abort();
          throw error;
        }
      }),
    );
    const failure = reads.find((read) => read.status === "rejected");
    if (failure !== undefined)
      throw new IntegrationError("trash-guide", "invalid-response");
    return GuideBundleSchema.parse({
      revision,
      committedAt: commit.committer.date,
      formats: preset.formats.map((entry) => documents.get(entry.path)),
      sizes: documents.get(preset.qualitySizePath),
      ...(preset.profilePath === undefined
        ? {}
        : { profile: documents.get(preset.profilePath) }),
    });
  }
}
