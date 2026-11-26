import {
  BoardSlugSchema,
  ViewportSchema,
  type ArtifactKind,
  type Viewport,
} from "@shepherdjerred/artifacts/contract";
import {
  ArtifactDetailSchema,
  type ArtifactDetail,
} from "@shepherdjerred/artifacts/procedures";
import { z } from "zod";
import { boardSlugFor, localDate } from "#lib/artifacts/boards.ts";
import path from "node:path";
import { ArtifactsCliError, EXIT, usageError } from "#lib/artifacts/errors.ts";
import {
  buildSource,
  parseKind,
  type ArtifactSource,
} from "#lib/artifacts/manifest.ts";
import {
  idempotencyKey,
  PublishConflictError,
  unchangedVersion,
  uploadVersion,
  type UploadResult,
} from "#lib/artifacts/upload.ts";
import { callOptions, type ArtifactsClient } from "#lib/artifacts/client.ts";
import { readTextFile } from "./files.ts";
import { parseCommandArgs, parseId } from "./options.ts";
import type { Runtime } from "./runtime.ts";

export const PUBLISH_HELP = `toolkit artifacts publish <path...> [OPTIONS]

Publish files or a site to the artifacts service and print the review URL.
A file is its own entry; a directory needs index.html and becomes a site.
Several paths publish several artifacts to one board.

Options:
  --board <slug>            Board to publish to (default: named after the
                            artifact, or <repo>-<yyyy-mm-dd> for several paths)
  --title <text>            Artifact title (one path only; default: file name)
  --note-file <file|->      Version note shown to the reviewer
  --label <A|B|C>           Concept label, one per path (repeat or comma-list)
  --viewport <WxH>          Fixed viewport for html/site, e.g. 1440x900
  --version-of <artifactId> Publish a new version of an existing artifact
  --kind <kind>             html|site|image|video|pdf|markdown|cast|mermaid|file
  --idempotency-key <key>   Reuse to make a retry resume (default: derived)
  --url <url>               Service URL (default: ARTIFACTS_URL or config)
  --json                    One JSON object on stdout

Exit: 0 published, 2 usage or service error (a stale --version-of included).
`;

const OPTIONS = {
  board: { type: "string" },
  title: { type: "string" },
  "note-file": { type: "string" },
  label: { type: "string", multiple: true },
  viewport: { type: "string" },
  "version-of": { type: "string" },
  kind: { type: "string" },
  "idempotency-key": { type: "string" },
  url: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

const DEFAULT_SIZE: Readonly<Record<ArtifactKind, { w: number; h: number }>> = {
  html: { w: 1440, h: 900 },
  site: { w: 1440, h: 900 },
  image: { w: 800, h: 600 },
  video: { w: 1280, h: 720 },
  pdf: { w: 794, h: 1123 },
  markdown: { w: 800, h: 1000 },
  cast: { w: 960, h: 540 },
  mermaid: { w: 960, h: 600 },
  file: { w: 360, h: 220 },
};

export function parseViewport(value: string): Viewport {
  const match = /^(\d{1,5})x(\d{1,5})$/u.exec(value);
  const parsed = ViewportSchema.safeParse({
    width: Number(match?.[1]),
    height: Number(match?.[2]),
  });
  if (match === null || !parsed.success)
    throw usageError(
      "--viewport must look like 1440x900 (width x height in px).",
    );
  return parsed.data;
}

function parseLabels(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => value.split(/[,|]/u))
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

type ParsedValues = ReturnType<typeof parseValues>["values"];

type Plan = {
  paths: string[];
  kind: ArtifactKind | undefined;
  labels: string[];
  title: string | undefined;
  board: string | undefined;
  viewport: Viewport | undefined;
  versionOf: string | undefined;
  key: string | undefined;
  note: string | undefined;
  json: boolean;
};

function parseValues(args: string[]) {
  return parseCommandArgs("publish", args, OPTIONS);
}

function validateCombinations(plan: Plan): void {
  const { paths, labels, title, versionOf } = plan;
  if (paths.length === 0)
    throw usageError(
      "Usage: toolkit artifacts publish <path...>. Run `toolkit artifacts publish --help`.",
    );
  if (title !== undefined && paths.length > 1)
    throw usageError(
      "--title names one artifact; with several paths each is titled after its file (use --label A,B,C to tell concepts apart).",
    );
  if (versionOf !== undefined && paths.length > 1)
    throw usageError("--version-of publishes one artifact: pass one path.");
  if (labels.length > 0 && labels.length !== paths.length)
    throw usageError(
      `--label needs one label per path (${String(paths.length)} paths, ${String(labels.length)} labels).`,
    );
  if (versionOf !== undefined && labels.length > 0)
    throw usageError(
      "--label names new artifacts; it cannot go with --version-of.",
    );
}

const KeySchema = z.string().regex(/^[\w-]{16,112}$/u);

async function validatePlan(
  values: ParsedValues,
  paths: string[],
  runtime: Runtime,
): Promise<Plan> {
  const { board, "idempotency-key": key } = values;
  if (key !== undefined && !KeySchema.safeParse(key).success)
    throw usageError(
      "--idempotency-key must be 16-112 letters, digits, _ or -.",
    );
  if (board !== undefined && !BoardSlugSchema.safeParse(board).success)
    throw usageError(
      "--board must be a slug: lowercase letters, digits and -, starting with a letter or digit (63 characters at most).",
    );
  const plan: Plan = {
    paths,
    kind: values.kind === undefined ? undefined : parseKind(values.kind),
    labels: parseLabels(values.label),
    title: values.title,
    board,
    viewport:
      values.viewport === undefined
        ? undefined
        : parseViewport(values.viewport),
    versionOf:
      values["version-of"] === undefined
        ? undefined
        : parseId(values["version-of"], "--version-of"),
    key,
    note:
      values["note-file"] === undefined
        ? undefined
        : await readTextFile(runtime, values["note-file"], "--note-file"),
    json: values.json,
  };
  validateCombinations(plan);
  return plan;
}

type Published = { title: string; result: UploadResult };

function conflictFix(error: PublishConflictError, artifactId: string): string {
  return `${error.message} Run \`toolkit artifacts show ${artifactId}\` to see what is published now, fold those changes into yours, and publish again with \`--version-of ${artifactId}\`.`;
}

async function loadCurrent(
  runtime: Runtime,
  client: ArtifactsClient,
  id: string,
) {
  try {
    return ArtifactDetailSchema.parse(
      await client.trpc.artifacts.get.query(
        { id },
        callOptions(runtime.signal),
      ),
    );
  } catch (error) {
    throw client.explain(error);
  }
}

/** Everything decided before the first byte is sent. */
type Prepared = {
  plan: Plan;
  client: ArtifactsClient;
  sources: ArtifactSource[];
  titles: string[];
  board: string;
  boardTitle: string;
  workspaceKey: string;
  current: ArtifactDetail | null;
};

function titlesFor(
  plan: Plan,
  sources: readonly ArtifactSource[],
  current: ArtifactDetail | null,
): string[] {
  return sources.map((source, index) => {
    const base = plan.title ?? current?.title ?? source.defaultTitle;
    const label = plan.labels[index];
    return label === undefined ? base : `${label} · ${base}`;
  });
}

async function prepare(
  args: string[],
  runtime: Runtime,
): Promise<Prepared | "help"> {
  const { values, positionals } = parseValues(args);
  if (values.help) return "help";
  const plan = await validatePlan(values, positionals, runtime);
  const sources: ArtifactSource[] = [];
  for (const input of plan.paths)
    sources.push(await buildSource(input, { kind: plan.kind }));

  const client = await runtime.connect({ url: values.url, actor: "required" });
  const { actor } = client;
  if (actor === null) throw usageError("Publishing needs a caller identity.");
  const current =
    plan.versionOf === undefined
      ? null
      : await loadCurrent(runtime, client, plan.versionOf);
  if (
    current !== null &&
    plan.board !== undefined &&
    plan.board !== current.boardSlug
  )
    throw usageError(
      `Artifact ${current.id} is on board ${current.boardSlug}, not ${plan.board}.`,
    );

  const titles = titlesFor(plan, sources, current);
  const firstTitle = titles[0] ?? "artifact";
  const now = runtime.now();
  const several = sources.length > 1;
  return {
    plan,
    client,
    sources,
    titles,
    workspaceKey: actor.workspaceKey ?? actor.key,
    current,
    board:
      current?.boardSlug ??
      boardSlugFor({
        board: plan.board,
        pathCount: sources.length,
        firstTitle,
        worktree: runtime.workspace,
        now,
      }),
    boardTitle:
      plan.board ??
      (several
        ? `${path.basename(runtime.workspace)} ${localDate(now)}`
        : firstTitle),
  };
}

function frameSize(
  kind: ArtifactKind,
  viewport: Viewport | undefined,
): { w: number; h: number } {
  return viewport === undefined
    ? DEFAULT_SIZE[kind]
    : { w: viewport.width, h: viewport.height };
}

function keyFor(prepared: Prepared, index: number, digest: string): string {
  const { plan, sources, board, workspaceKey, current, titles } = prepared;
  if (plan.key !== undefined)
    return sources.length === 1 ? plan.key : `${plan.key}-${String(index + 1)}`;
  return idempotencyKey({
    workspaceKey,
    board,
    target:
      current === null
        ? `new:${titles[index] ?? ""}`
        : `${current.id}@${current.currentVersion?.id ?? "none"}`,
    digest,
  });
}

async function publishOne(
  runtime: Runtime,
  prepared: Prepared,
  index: number,
  previous: string | undefined,
): Promise<Published> {
  const { plan, client, sources, titles, board, current } = prepared;
  const source = sources[index];
  const title = titles[index];
  if (source === undefined || title === undefined)
    throw new Error("missing source");
  const fixed = source.kind === "html" || source.kind === "site";
  const unchanged =
    current === null
      ? null
      : unchangedVersion(client, current, source, {
          note: plan.note,
          viewport: fixed ? plan.viewport : undefined,
        });
  if (unchanged !== null) return { title, result: unchanged };
  const result = await uploadVersion(
    client,
    source,
    {
      board,
      boardTitle: current === null ? prepared.boardTitle : undefined,
      title,
      kind: current === null ? source.kind : plan.kind,
      artifactId: current?.id,
      expectedCurrentVersionId: current?.currentVersion?.id ?? null,
      idempotencyKey: keyFor(prepared, index, source.digest),
      note: plan.note,
      viewport: fixed ? plan.viewport : undefined,
      placement:
        current === null
          ? {
              ...frameSize(source.kind, plan.viewport),
              ...(previous === undefined ? {} : { rightOf: previous }),
            }
          : undefined,
    },
    { ...runtime.upload, signal: runtime.signal },
  );
  return { title, result };
}

/** Explains a failure partway through, naming what was already published. */
function withProgress(
  failure: unknown,
  published: readonly Published[],
  artifactId = "<artifactId>",
): unknown {
  if (failure instanceof PublishConflictError)
    return new PublishConflictError(
      failure.currentVersionId,
      conflictFix(failure, artifactId),
    );
  return published.length === 0 || !(failure instanceof ArtifactsCliError)
    ? failure
    : new ArtifactsCliError(
        failure.kind,
        `${failure.message}\nPublished before the failure: ${published.map((entry) => entry.result.reviewUrl).join(", ")}`,
        { cause: failure },
      );
}

async function publishAll(
  runtime: Runtime,
  prepared: Prepared,
): Promise<Published[]> {
  const { client, sources, plan } = prepared;
  const published: Published[] = [];
  try {
    for (const index of sources.keys())
      published.push(
        await publishOne(
          runtime,
          prepared,
          index,
          published.at(-1)?.result.artifactId,
        ),
      );
  } catch (error) {
    throw withProgress(client.explain(error), published, plan.versionOf);
  }
  return published;
}

export async function publishCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const prepared = await prepare(args, runtime);
  if (prepared === "help") {
    await runtime.io.stdout(PUBLISH_HELP);
    return EXIT.ok;
  }
  const { plan, board } = prepared;
  const published = await publishAll(runtime, prepared);
  await runtime.io.stdout(
    renderPublished(published, board, plan.versionOf, plan.json),
  );
  return EXIT.ok;
}

const NEXT = "toolkit artifacts wait";

function renderPublished(
  published: readonly Published[],
  board: string,
  versionOf: string | undefined,
  json: boolean,
): string {
  const last = published.at(-1);
  if (last === undefined) throw new Error("nothing was published");
  const boardUrl = last.result.boardUrl;
  const deduplicated = published.every((entry) => entry.result.deduplicated);
  if (json)
    return `${JSON.stringify({
      artifacts: published.map(({ result }) => ({
        id: result.artifactId,
        version: result.number,
        reviewUrl: result.reviewUrl,
      })),
      board: { slug: board, url: boardUrl },
      deduplicated,
      next: NEXT,
    })}\n`;
  const lines = published.map(
    ({ title, result }) =>
      `Review: ${result.reviewUrl}${published.length > 1 ? `   (${title} v${String(result.number)})` : ""}`,
  );
  lines.push(`Board: ${boardUrl}`);
  if (deduplicated)
    lines.push(
      "Unchanged: this exact content was already published, so nothing new was created.",
    );
  lines.push(
    `Next: ${NEXT}   (blocks until the reviewer comments${versionOf === undefined ? "" : "; then publish the fix with --version-of"})`,
  );
  return `${lines.join("\n")}\n`;
}
