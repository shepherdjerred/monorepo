import type { Database } from "#infrastructure/database.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";

/** A real independent member mapping; household approval never creates this request or user. */
export async function createSeriesRequester(db: Database) {
  const account = crypto.randomUUID();
  const actor = await db.mediaUser.create({
    data: {
      plexAccountId: account,
      displayName: "Series requester",
      role: "member",
      plexIdentity: {
        create: {
          kind: "account",
          serverMachineId: "fixture-server",
          serverAccountId: account,
          permittedSectionIds: ["2"],
          permittedMediaKinds: ["series"],
          verifiedAt: new Date(),
        },
      },
    },
  });
  return {
    actor,
    commands: new PrismaMediaCommands(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
    }),
  };
}
