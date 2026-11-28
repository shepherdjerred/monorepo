import { anchorSummary } from "#lib/artifacts/digest.ts";
import {
  ArtifactsCliError,
  EXIT,
  redactTokens,
  usageError,
} from "#lib/artifacts/errors.ts";
import { callOptions, failureFromResponse } from "#lib/artifacts/client.ts";
import {
  noPositionals,
  onlyPositional,
  parseCommandArgs,
  parseId,
} from "./options.ts";
import type { Runtime } from "./runtime.ts";
import { BoardSlugSchema } from "@shepherdjerred/artifacts/contract";

export const READ_HELP = `toolkit artifacts list [--board <slug>] [--json]
  Published artifacts, newest activity first.
toolkit artifacts show <artifactId> [--json]
  One artifact: versions, threads with their anchors and delivery state, and
  the board's notes (JSON).
toolkit artifacts boards [--json]
  Boards with their size and when they expire.
toolkit artifacts guide [<name>]
  Print the service's agent guide (SKILL.md), or a named reference.

Options:
  --url <url>  Service URL (default: ARTIFACTS_URL or config)
  --json       One JSON document on stdout
`;

const OPTIONS = {
  board: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
} as const;

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]?.map((_cell, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths?.[column] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function day(timestamp: string): string {
  return timestamp.slice(0, 16).replace("T", " ");
}

/** Print JSON with any content-URL token removed. */
function jsonOut(value: unknown): string {
  return `${redactTokens(JSON.stringify(value, null, 2))}\n`;
}

export async function boardsCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs("boards", args, OPTIONS);
  if (values.help) {
    await runtime.io.stdout(READ_HELP);
    return EXIT.ok;
  }
  noPositionals("boards", positionals);
  const client = await runtime.connect({ url: values.url, actor: "optional" });
  try {
    const boards = await client.trpc.boards.list.query(
      undefined,
      callOptions(runtime.signal),
    );
    if (values.json) {
      await runtime.io.stdout(jsonOut(boards));
      return EXIT.ok;
    }
    await runtime.io.stdout(
      boards.length === 0
        ? "No boards.\n"
        : `${table([
            ["SLUG", "ARTIFACTS", "SIZE", "ACTIVITY", "EXPIRES", "TITLE"],
            ...boards.map((board) => [
              board.slug,
              String(board.artifactCount),
              megabytes(board.totalBytes),
              day(board.lastActivityAt),
              board.archivedAt === null
                ? board.keep
                  ? "kept"
                  : board.expiresAt === null
                    ? "-"
                    : day(board.expiresAt)
                : "archived",
              board.title,
            ]),
          ])}\n`,
    );
    return EXIT.ok;
  } catch (error) {
    throw client.explain(error);
  }
}

export async function listCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs("list", args, OPTIONS);
  if (values.help) {
    await runtime.io.stdout(READ_HELP);
    return EXIT.ok;
  }
  noPositionals("list", positionals);
  if (
    values.board !== undefined &&
    !BoardSlugSchema.safeParse(values.board).success
  )
    throw usageError(
      "--board must be a board slug, as printed by `toolkit artifacts boards`.",
    );
  const client = await runtime.connect({ url: values.url, actor: "optional" });
  try {
    const artifacts = await client.trpc.artifacts.list.query(
      values.board === undefined
        ? undefined
        : { board: values.board, limit: 200 },
      callOptions(runtime.signal),
    );
    if (values.json) {
      await runtime.io.stdout(jsonOut(artifacts));
      return EXIT.ok;
    }
    await runtime.io.stdout(
      artifacts.length === 0
        ? "No artifacts.\n"
        : `${table([
            ["ID", "BOARD", "KIND", "VERSION", "OPEN", "TITLE"],
            ...artifacts.map((artifact) => [
              artifact.id,
              artifact.boardSlug,
              artifact.kind,
              artifact.currentVersion === null
                ? "-"
                : `v${String(artifact.currentVersion.number)}`,
              String(artifact.openThreadCount),
              artifact.title,
            ]),
          ])}\n`,
    );
    return EXIT.ok;
  } catch (error) {
    throw client.explain(error);
  }
}

export async function showCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs("show", args, OPTIONS);
  if (values.help) {
    await runtime.io.stdout(READ_HELP);
    return EXIT.ok;
  }
  const id = parseId(
    onlyPositional("show", positionals, "artifactId"),
    "artifactId",
  );
  const client = await runtime.connect({ url: values.url, actor: "optional" });
  try {
    const options = callOptions(runtime.signal);
    const artifact = await client.trpc.artifacts.get.query({ id }, options);
    const [versions, threads, board] = await Promise.all([
      client.trpc.artifacts.versions.query({ id }, options),
      client.trpc.threads.list.query({ artifactId: id }, options),
      client.trpc.boards.get.query({ slug: artifact.boardSlug }, options),
    ]);
    if (values.json) {
      await runtime.io.stdout(
        jsonOut({
          artifact,
          versions,
          threads,
          board: {
            slug: board.board.slug,
            title: board.board.title,
            revision: board.board.revision,
            notes: board.index.notes,
          },
        }),
      );
      return EXIT.ok;
    }
    const lines = [
      `${artifact.title} (${artifact.kind}) · ${artifact.id}`,
      `Review: ${client.baseUrl}/a/${artifact.id}`,
      `Board: ${artifact.boardSlug} · ${String(artifact.versionCount)} versions · ${String(artifact.openThreadCount)} open threads`,
      "",
      "Versions:",
      ...versions.map(
        (version) =>
          `  v${String(version.number)}  ${day(version.createdAt)}  ${version.publisher.name}  ${String(version.fileCount)} files, ${megabytes(version.totalBytes)}${version.purged ? "  (files expired)" : ""}`,
      ),
      "",
      threads.length === 0 ? "No threads." : "Threads:",
    ];
    for (const thread of threads) {
      lines.push(
        `  [${thread.state}] thread ${thread.id}${thread.versionNumber === null ? "" : ` on v${String(thread.versionNumber)}`} · ${anchorSummary(thread.anchor)}`,
      );
      for (const comment of thread.comments) {
        const status =
          comment.delivery === null ? "" : ` [${comment.delivery.state}]`;
        lines.push(
          `    ${comment.author.name} (${day(comment.createdAt)})${status}:`,
          ...comment.body.split("\n").map((line) => `      ${line}`),
        );
      }
    }
    await runtime.io.stdout(`${redactTokens(lines.join("\n"))}\n`);
    return EXIT.ok;
  } catch (error) {
    throw client.explain(error);
  }
}

export async function guideCommand(
  args: string[],
  runtime: Runtime,
): Promise<number> {
  const { values, positionals } = parseCommandArgs("guide", args, OPTIONS);
  if (values.help) {
    await runtime.io.stdout(READ_HELP);
    return EXIT.ok;
  }
  if (positionals.length > 1)
    throw usageError("Usage: toolkit artifacts guide [<name>].");
  const name = positionals[0]?.replace(/\.md$/u, "");
  if (name !== undefined && !/^[a-z0-9][a-z0-9_-]*$/u.test(name))
    throw usageError(
      "A guide name is lowercase letters, digits, - and _ (for example `publishing`).",
    );
  const client = await runtime.connect({ url: values.url, actor: "optional" });
  const response = await client.request(
    name === undefined ? "/agent/SKILL.md" : `/agent/reference/${name}.md`,
    { signal: runtime.signal },
  );
  if (response.status === 404)
    throw new ArtifactsCliError(
      "not-found",
      name === undefined
        ? "The service has no agent guide yet."
        : `No guide named ${name}. Run \`toolkit artifacts guide\` for the index of references.`,
    );
  if (!response.ok) throw await failureFromResponse(response, client.baseUrl);
  await runtime.io.stdout(await response.text());
  return EXIT.ok;
}
