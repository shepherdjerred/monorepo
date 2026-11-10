import { afterAll, beforeAll } from "vitest";
import { z } from "zod";
import { Catalog } from "#infrastructure/catalog.ts";
import { Issues } from "#infrastructure/issues.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { ActorSchema, type ActorEnvelope } from "#shared/actor.ts";
import { CreateIssueSchema, UpdateIssueSchema } from "#shared/schema.ts";
import { cloneTestDatabase } from "./postgres.ts";

type Clone = Awaited<ReturnType<typeof cloneTestDatabase>>;

/** Registers one isolated database for the calling test file. */
export function useTrackerSuite(session: string) {
  const actor: ActorEnvelope = ActorSchema.parse({
    key: `codex:${session}`,
    name: "Codex",
    kind: "agent",
  });
  let clone: Clone | undefined;
  const ready = () => {
    if (clone === undefined) throw new Error("The test database is not ready");
    return clone;
  };
  beforeAll(async () => {
    clone = await cloneTestDatabase(
      z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
    );
  });
  afterAll(async () => {
    await clone?.close();
  });
  const suite = {
    actor,
    get database() {
      return ready().database;
    },
    get unit() {
      return new PrismaUnitOfWork(suite.database);
    },
    get issues() {
      return new Issues(suite.database, suite.unit);
    },
    get catalog() {
      return new Catalog(suite.unit);
    },
    create: (title: string, extra: Record<string, unknown> = {}) =>
      suite.issues.create(
        CreateIssueSchema.parse({ actor, teamKey: "AI", title, ...extra }),
        crypto.randomUUID(),
      ),
    update: (identifier: string, patch: Record<string, unknown>) =>
      suite.issues.update(
        UpdateIssueSchema.parse({ actor, identifier, ...patch }),
        crypto.randomUUID(),
      ),
  };
  return suite;
}
