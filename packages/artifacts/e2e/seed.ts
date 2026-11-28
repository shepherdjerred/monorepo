/**
 * Publishes fixtures through the real upload HTTP API (`POST /api/uploads`,
 * `PUT .../blobs/:sha256`, `POST .../commit`) as an agent, the way
 * `toolkit artifacts publish` does. Works against the fake and the real server.
 */
import {
  ACTOR_HEADER,
  CommitUploadResponseSchema,
  CreateUploadResponseSchema,
  type Actor,
  type ArtifactKind,
  type CommitUploadResponse,
  type Viewport,
} from "#shared/contract.ts";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { agentActor, createApiClient, encodeActor } from "./client.ts";
import {
  generateFixtures,
  type Fixture,
  type FixtureFile,
  type Fixtures,
} from "./fixtures.ts";

export type PublishOptions = {
  readonly board: string;
  readonly title: string;
  readonly files: readonly FixtureFile[];
  readonly entryPath: string;
  readonly note?: string;
  readonly viewport?: Viewport;
  /** The artifact to add a version to; omit to create a new artifact. */
  readonly artifactId?: string;
  /** The version the artifact must currently be at; null for a new artifact. */
  readonly expectedCurrentVersionId?: string | null;
  readonly kind?: ArtifactKind;
  readonly actor?: Actor;
};

const ErrorDataSchema = z.looseObject({ code: z.string() });

export const SEED_ACTOR: Actor = agentActor("Seed agent");

async function sha256Of(
  absPath: string,
): Promise<{ sha256: string; bytes: Uint8Array<ArrayBuffer> }> {
  const bytes = await Bun.file(absPath).bytes();
  return {
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(
    `${what} failed with ${String(response.status)}: ${await response.text()}`,
  );
}

/** Uploads the files that are missing and commits one version. */
export async function publishFixture(
  appUrl: string,
  options: PublishOptions,
): Promise<CommitUploadResponse> {
  const headers = { [ACTOR_HEADER]: encodeActor(options.actor ?? SEED_ACTOR) };
  const loaded = await Promise.all(
    options.files.map(async (file) => ({
      file,
      ...(await sha256Of(file.absPath)),
    })),
  );
  const manifest = {
    board: options.board,
    ...(options.artifactId === undefined
      ? {}
      : { artifactId: options.artifactId }),
    title: options.title,
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    entryPath: options.entryPath,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
    idempotencyKey: crypto.randomUUID(),
    expectedCurrentVersionId: options.expectedCurrentVersionId ?? null,
    files: loaded.map(({ file, sha256, bytes }) => ({
      path: file.path,
      size: bytes.byteLength,
      sha256,
      mediaType: file.mediaType,
    })),
  };
  const createResponse = await expectOk(
    await fetch(`${appUrl}/api/uploads`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    }),
    "create upload",
  );
  const created = CreateUploadResponseSchema.parse(await createResponse.json());
  for (const digest of created.missing) {
    const source = loaded.find((entry) => entry.sha256 === digest);
    if (source === undefined)
      throw new Error(`the service asked for an unknown digest ${digest}`);
    await expectOk(
      await fetch(`${appUrl}/api/uploads/${created.uploadId}/blobs/${digest}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: source.bytes,
      }),
      `upload blob ${digest}`,
    );
  }
  const commitResponse = await expectOk(
    await fetch(`${appUrl}/api/uploads/${created.uploadId}/commit`, {
      method: "POST",
      headers,
    }),
    "commit upload",
  );
  return CommitUploadResponseSchema.parse(await commitResponse.json());
}

function publishOptions(
  board: string,
  fixture: Fixture,
  extra: Partial<PublishOptions> = {},
): PublishOptions {
  return {
    board,
    title: fixture.title,
    files: fixture.files,
    entryPath: fixture.entryPath,
    ...(fixture.viewport === undefined ? {} : { viewport: fixture.viewport }),
    ...extra,
  };
}

export type SeededBoards = {
  readonly fixtures: Fixtures;
  readonly demo: Record<
    | "html"
    | "site"
    | "png"
    | "pdf"
    | "mp4"
    | "webm"
    | "markdown"
    | "cast"
    | "mermaid"
    | "bin",
    CommitUploadResponse
  > & { readonly htmlV2: CommitUploadResponse };
  readonly concepts: readonly CommitUploadResponse[];
};

async function ensureBoard(
  appUrl: string,
  slug: string,
  title: string,
): Promise<void> {
  try {
    await createApiClient(appUrl, SEED_ACTOR).boards.create.mutate({
      slug,
      title,
    });
  } catch (error) {
    const code =
      error instanceof TRPCClientError
        ? ErrorDataSchema.safeParse(error.data)
        : null;
    if (code?.success !== true || code.data.code !== "CONFLICT") throw error;
  }
}

/** Board `demo` gets one artifact of each kind (the HTML one with two versions); `concepts` gets three HTML concepts. */
export async function seedBoard(
  appUrl: string,
  fixtures?: Fixtures,
): Promise<SeededBoards> {
  const files = fixtures ?? (await generateFixtures());
  await ensureBoard(appUrl, "demo", "Demo board");
  await ensureBoard(appUrl, "concepts", "Concepts");
  const demo = (
    fixture: Fixture,
    extra?: Partial<PublishOptions>,
  ): Promise<CommitUploadResponse> =>
    publishFixture(appUrl, publishOptions("demo", fixture, extra));
  const html = await demo(files.htmlV1, {
    title: "Concept A",
    note: "First draft",
  });
  const htmlV2 = await demo(files.htmlV2, {
    title: "Concept A",
    note: "Longer page, second draft",
    artifactId: html.artifactId,
    expectedCurrentVersionId: html.versionId,
  });
  const site = await demo(files.site);
  const png = await demo(files.png);
  const pdf = await demo(files.pdf);
  const mp4 = await demo(files.mp4);
  const webm = await demo(files.webm);
  const markdown = await demo(files.markdown);
  const cast = await demo(files.cast);
  const mermaid = await demo(files.mermaid);
  const bin = await demo(files.bin);
  const concepts: CommitUploadResponse[] = [];
  for (const letter of ["A", "B", "C"]) {
    const index: FixtureFile = {
      path: "index.html",
      mediaType: "text/html",
      absPath: await writeConcept(files.dir, letter),
    };
    concepts.push(
      await publishFixture(appUrl, {
        board: "concepts",
        title: `Concept ${letter}`,
        files: [index],
        entryPath: "index.html",
        viewport: { width: 1440, height: 900 },
      }),
    );
  }
  return {
    fixtures: files,
    demo: {
      html,
      htmlV2,
      site,
      png,
      pdf,
      mp4,
      webm,
      markdown,
      cast,
      mermaid,
      bin,
    },
    concepts,
  };
}

async function writeConcept(dir: string, letter: string): Promise<string> {
  const target = `${dir}/concepts/${letter}/index.html`;
  await Bun.write(
    target,
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Concept ${letter}</title></head>\n<body style="font-family:sans-serif;padding:32px"><h1>Concept ${letter}</h1><p>One of three directions for review.</p></body></html>\n`,
  );
  return target;
}
