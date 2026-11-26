import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { artifactsCommand } from "#commands/artifacts/index.ts";
import type { Runtime } from "#commands/artifacts/runtime.ts";
import { createArtifactsClient } from "#lib/artifacts/client.ts";
import type { FetchLike } from "#lib/artifacts/client.ts";
import { detectArtifactsActor } from "#lib/artifacts/actor.ts";

/**
 * Contract test: the toolkit drives the real artifacts service in-process.
 * publish -> a human comments -> wait returns it -> ack -> reply --resolve.
 *
 * The service comes from `@shepherdjerred/artifacts/testing`, which boots the
 * real app host against the package's test Postgres and an in-memory object
 * store. It is pending until that export exists on the stack (it lands with
 * the server change), so the suite skips with the reason below instead of
 * silently passing.
 */
const ServiceModuleSchema = z.looseObject({
  startInProcessService: z.custom<StartService>(
    (value) => typeof value === "function",
  ),
});

type RunningService = {
  fetch: FetchLike;
  baseUrl: string;
  stop: () => Promise<void>;
};
type StartService = () => Promise<RunningService>;

async function loadService(): Promise<StartService | null> {
  const specifier = "@shepherdjerred/artifacts/testing";
  try {
    const parsed = ServiceModuleSchema.safeParse(await import(specifier));
    return parsed.success ? parsed.data.startInProcessService : null;
  } catch {
    return null;
  }
}

const start = await loadService();
const PENDING =
  "pending: @shepherdjerred/artifacts/testing (startInProcessService) is not on this stack yet; enable by restacking onto the server change";

describe.skipIf(start === null)(
  start === null ? PENDING : "artifacts contract",
  () => {
    let service: RunningService;

    beforeAll(async () => {
      if (start === null) throw new Error(PENDING);
      service = await start();
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
            fetch: service.fetch,
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

    /** The reviewer: a browser request, so no actor header. */
    async function humanComment(
      board: string,
      artifactId: string,
      body: string,
    ) {
      const response = await service.fetch(
        `${service.baseUrl}/trpc/threads.create`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            board,
            artifactId,
            anchor: { type: "frame", x: 0.4, y: 0.2 },
            body,
          }),
        },
      );
      expect(response.ok).toBe(true);
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
  },
);
