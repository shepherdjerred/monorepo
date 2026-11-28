import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { artifactsCommand } from "#commands/artifacts/index.ts";
import type { Runtime } from "#commands/artifacts/runtime.ts";
import { createArtifactsClient } from "#lib/artifacts/client.ts";
import { detectArtifactsActor } from "#lib/artifacts/actor.ts";

/**
 * Contract test: the toolkit drives the real artifacts service in-process.
 * publish -> a human comments -> wait returns it -> ack -> reply --resolve.
 *
 * `@shepherdjerred/artifacts/testing` boots the real app host over a freshly
 * migrated test PostgreSQL database and an in-memory object store. It is
 * imported only here, never from the CLI, so the compiled binary carries no
 * server code. Needs the local test PostgreSQL, hence the extended tier.
 */
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
type InProcessService = {
  baseUrl: string;
  fetchAsAgent: Fetch;
  fetchAsHuman: Fetch;
  stop: () => Promise<void>;
};
type StartService = (options?: {
  settleMs?: number;
}) => Promise<InProcessService>;

const ServiceModuleSchema = z.looseObject({
  startInProcessService: z.custom<StartService>(
    (value) => typeof value === "function",
  ),
});

/**
 * Loaded by name so toolkit's typecheck never compiles the server's test
 * sources; the module shape is validated here instead.
 */
async function startInProcessService(
  options: { settleMs?: number } = {},
): Promise<InProcessService> {
  const specifier = "@shepherdjerred/artifacts/testing";
  const loaded = ServiceModuleSchema.parse(await import(specifier));
  return loaded.startInProcessService(options);
}

describe("artifacts contract", () => {
  let service: InProcessService;

  beforeAll(async () => {
    service = await startInProcessService({ settleMs: 100 });
  });
  afterAll(async () => {
    await service.stop();
  });

  function runtime(overrides: Partial<Runtime> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const rt: Runtime = {
      io: {
        stdout: (text) => {
          out.push(text);
          return Promise.resolve();
        },
        stderr: (text) => {
          err.push(text);
        },
      },
      env: {},
      now: () => new Date(),
      workspace: "/work/contract",
      stdin: () => Promise.resolve(""),
      connect: async () =>
        createArtifactsClient({
          baseUrl: service.baseUrl,
          fetch: service.fetchAsAgent,
          actor: await detectArtifactsActor(
            {
              CLAUDE_CODE_SESSION_ID: "contract-session",
              CLAUDECODE: "1",
            },
            "claude-code",
          ),
        }),
      wait: { pollMs: 500, connectGraceMs: 2000 },
      ...overrides,
    };
    return { rt, out, err };
  }

  /** The version a reviewer is looking at: the artifact's current one. */
  async function currentVersionId(artifactId: string) {
    const input = encodeURIComponent(JSON.stringify({ id: artifactId }));
    const response = await service.fetchAsHuman(
      `${service.baseUrl}/trpc/artifacts.get?input=${input}`,
    );
    const parsed = z
      .object({
        result: z.object({
          data: z.object({ currentVersion: z.object({ id: z.uuid() }) }),
        }),
      })
      .parse(await response.json());
    return parsed.result.data.currentVersion.id;
  }

  /** The reviewer: a browser request, so no actor header. */
  async function humanComment(board: string, artifactId: string, body: string) {
    const response = await service.fetchAsHuman(
      `${service.baseUrl}/trpc/threads.create`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board,
          artifactId,
          versionId: await currentVersionId(artifactId),
          anchor: { type: "frame", x: 0.4, y: 0.2 },
          body,
        }),
      },
    );
    const text = await response.text();
    if (!response.ok)
      throw new Error(`threads.create ${String(response.status)}: ${text}`);
  }

  test("publish, comment, wait, ack, reply, republish", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "artifacts-contract-"));
    const file = path.join(dir, "concept.html");
    await writeFile(file, "<h1>v1</h1>");

    const publish = runtime();
    expect(
      await artifactsCommand(
        "publish",
        [file, "--board", "contract", "--json"],
        publish.rt,
      ),
    ).toBe(0);
    const published = z
      .object({
        artifacts: z.array(
          z.object({
            id: z.uuid(),
            version: z.number(),
            reviewUrl: z.string(),
          }),
        ),
        board: z.object({ slug: z.string(), url: z.string() }),
        deduplicated: z.boolean(),
      })
      .parse(JSON.parse(publish.out.join("")));
    const artifactId = published.artifacts[0]?.id ?? "";
    expect(published.artifacts[0]?.version).toBe(1);

    // The same content again resumes instead of duplicating.
    const again = runtime();
    await artifactsCommand(
      "publish",
      [file, "--board", "contract", "--json"],
      again.rt,
    );
    expect(JSON.parse(again.out.join(""))).toMatchObject({
      deduplicated: true,
    });

    // A blocked wait receives the comment as soon as it settles.
    const waiting = runtime();
    const first = artifactsCommand("wait", ["--json"], waiting.rt);
    await humanComment("contract", artifactId, "Tighten the header.");
    expect(await first).toBe(0);
    const report = z
      .object({
        outcome: z.literal("feedback"),
        items: z.array(
          z.looseObject({
            comment: z.looseObject({ body: z.string() }),
            thread: z.looseObject({ id: z.uuid() }),
          }),
        ),
      })
      .parse(JSON.parse(waiting.out.join("")));
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.comment.body).toBe("Tighten the header.");
    const threadId = report.items[0]?.thread.id ?? "";

    // It was acknowledged: a second wait yields only newer comments.
    const second = runtime();
    expect(
      await artifactsCommand(
        "wait",
        ["--json", "--timeout", "1500ms"],
        second.rt,
      ),
    ).toBe(6);

    const body = path.join(dir, "reply.md");
    await writeFile(body, "Fixed in v2.");
    const reply = runtime();
    expect(
      await artifactsCommand(
        "reply",
        [threadId, "--body-file", body, "--resolve"],
        reply.rt,
      ),
    ).toBe(0);

    await writeFile(file, "<h1>v2</h1>");
    const next = runtime();
    expect(
      await artifactsCommand(
        "publish",
        [file, "--version-of", artifactId, "--json"],
        next.rt,
      ),
    ).toBe(0);
    expect(JSON.parse(next.out.join(""))).toMatchObject({
      artifacts: [{ id: artifactId, version: 2 }],
    });

    const show = runtime();
    expect(
      await artifactsCommand("show", [artifactId, "--json"], show.rt),
    ).toBe(0);
    const shown = z
      .looseObject({
        threads: z.array(
          z.looseObject({
            state: z.string(),
            versionNumber: z.number().nullable(),
          }),
        ),
      })
      .parse(JSON.parse(show.out.join("")));
    expect(shown.threads[0]).toMatchObject({
      state: "resolved",
      versionNumber: 1,
    });
  });
});
